import { afterEach, expect, test } from "bun:test";
import {
  HISTORY_LOSS_LEVELS,
  MAX_RANKED_HISTORY_RECORDS,
  compileChatGptWebPromptWithRelevanceTrimming,
  protectedCompactionIndexes,
  rankCompactionDiscardOrder,
} from "../src/adapters/chatgpt-web/history-judgments";
import {
  CHATGPT_COMPACTION_PROMPT_JSON_BYTE_BUDGET,
  chatGptPromptJsonBytes,
  compileChatGptWebPrompt,
  isCompactionCheckpointMessage,
} from "../src/adapters/chatgpt-web/prompt";
import { CHATGPT_WEB_MODEL_ID } from "../src/adapters/chatgpt-web/model";
import { SUMMARY_PREFIX } from "../src/responses/compaction";
import { configureJudgeForTests } from "../src/lib/judge";
import type { CodexMessage, CodexParsedRequest } from "../src/types";

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

const capabilities = { localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: true };

/** Score fake: `levels[index]` is the loss level for `record_<index>`; missing entries are unanswered. */
function withJev(levels: Record<number, number> | (() => never), enabled = true) {
  const seen: Array<{ state: Record<string, unknown>; questions: Record<string, unknown> }> = [];
  const restoreJev = configureJudgeForTests({
    enabled,
    apiKey: () => "test-key",
    evaluate: (async (options: { state: Record<string, unknown>; questions: Record<string, unknown> }) => {
      seen.push({ state: options.state, questions: options.questions });
      if (typeof levels === "function") levels();
      const answers = Object.fromEntries(Object.keys(options.questions).flatMap(key => {
        const level = (levels as Record<number, number>)[Number(key.slice("record_".length))];
        return level === undefined ? [] : [[key, { type: "score", score: level }]];
      }));
      return { answers, usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 } };
    }) as never,
  });
  return { restore: restoreJev, seen };
}

/** Two small developer notes, one huge stale tool result, recent progress, and the final instruction. */
function compactionRequest(): CodexParsedRequest {
  return {
    modelId: CHATGPT_WEB_MODEL_ID,
    _compactionRequest: true,
    context: {
      systemPrompt: [],
      messages: [
        { role: "developer", content: `oldest-note-${"a".repeat(10_000)}`, timestamp: 1 },
        { role: "developer", content: `newer-note-${"b".repeat(10_000)}`, timestamp: 2 },
        { role: "toolResult", toolCallId: "ls", toolName: "shell", isError: false, content: `stale-listing-${"x".repeat(100_000)}`, timestamp: 3 },
        { role: "assistant", content: [{ type: "text", text: "verified-progress" }], timestamp: 4 },
        { role: "user", content: "checkpoint-now", timestamp: 5 },
      ],
    },
    stream: true,
    options: { reasoning: "high" },
  };
}

const envelopeRoles = (text: string): string[] => {
  const encoded = text.match(/<codex_context_json>\n(.+)\n<\/codex_context_json>/s)?.[1];
  return (JSON.parse(encoded!) as { messages: Array<{ role: string }> }).messages.map(message => message.role);
};

test("Jev ranks unprotected records least valuable first and stays stable for equal loss", async () => {
  const jev = withJev({ 0: 3, 1: 3, 2: 0, 3: 2 });
  restore = jev.restore;
  const messages = compactionRequest().context.messages;
  const order = await rankCompactionDiscardOrder(messages, protectedCompactionIndexes(messages, isCompactionCheckpointMessage));
  expect(order).toEqual([2, 3, 0, 1]);
  const state = jev.seen[0]!.state as { compaction_instruction: string; records: Array<{ index: number; role: string; text: string }> };
  expect(state.compaction_instruction).toBe("checkpoint-now");
  expect(state.records.map(record => record.index)).toEqual([0, 1, 2, 3]);
  expect(state.records[2]!.text.length).toBeLessThan(700);
  expect(Object.keys(jev.seen[0]!.questions)).toEqual(["record_0", "record_1", "record_2", "record_3"]);
  expect((jev.seen[0]!.questions.record_2 as { criteria: unknown }).criteria).toBe(HISTORY_LOSS_LEVELS);
});

test("the newest checkpoint and the final instruction are protected; unsure, failing, tiny, or disabled cases yield no order", async () => {
  const checkpoint: CodexMessage = { role: "user", content: `${SUMMARY_PREFIX}\n\nVerified cumulative scope`, timestamp: 2 };
  const messages: CodexMessage[] = [
    { role: "developer", content: "note", timestamp: 1 },
    checkpoint,
    { role: "toolResult", toolCallId: "ls", toolName: "shell", isError: false, content: "listing", timestamp: 3 },
    { role: "user", content: "checkpoint-now", timestamp: 4 },
  ];
  expect(protectedCompactionIndexes(messages, isCompactionCheckpointMessage)).toEqual([1, 3]);
  expect(protectedCompactionIndexes(messages.slice(2), isCompactionCheckpointMessage)).toEqual([1]);

  const jev = withJev({ 0: 1, 1: 0, 2: 4, 3: 0 });
  restore = jev.restore;
  expect(await rankCompactionDiscardOrder(messages, [1, 3])).toEqual([0, 2]);
  expect((jev.seen[0]!.state.records as unknown[]).length).toBe(2);
  restore();

  restore = withJev({}).restore;
  expect(await rankCompactionDiscardOrder(messages, [1, 3])).toBeUndefined();
  restore();
  restore = withJev(() => { throw new Error("gateway down"); }).restore;
  expect(await rankCompactionDiscardOrder(messages, [1, 3])).toBeUndefined();
  restore();
  restore = withJev({ 0: 0, 2: 0 }).restore;
  expect(await rankCompactionDiscardOrder(messages, [0, 1, 3])).toBeUndefined();
  restore();
  const off = withJev({ 0: 0, 2: 0 }, false);
  restore = off.restore;
  expect(await rankCompactionDiscardOrder(messages, [1, 3])).toBeUndefined();
  expect(off.seen).toHaveLength(0);
});

test("only the newest ranked window is judged; older records fall back to oldest-first", async () => {
  const jev = withJev(Object.fromEntries(Array.from({ length: 200 }, (_, index) => [index, 2])));
  restore = jev.restore;
  const messages: CodexMessage[] = Array.from({ length: 60 }, (_, index) => ({ role: "developer" as const, content: `note-${index}`, timestamp: index }));
  const order = await rankCompactionDiscardOrder(messages, [59]);
  expect(order).toHaveLength(MAX_RANKED_HISTORY_RECORDS);
  expect(order![0]).toBe(59 - MAX_RANKED_HISTORY_RECORDS);
});

test("compaction trimming follows the discard order, skips protected records, then falls back to oldest-first", () => {
  const plain = compileChatGptWebPrompt(compactionRequest(), capabilities);
  expect(plain.trimmedCompactionMessages).toBe(2);
  expect(envelopeRoles(plain.text)).toEqual(["tool_result", "assistant", "user"]);

  const relevance = compileChatGptWebPrompt(compactionRequest(), capabilities, undefined, { compactionDiscardOrder: [4, 2, 0] });
  expect(relevance.trimmedCompactionMessages).toBe(1);
  expect(envelopeRoles(relevance.text)).toEqual(["developer", "developer", "assistant", "user"]);
  expect(relevance.text).toContain("oldest-note-");
  expect(relevance.text).toContain("newer-note-");
  expect(relevance.text).not.toContain("stale-listing-");
  expect(relevance.text).toContain("1 earlier history items were omitted");
  expect(chatGptPromptJsonBytes(relevance.text)).toBeLessThanOrEqual(CHATGPT_COMPACTION_PROMPT_JSON_BYTE_BUDGET);

  // An order that only names small records runs out and the loop resumes oldest-first.
  const exhausted = compileChatGptWebPrompt(compactionRequest(), capabilities, undefined, { compactionDiscardOrder: [3] });
  expect(envelopeRoles(exhausted.text)).toEqual(["tool_result", "user"]);
  expect(exhausted.trimmedCompactionMessages).toBe(3);

  // A checkpoint listed in the order is never discarded.
  const withCheckpoint = compactionRequest();
  withCheckpoint.context.messages[1] = { role: "user", content: `${SUMMARY_PREFIX}\n\nVerified cumulative scope`, timestamp: 2 };
  const kept = compileChatGptWebPrompt(withCheckpoint, capabilities, undefined, { compactionDiscardOrder: [1, 2] });
  expect(kept.text).toContain("Verified cumulative scope");
  expect(kept.text).not.toContain("stale-listing-");
  expect(kept.trimmedCompactionMessages).toBe(1);
});

test("the async compile asks Jev only after a compaction prompt had to trim, then drops the least valuable records", async () => {
  const jev = withJev({ 0: 3, 1: 3, 2: 0, 3: 2 });
  restore = jev.restore;
  const compiled = await compileChatGptWebPromptWithRelevanceTrimming(compactionRequest(), capabilities);
  expect(compiled.trimmedCompactionMessages).toBe(1);
  expect(envelopeRoles(compiled.text)).toEqual(["developer", "developer", "assistant", "user"]);
  expect(jev.seen).toHaveLength(1);

  const fits = compactionRequest();
  fits.context.messages.splice(2, 1);
  const untrimmed = await compileChatGptWebPromptWithRelevanceTrimming(fits, capabilities);
  expect(untrimmed.trimmedCompactionMessages).toBeUndefined();
  const normal = compactionRequest();
  delete normal._compactionRequest;
  await compileChatGptWebPromptWithRelevanceTrimming(normal, capabilities);
  expect(jev.seen).toHaveLength(1);
  restore();

  const off = withJev({ 2: 0 }, false);
  restore = off.restore;
  const fallback = await compileChatGptWebPromptWithRelevanceTrimming(compactionRequest(), capabilities);
  expect(fallback).toEqual(compileChatGptWebPrompt(compactionRequest(), capabilities));
  expect(off.seen).toHaveLength(0);
});
