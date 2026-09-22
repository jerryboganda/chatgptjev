import { expect, spyOn, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import * as z from "zod/v4";
import { observeMcpToolCalls } from "../src/adapters/chatgpt-web/mcp-observation";
import { runChatGptMcpServer } from "../src/adapters/chatgpt-web/mcp-server";
import { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { defaultBrokerEndpoint } from "../src/config";
import { configureJudgeForTests, JevDecisionError } from "../src/lib/judge";

for (const [reviewPhase, cancelled] of [
  ["invocation", false], ["output", false], ["invocation", true], ["output", true],
] as const) {
  const behavior = cancelled
    ? "caller cancellation retires the turn even with a Jev error reason"
    : "failure preserves the live MCP turn without releasing unreviewed output";
  test(`required ${reviewPhase} review ${behavior}`, async () => {
    // macOS caps a Unix socket path at 103 bytes, and its per-user temp directory is long; the short
    // POSIX base keeps every platform inside the kernel limit for this fixture.
    const socketPath = defaultBrokerEndpoint(join(process.platform === "win32" ? tmpdir() : "/tmp", `jev-mcp-review-${reviewPhase}-${process.pid}-${Date.now()}`));
    const broker = TurnBroker.forSocket(socketPath);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const originalConnect = McpServer.prototype.connect;
    let server: McpServer | undefined;
    const connect = spyOn(McpServer.prototype, "connect").mockImplementation(async function(this: McpServer) {
      server = this;
      await originalConnect.call(this, serverTransport);
    });
    let rejectReview = true;
    const cancellation = new AbortController();
    const originalAny = AbortSignal.any.bind(AbortSignal);
    const composeSignal = cancelled ? spyOn(AbortSignal, "any").mockImplementation(signals => (
      originalAny([...signals, cancellation.signal])
    )) : undefined;
    const restoreJudge = configureJudgeForTests({
      enabled: true, apiKey: () => "fixture",
      evaluate: (async ({ questions }: { questions: Record<string, unknown> }) => {
        const invocation = "command_risk" in questions;
        const uncertain = rejectReview && (invocation ? reviewPhase === "invocation" : reviewPhase === "output");
        if (uncertain && cancelled) cancellation.abort(new JevDecisionError("fixture", "caller cancelled the review"));
        const answers = invocation
          ? { command_risk: { type: "score", score: 0 }, injected_instructions: { type: "boolean", probability: uncertain ? 0.5 : 0.01 } }
          : Object.fromEntries(Object.keys(questions).map(key => [key, { type: "boolean", probability: uncertain ? 0.5 : 0.01 }]));
        return { answers, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
      }) as never,
    });
    const client = new Client({ name: "review-recovery-test", version: "1" });
    try {
      await runChatGptMcpServer({ brokerSocketPath: socketPath });
      await client.connect(clientTransport);
      const token = await broker.register({
        cwd: tmpdir(), roots: [tmpdir()], writableRoots: [], sandboxPolicy: { type: "readOnly", networkAccess: false },
        tools: [{ name: "exec_command", description: "Read a fixture", parameters: { type: "object" } }],
      });
      const firstReply = client.callTool({ name: "codex_exec", arguments: { turn_token: token, cmd: "first fixture" } });
      if (reviewPhase === "output") {
        const [request] = await broker.nextToolBatch(token, AbortSignal.timeout(1_000));
        broker.completeTool(token, request!.callId, { content: [{ type: "text", text: "UNREVIEWED_PRIVATE_RESULT" }] });
      }
      const refused = await firstReply;
      composeSignal?.mockRestore();
      expect(refused.isError).toBeTrue();
      expect(JSON.stringify(refused)).not.toContain("UNREVIEWED_PRIVATE_RESULT");

      const inventory = await client.callTool({
        name: "codex_tool_inventory",
        arguments: { turn_token: token, query: "exec_command", include_schema: false },
      });
      if (cancelled) {
        expect(inventory.isError).toBeTrue();
        expect(JSON.stringify(inventory)).toContain("already finished");
        return;
      }
      expect(inventory.isError).not.toBe(true);
      expect(refused.structuredContent).toMatchObject({
        code: "jev_decision_required",
        execution_state: reviewPhase === "output" ? "completed" : "not_started",
        // Graceful: a tool that never ran is only waiting for its review, so the
        // model may retry the same call; a withheld result must never repeat.
        retryable: reviewPhase !== "output",
      });

      rejectReview = false;
      const nextReply = client.callTool({ name: "codex_exec", arguments: { turn_token: token, cmd: "next fixture" } });
      const [nextRequest] = await broker.nextToolBatch(token, AbortSignal.timeout(1_000));
      expect(nextRequest?.arguments?.cmd).toBe("next fixture");
      broker.completeTool(token, nextRequest!.callId, { content: [{ type: "text", text: "REVIEWED_RESULT" }] });
      const accepted = await nextReply;
      expect(accepted.isError).not.toBe(true);
      expect(accepted.content).toEqual([{ type: "text", text: "REVIEWED_RESULT" }]);
    } finally {
      composeSignal?.mockRestore();
      connect.mockRestore();
      restoreJudge();
      await client.close();
      await server?.close();
      await broker.close();
    }
  });
}

test("MCP shares one deadline across native review, execution and delayed output batches", async () => {
  const socketPath = defaultBrokerEndpoint(join(process.platform === "win32" ? tmpdir() : "/tmp", `jev-mcp-${process.pid}-${Date.now()}`));
  const broker = TurnBroker.forSocket(socketPath);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const originalConnect = McpServer.prototype.connect;
  let server: McpServer | undefined;
  const connect = spyOn(McpServer.prototype, "connect").mockImplementation(async function(this: McpServer) {
    server = this;
    await originalConnect.call(this, serverTransport);
  });
  let outputBatches = 0;
  const restoreJudge = configureJudgeForTests({
    enabled: true, apiKey: () => "fixture",
    evaluate: (async ({ questions, abortSignal }: { questions: Record<string, unknown>; abortSignal: AbortSignal }) => {
      let answers: Record<string, unknown>;
      if ("command_risk" in questions) {
        answers = { command_risk: { type: "score", score: 0 }, injected_instructions: { type: "boolean", probability: 0.01 } };
      } else {
        outputBatches += 1;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 90);
          abortSignal.addEventListener("abort", () => { clearTimeout(timer); reject(abortSignal.reason); }, { once: true });
        });
        answers = Object.fromEntries(Object.keys(questions).map(key => [key, { type: "boolean", probability: 0.01 }]));
      }
      return { answers, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    }) as never,
  });
  const client = new Client({ name: "deadline-test", version: "1" });
  try {
    await runChatGptMcpServer({ brokerSocketPath: socketPath });
    await client.connect(clientTransport);
    const token = await broker.register({
      cwd: tmpdir(), roots: [tmpdir()], writableRoots: [], sandboxPolicy: { type: "readOnly", networkAccess: false },
      tools: [{ name: "exec_command", description: "Read a fixture", parameters: { type: "object" } }],
    }, 200, "jev-output-deadline");
    const result = client.callTool({ name: "codex_exec", arguments: { turn_token: token, cmd: "fixture" } });
    const [request] = await broker.nextToolBatch(token);
    broker.completeTool(token, request!.callId, {
      content: [{ type: "text", text: Array.from({ length: 120 }, (_, index) => `UNRELEASED ${index}`).join("\n") }],
    });
    const reply = await result;
    expect(reply.isError).toBeTrue();
    expect(reply.structuredContent).toMatchObject({ code: "codex_tool_timeout", retryable: false });
    expect(JSON.stringify(reply)).not.toContain("UNRELEASED");
    expect(outputBatches).toBeGreaterThan(0);
    expect(outputBatches).toBeLessThan(4);
  } finally {
    connect.mockRestore();
    restoreJudge();
    await client.close();
    await server?.close();
    await broker.close();
  }
});

test("MCP observations separate pre-handler validation and returned tool errors without recording content", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const events: Array<Record<string, unknown>> = [];
  const secret = "fixture-private-path-token-and-command";
  let invoked = 0;
  const server = new McpServer({ name: "observation-test", version: "1" });
  server.registerTool("codex_exec", { inputSchema: { cmd: z.string() } }, async () => {
    invoked += 1;
    return { isError: invoked === 1, content: [{ type: "text", text: secret }] };
  });
  observeMcpToolCalls(serverTransport, new Set(["codex_exec"]), event => events.push(event));
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1" });
  try {
    await client.connect(clientTransport);
    const invalid = await client.callTool({ name: "codex_exec", arguments: { private_key: secret } });
    expect(invalid.isError).toBeTrue();
    expect(invoked).toBe(0);
    const refused = await client.callTool({ name: "codex_exec", arguments: { cmd: secret } });
    const accepted = await client.callTool({ name: "codex_exec", arguments: { cmd: secret } });
    expect(refused.isError).toBeTrue();
    expect(accepted.isError).toBeFalse();
    expect(refused.content).toEqual(accepted.content);
    expect(invoked).toBe(2);
    expect(events.map(event => event.event)).toEqual(Array(3).fill(["call_received", "reply_sent"]).flat());
    expect(events.filter(event => event.event === "reply_sent").map(event => event.is_error)).toEqual([true, true, false]);
    expect(events.map(event => event.call)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(JSON.stringify(events)).not.toContain("private_key");
    expect(JSON.stringify(events)).not.toContain("content");
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP observation failures, arbitrary IDs and unknown names never alter transport behavior", async () => {
  const events: Array<Record<string, unknown>> = [];
  const secret = "private-id-and-tool-name";
  const originalError = new Error("private transport failure");
  let received = 0;
  let closed = false;
  const transport: Transport = {
    start: async () => {}, close: async () => {},
    onmessage: () => { received += 1; }, onclose: () => { closed = true; },
    send: async () => { throw originalError; },
  };
  observeMcpToolCalls(transport, new Set(["codex_exec"]), event => {
    events.push(event);
    throw new Error("sink unavailable");
  });
  transport.onmessage?.({ jsonrpc: "2.0", id: secret, method: "tools/call", params: { name: secret } });
  expect(received).toBe(1);
  await expect(transport.send({ jsonrpc: "2.0", id: secret, result: {} })).rejects.toBe(originalError);
  expect(events.at(-1)).toMatchObject({ event: "reply_send_failed", tool: "unknown" });
  expect(JSON.stringify(events)).not.toContain(secret);
  expect(JSON.stringify(events)).not.toContain(originalError.message);
  const duplicate = { jsonrpc: "2.0" as const, id: 7, method: "tools/call", params: { name: "codex_exec" } };
  transport.onmessage?.(duplicate);
  transport.onmessage?.(duplicate);
  expect(events.at(-1)).toMatchObject({ event: "uncorrelated_call", reason: "duplicate_id" });
  const count = events.length;
  await expect(transport.send({ jsonrpc: "2.0", id: 7, result: {} })).rejects.toBe(originalError);
  expect(events).toHaveLength(count);
  transport.onclose?.();
  expect(closed).toBeTrue();
});
