import { expect, test } from "bun:test";
import {
  confidentBoolean,
  confidentChoice,
  configureJudgeForTests,
  judge,
  judgeEnabled,
  nearestScoreLevel,
  setJudgeEnabled,
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

test("judge refuses a missing key instead of bypassing Jev", async () => {
  const events: JudgeEvent[] = [];
  const fake = fakeEvaluate({});
  const restore = configureJudgeForTests({ evaluate: fake.fn, enabled: true, apiKey: () => undefined, onEvent: e => events.push(e) });
  try {
    expect(judgeEnabled()).toBe(false);
    await expect(judge("site", "text", QUESTIONS)).rejects.toThrow(/Jev.*AI_GATEWAY_API_KEY/);
    expect(fake.calls()).toBe(0);
    expect(events.map(e => e.outcome)).toEqual(["failed"]);
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

test("judge reports a timeout instead of falling back", async () => {
  const events: JudgeEvent[] = [];
  const fake = fakeEvaluate({}, 5_000);
  const restore = configureJudgeForTests({ evaluate: fake.fn, enabled: true, apiKey: () => "k", timeoutMs: 20, onEvent: e => events.push(e) });
  try {
    await expect(judge("site", "slow", QUESTIONS)).rejects.toThrow(/Jev.*timed out/);
    expect(events[0]?.outcome).toBe("timeout");
  } finally {
    restore();
  }
});

test("validated judgments recover from uncertainty and cache only the accepted answer", async () => {
  let calls = 0;
  const events: JudgeEvent[] = [];
  const restore = configureJudgeForTests({
    enabled: true, apiKey: () => "fixture", onEvent: event => events.push(event),
    evaluate: (async () => {
      calls += 1;
      const probability = calls === 1 ? 0.55 : 0.95;
      return {
        answers: {
          kind: { type: "choice", choice: "a", probabilities: { a: probability, b: 1 - probability } },
          yes: { type: "boolean", probability: 0.5 },
        },
        usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
      };
    }) as never,
  });
  const options = { validate: (answers: { kind: Parameters<typeof confidentChoice>[0] }) => { confidentChoice(answers.kind); } };
  try {
    const answers = await judge("browser_status", { private_content: "fixture-only" }, QUESTIONS, options);
    expect(confidentChoice(answers.kind)).toBe("a");
    expect(calls).toBe(2);
    expect((await judge("browser_status", { private_content: "fixture-only" }, QUESTIONS, options)).kind).toEqual(answers.kind);
    expect(calls).toBe(2);
    expect(events.map(event => event.outcome)).toEqual(["recovering", "answered", "cached"]);
    expect(events.every(event => event.site === "browser_status")).toBeTrue();
    expect(JSON.stringify(events)).not.toContain("fixture-only");
  } finally {
    restore();
  }
});

test("persistent uncertainty is bounded, site-specific and never cached", async () => {
  const fake = fakeEvaluate({ kind: { type: "choice", choice: "a", probabilities: { a: 0.55, b: 0.45 } } });
  const restore = configureJudgeForTests({ evaluate: fake.fn, enabled: true, apiKey: () => "fixture" });
  try {
    for (let request = 1; request <= 2; request += 1) {
      await expect(judge("stalled_turn", "same evidence", QUESTIONS, {
        validate: answers => { confidentChoice(answers.kind); },
      })).rejects.toThrow(/Jev is required at stalled_turn:.*uncertain/);
      expect(fake.calls()).toBe(request * 3);
    }
  } finally {
    restore();
  }
});

test("cancellation during judgment recovery prevents another inference", async () => {
  const controller = new AbortController();
  const reason = new Error("owning turn stopped");
  const fake = fakeEvaluate({ kind: { type: "choice", choice: "a", probabilities: { a: 0.55, b: 0.45 } } });
  const restore = configureJudgeForTests({
    evaluate: fake.fn, enabled: true, apiKey: () => "fixture",
    onEvent: event => { if (event.outcome === "recovering") controller.abort(reason); },
  });
  try {
    await expect(judge("cancelled_review", "evidence", QUESTIONS, {
      signal: controller.signal,
      validate: answers => { confidentChoice(answers.kind); },
    })).rejects.toBe(reason);
    expect(fake.calls()).toBe(1);
  } finally {
    restore();
  }
});

test("judge reports provider failure without leaking its response", async () => {
  const events: JudgeEvent[] = [];
  const restore = configureJudgeForTests({
    evaluate: (async () => { throw new Error("gateway 503 private-provider-content"); }) as never,
    enabled: true,
    apiKey: () => "k",
    onEvent: e => events.push(e),
  });
  try {
    await expect(judge("site", "x", QUESTIONS)).rejects.toThrow(/Jev.*failed/);
    expect(events[0]?.outcome).toBe("failed");
    expect(JSON.stringify(events)).not.toContain("private-provider-content");
  } finally {
    restore();
  }
});

test("uncertain or missing consumed judgments stop the decision", () => {
  expect(confidentChoice({ choice: "a", probabilities: { a: 0.75, b: 0.2, c: 0.05 } })).toBe("a");
  expect(() => confidentChoice<"a" | "b">({ choice: "a", probabilities: { a: 0.6, b: 0.4 } })).toThrow(/Jev.*uncertain/);
  expect(() => confidentChoice<"a" | "b">({ choice: "a", probabilities: { a: 0.7, b: 0.45 } })).toThrow(/Jev/);
  expect(() => confidentChoice({ choice: "a" })).toThrow(/Jev/);
  expect(() => confidentChoice(undefined)).toThrow(/Jev/);
  expect(confidentBoolean({ probability: 0.7 })).toBe(true);
  expect(confidentBoolean({ probability: 0.3 })).toBe(false);
  expect(() => confidentBoolean({ probability: 0.5 })).toThrow(/Jev.*uncertain/);
  expect(() => confidentBoolean(undefined)).toThrow(/Jev/);
  expect(() => confidentBoolean({ probability: Number.NaN })).toThrow(/Jev/);
  expect(nearestScoreLevel({ score: 1.4 }, 4)).toBe(1);
  expect(nearestScoreLevel({ score: 7 }, 4)).toBe(3);
  expect(() => nearestScoreLevel(undefined, 4)).toThrow(/Jev/);
});

test("the runtime switch cannot disable required Jev judgments", () => {
  expect(() => setJudgeEnabled(false)).toThrow(/Jev.*required/);
});

test("judge enforces its deadline even when the provider ignores cancellation", async () => {
  const restore = configureJudgeForTests({
    evaluate: (() => new Promise(() => {})) as never,
    enabled: true,
    apiKey: () => "k",
    timeoutMs: 20,
  });
  try {
    await expect(judge("unresponsive", "text", QUESTIONS)).rejects.toThrow(/Jev.*timed out/);
  } finally {
    restore();
  }
});

test("caller cancellation stops an unresponsive provider without replacing the caller reason", async () => {
  let providerSignal: AbortSignal | undefined;
  const restore = configureJudgeForTests({
    evaluate: ((options: { abortSignal: AbortSignal }) => {
      providerSignal = options.abortSignal;
      return new Promise(() => {});
    }) as never,
    enabled: true, apiKey: () => "k", timeoutMs: 100,
  });
  const controller = new AbortController();
  const reason = new Error("owning operation deadline");
  try {
    const pending = judge("cancelled", "text", QUESTIONS, { signal: controller.signal });
    await Promise.resolve();
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(providerSignal?.aborted).toBeTrue();
  } finally {
    restore();
  }
});

test("a cached verdict cannot revive an already cancelled operation", async () => {
  const fake = fakeEvaluate({ yes: { type: "boolean", probability: 0.99 } });
  const restore = configureJudgeForTests({ evaluate: fake.fn, enabled: true, apiKey: () => "k" });
  try {
    await judge("cached", "text", QUESTIONS);
    const reason = new Error("caller cancelled");
    await expect(judge("cached", "text", QUESTIONS, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(fake.calls()).toBe(1);
  } finally {
    restore();
  }
});
