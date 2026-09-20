import { expect, test } from "bun:test";
import {
  confidentBoolean,
  confidentChoice,
  configureJudgeForTests,
  judge,
  judgeEnabled,
  nearestScoreLevel,
  type JudgeEvent,
} from "../src/lib/judge";

const QUESTIONS = {
  kind: { type: "choice", instructions: "kind", criteria: { a: "A", b: "B" } },
  yes: { type: "boolean", instructions: "yes?" },
} as const;

function fakeEvaluate(answers: unknown, delayMs = 0) {
  let calls = 0;
  const fn = (async ({ abortSignal }: { abortSignal?: AbortSignal }) => {
    calls += 1;
    if (delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        abortSignal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); });
      });
    }
    return { answers, usage: { inputTokens: 42, outputTokens: 0, totalTokens: 42 } };
  }) as unknown as Parameters<typeof configureJudgeForTests>[0]["evaluate"];
  return { fn: fn!, calls: () => calls };
}

test("judge is fail-open: disabled or missing key resolves to undefined without calling the model", async () => {
  const events: JudgeEvent[] = [];
  const fake = fakeEvaluate({});
  const restore = configureJudgeForTests({ evaluate: fake.fn, enabled: true, apiKey: () => undefined, onEvent: e => events.push(e) });
  try {
    expect(judgeEnabled()).toBe(false);
    expect(await judge("site", "text", QUESTIONS)).toBeUndefined();
    expect(fake.calls()).toBe(0);
    expect(events.map(e => e.outcome)).toEqual(["disabled"]);
  } finally {
    restore();
  }
});

test("judge returns typed answers, caches by state hash, and logs probabilities only", async () => {
  const events: JudgeEvent[] = [];
  const answers = { kind: { type: "choice", choice: "a", probabilities: { a: 0.9, b: 0.1 } }, yes: { type: "boolean", probability: 0.8 } };
  const fake = fakeEvaluate(answers);
  const restore = configureJudgeForTests({ evaluate: fake.fn, enabled: true, apiKey: () => "k", onEvent: e => events.push(e) });
  try {
    const first = await judge("site", { text: "secret content" }, QUESTIONS);
    expect(first?.kind.choice).toBe("a");
    expect(first?.yes.probability).toBe(0.8);
    const second = await judge("site", { text: "secret content" }, QUESTIONS);
    expect(second).toEqual(first);
    expect(fake.calls()).toBe(1);
    await judge("site", { text: "other content" }, QUESTIONS);
    expect(fake.calls()).toBe(2);
    expect(events.map(e => e.outcome)).toEqual(["answered", "cached", "answered"]);
    expect(events[0]?.inputTokens).toBe(42);
    expect(JSON.stringify(events)).not.toContain("secret content");
    expect(events[0]?.answers).toEqual({ kind: { choice: "a", probabilities: { a: 0.9, b: 0.1 } }, yes: { probability: 0.8 } });
  } finally {
    restore();
  }
});

test("judge times out and fails open", async () => {
  const events: JudgeEvent[] = [];
  const fake = fakeEvaluate({}, 5_000);
  const restore = configureJudgeForTests({ evaluate: fake.fn, enabled: true, apiKey: () => "k", timeoutMs: 20, onEvent: e => events.push(e) });
  try {
    expect(await judge("site", "slow", QUESTIONS)).toBeUndefined();
    expect(events[0]?.outcome).toBe("timeout");
  } finally {
    restore();
  }
});

test("judge swallows provider errors", async () => {
  const events: JudgeEvent[] = [];
  const restore = configureJudgeForTests({
    evaluate: (async () => { throw new Error("gateway 503"); }) as never,
    enabled: true,
    apiKey: () => "k",
    onEvent: e => events.push(e),
  });
  try {
    expect(await judge("site", "x", QUESTIONS)).toBeUndefined();
    expect(events[0]).toMatchObject({ outcome: "failed", error: "gateway 503" });
  } finally {
    restore();
  }
});

test("confidence thresholds: choice needs p>=0.7 and margin>=0.3, noul is decisive only outside (0.3, 0.7)", () => {
  expect(confidentChoice({ choice: "a", probabilities: { a: 0.75, b: 0.2, c: 0.05 } })).toBe("a");
  expect(confidentChoice({ choice: "a", probabilities: { a: 0.6, b: 0.4 } })).toBeUndefined();
  expect(confidentChoice({ choice: "a", probabilities: { a: 0.7, b: 0.45 } })).toBeUndefined();
  expect(confidentChoice({ choice: "a" })).toBeUndefined();
  expect(confidentChoice(undefined)).toBeUndefined();
  expect(confidentBoolean({ probability: 0.7 })).toBe(true);
  expect(confidentBoolean({ probability: 0.3 })).toBe(false);
  expect(confidentBoolean({ probability: 0.5 })).toBeUndefined();
  expect(confidentBoolean(undefined)).toBeUndefined();
  expect(nearestScoreLevel({ score: 1.4 }, 4)).toBe(1);
  expect(nearestScoreLevel({ score: 7 }, 4)).toBe(3);
  expect(nearestScoreLevel(undefined, 4)).toBeUndefined();
});
