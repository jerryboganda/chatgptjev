import { afterEach, expect, test } from "bun:test";
import {
  COMPACTION_COMPLETENESS_LEVELS,
  judgeCompactionHandoff,
  MAX_TRANSCRIPT_TAIL_CHARS,
  transcriptTail,
} from "../src/adapters/chatgpt-web/compaction-judgments";
import { LATEST_USER_PROMPT_MARKER } from "../src/adapters/chatgpt-web/compaction-handoff";
import { configureJudgeForTests } from "../src/lib/judge";
import type { CodexParsedRequest } from "../src/types";

function withJev(answers: () => Record<string, unknown>, enabled = true) {
  const states: Array<Record<string, unknown>> = [];
  const restore = configureJudgeForTests({
    enabled,
    apiKey: () => "test-key",
    evaluate: (async (options: { state: Record<string, unknown> }) => {
      states.push(options.state);
      return { answers: answers(), usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 } };
    }) as never,
  });
  return { restore, states };
}

const verdict = (completeness: number, preserves: number, contradiction: number) => () => ({
  completeness: { type: "score", score: completeness, probabilities: { [String(Math.round(completeness))]: 1 } },
  preserves_latest_user_request: { type: "boolean", probability: preserves },
  introduces_contradiction: { type: "boolean", probability: contradiction },
});

const LATEST = "Now make the retry budget configurable and add a test.";

const request: CodexParsedRequest = {
  modelId: "gpt-5.6",
  stream: true,
  options: {},
  _compactionRequest: true,
  _rawBody: {
    input: [{ type: "message", role: "user", id: "msg_latest", content: [{ type: "input_text", text: LATEST }] }],
  },
  context: {
    messages: [
      { role: "user", content: "Add exponential backoff to src/http/client.ts", timestamp: 1 },
      {
        role: "assistant",
        timestamp: 2,
        content: [
          { type: "thinking", thinking: "private" },
          { type: "toolCall", id: "call_1", name: "apply_patch", arguments: { file: "src/http/client.ts" } },
        ],
      },
      { role: "toolResult", toolCallId: "call_1", toolName: "apply_patch", content: "Success. Updated src/http/client.ts", isError: false, timestamp: 3 },
      { role: "assistant", timestamp: 4, content: [{ type: "text", text: "Backoff added with a 5-attempt cap; tests pass." }] },
      { role: "user", content: [{ type: "text", text: LATEST }, { type: "image", imageUrl: "data:image/png;base64,AAAA" }], timestamp: 5 },
    ],
  },
};

const summary = `# Handoff\nBackoff implemented in src/http/client.ts (5 attempts). Next: configurable budget + test.\n\n${LATEST_USER_PROMPT_MARKER}\n${JSON.stringify(LATEST)}`;

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

test("the transcript tail is role-tagged, skips hidden reasoning, and stays bounded", () => {
  const tail = transcriptTail(request.context.messages);
  expect(tail.split("\n")).toEqual([
    "[user] Add exponential backoff to src/http/client.ts",
    '[assistant] [tool call apply_patch({"file":"src/http/client.ts"})]',
    "[tool:apply_patch] Success. Updated src/http/client.ts",
    "[assistant] Backoff added with a 5-attempt cap; tests pass.",
    `[user] ${LATEST}\n[image]`,
  ].join("\n").split("\n"));
  expect(tail).not.toContain("private");

  const huge = Array.from({ length: 40 }, (_, index) => ({ role: "user" as const, content: `${index}:${"x".repeat(1000)}`, timestamp: index }));
  const bounded = transcriptTail(huge);
  expect(bounded.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_TAIL_CHARS + 1);
  expect(bounded).toContain("39:");
  expect(bounded).not.toContain("[user] 0:");
});

test("a complete, faithful summary is accepted and Jev sees the summary without the marker appendix", async () => {
  const jev = withJev(verdict(2.8, 0.95, 0.05));
  restore = jev.restore;

  const result = await judgeCompactionHandoff(request, summary);
  expect(result).toEqual({
    acceptable: true,
    completeness: 3,
    preservesLatestUserRequest: true,
    introducesContradiction: false,
    reasons: [],
  });
  const state = jev.states[0]!;
  expect(state.summary).not.toContain(LATEST_USER_PROMPT_MARKER);
  expect(state.summary).toContain("Backoff implemented");
  expect(state.latest_user_request).toBe(LATEST);
  expect(state.transcript_tail).toContain("[tool:apply_patch]");
  expect(COMPACTION_COMPLETENESS_LEVELS).toHaveLength(4);
});

test("an unusable summary, a dropped latest request, or a contradiction each reject with a reason", async () => {
  const cases: Array<[() => Record<string, unknown>, string[]]> = [
    [verdict(0.2, 0.9, 0.1), ["completeness 0/3"]],
    [verdict(2, 0.1, 0.1), ["drops the latest user request"]],
    [verdict(2, 0.9, 0.85), ["contradicts the transcript"]],
    [verdict(0, 0.2, 0.9), ["completeness 0/3", "drops the latest user request", "contradicts the transcript"]],
  ];
  for (const [answers, reasons] of cases) {
    restore?.();
    restore = withJev(answers).restore;
    const result = await judgeCompactionHandoff(request, summary);
    expect(result.acceptable).toBe(false);
    expect(result.reasons).toEqual(reasons);
  }
});

test("uncertain, failed, or disabled Jev cannot approve a summary", async () => {
  restore = withJev(verdict(1.2, 0.5, 0.5)).restore;
  await expect(judgeCompactionHandoff(request, summary)).rejects.toThrow(/Jev.*uncertain/);

  restore();
  restore = withJev(() => { throw new Error("gateway down"); }).restore;
  await expect(judgeCompactionHandoff(request, summary)).rejects.toThrow(/Jev.*failed/);

  restore();
  const disabled = withJev(verdict(0, 0, 1), false);
  restore = disabled.restore;
  await expect(judgeCompactionHandoff(request, summary)).rejects.toThrow(/Jev.*disabled/);
  expect(disabled.states).toHaveLength(0);
});

test("compaction retries an uncertain review without accepting or caching it", async () => {
  let attempts = 0;
  const jev = withJev(() => {
    attempts += 1;
    return verdict(2.8, attempts === 1 ? 0.55 : 0.95, 0.05)();
  });
  restore = jev.restore;
  expect((await judgeCompactionHandoff(request, summary)).acceptable).toBeTrue();
  expect(attempts).toBe(2);
  expect((await judgeCompactionHandoff(request, summary)).acceptable).toBeTrue();
  expect(attempts).toBe(2);
});
