import { afterEach, expect, test } from "bun:test";
import {
  EFFORT_SUGGESTION_MIN_GAP,
  EFFORT_TIERS,
  REQUEST_DIFFICULTY_LEVELS,
  latestUserRequestText,
  resetEffortSuggestionsForTests,
  suggestEffortTier,
} from "../src/adapters/chatgpt-web/effort-judgments";
import { configureJudgeForTests } from "../src/lib/judge";
import type { CodexMessage } from "../src/types";

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
  resetEffortSuggestionsForTests();
});

function withJev(score: number | (() => never), enabled = true) {
  const seen: Array<Record<string, unknown>> = [];
  const restoreJev = configureJudgeForTests({
    enabled,
    apiKey: () => "test-key",
    evaluate: (async (options: { state: Record<string, unknown> }) => {
      seen.push(options.state);
      if (typeof score === "function") score();
      return { answers: { difficulty: { type: "score", score } }, usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 } };
    }) as never,
  });
  return { restore: restoreJev, seen };
}

const user = (content: CodexMessage extends { content: infer C } ? C : never, origin?: "codex_skill"): CodexMessage =>
  ({ role: "user", content, timestamp: 1, ...(origin ? { origin } : {}) } as CodexMessage);

test("the newest real user message is the request; skills, tool results, and agent traffic are skipped", () => {
  const messages: CodexMessage[] = [
    user("Fix the typo in README"),
    { role: "assistant", content: [{ type: "text", text: "Done." }], timestamp: 2 },
    user([{ type: "text", text: "Now rename " }, { type: "image", imageUrl: "data:image/png;base64,AA==" }, { type: "text", text: "the helper" }]),
    user("# skill body", "codex_skill"),
    { role: "toolResult", toolCallId: "c1", toolName: "shell", content: "ok", isError: false, timestamp: 4 },
    { role: "agentMessage", content: "sub-agent chatter", timestamp: 5 },
  ];
  expect(latestUserRequestText(messages)).toBe("Now rename \nthe helper");
  expect(latestUserRequestText([])).toBe("");
});

test("a far easier or far harder request yields one throttled suggestion that names the public model slug", async () => {
  expect(EFFORT_TIERS).toHaveLength(REQUEST_DIFFICULTY_LEVELS.length);
  const jev = withJev(0);
  restore = jev.restore;
  const messages = [user("What does `git stash` do?")];
  const first = await suggestEffortTier(messages, "high", 1_000);
  expect(first).toContain("chatgpt-web/light");
  expect(first).toContain("routed High");
  expect(first).toContain("trivial");
  expect(jev.seen[0]).toMatchObject({ request: "What does `git stash` do?", prior_turns: 1 });

  // Same suggestion within the cooldown is suppressed; a different routed tier is not.
  expect(await suggestEffortTier(messages, "high", 2_000)).toBeUndefined();
  expect(await suggestEffortTier(messages, "max", 3_000)).toContain("routed Pro");

  restore();
  restore = withJev(4).restore;
  const harder = await suggestEffortTier([user("Design a lock-free MPMC queue with ABA-safe reclamation and prove linearizability.")], "medium", 10_000);
  expect(harder).toContain("chatgpt-web/pro");
  expect(harder).toContain("would likely do better");
});

test("adjacent tiers, empty requests, unsure scores, judge errors, and a disabled judge stay silent", async () => {
  expect(EFFORT_SUGGESTION_MIN_GAP).toBe(2);
  restore = withJev(2.4).restore;
  expect(await suggestEffortTier([user("Add a null check to parse()")], "high")).toBeUndefined();
  expect(await suggestEffortTier([user("Add a null check to parse()")], "medium")).toBeUndefined();
  expect(await suggestEffortTier([], "high")).toBeUndefined();

  restore();
  restore = withJev(() => { throw new Error("gateway down"); }).restore;
  expect(await suggestEffortTier([user("Anything")], "max")).toBeUndefined();

  restore();
  const off = withJev(0, false);
  restore = off.restore;
  expect(await suggestEffortTier([user("What is 2+2?")], "max")).toBeUndefined();
  expect(off.seen).toHaveLength(0);
});
