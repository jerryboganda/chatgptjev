import { afterEach, expect, test } from "bun:test";
import { CRASH_KINDS, classifyCrashLoop } from "../src/crash-judgments";
import { configureJudgeForTests } from "../src/lib/judge";

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

function withJev(probabilities: Record<string, number> | (() => never), enabled = true) {
  const seen: Array<{ state: Record<string, unknown>; questions: Record<string, { criteria?: Record<string, string> }> }> = [];
  const restoreJev = configureJudgeForTests({
    enabled,
    apiKey: () => "test-key",
    evaluate: (async (options: { state: Record<string, unknown>; questions: Record<string, { criteria?: Record<string, string> }> }) => {
      seen.push({ state: options.state, questions: options.questions });
      if (typeof probabilities === "function") probabilities();
      const top = Object.entries(probabilities).sort(([, a], [, b]) => b - a)[0]![0];
      return {
        answers: { crash_kind: { type: "choice", choice: top, probabilities } },
        usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
      };
    }) as never,
  });
  return { restore: restoreJev, seen };
}

const input = { child: "daemon" as const, lastFailure: `daemon exited (1): EADDRINUSE 127.0.0.1:8123 ${"x".repeat(2_500)}`, restarts: 6 };

test("a confident crash kind returns its fix and the state carries the clipped failure line", async () => {
  const jev = withJev({ port_in_use: 0.9, transient_crash: 0.1 });
  restore = jev.restore;

  expect(await classifyCrashLoop(input)).toEqual({ kind: "port_in_use", fix: CRASH_KINDS.port_in_use.fix });

  const state = jev.seen[0]!.state as { child: string; last_failure: string; restarts_in_last_minute: number };
  expect(state.child).toBe("daemon");
  expect(state.restarts_in_last_minute).toBe(6);
  expect(state.last_failure.length).toBe(2_000);
  expect(Object.keys(jev.seen[0]!.questions.crash_kind!.criteria!)).toEqual(Object.keys(CRASH_KINDS));
});

test("unsure, failing, or disabled Jev yields no verdict", async () => {
  const unsure = withJev({ port_in_use: 0.5, config_invalid: 0.4, transient_crash: 0.1 });
  restore = unsure.restore;
  expect(await classifyCrashLoop(input)).toBeUndefined();
  restore();

  const failing = withJev(() => { throw new Error("gateway down"); });
  restore = failing.restore;
  expect(await classifyCrashLoop(input)).toBeUndefined();
  restore();

  const disabled = withJev({ port_in_use: 1 }, false);
  restore = disabled.restore;
  expect(await classifyCrashLoop(input)).toBeUndefined();
  expect(disabled.seen).toHaveLength(0);
});
