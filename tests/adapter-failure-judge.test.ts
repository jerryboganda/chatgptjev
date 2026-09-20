import { expect, test } from "bun:test";
import { bridgeToResponsesSSE } from "../src/bridge";
import { adapterFailureFromMessage, judgeAdapterFailure } from "../src/lib/errors";
import { configureJudgeForTests } from "../src/lib/judge";
import type { AdapterEvent } from "../src/types";

type Answers = {
  category: { type: "choice"; choice: string; probabilities: Record<string, number> };
  retryable: { type: "boolean"; probability: number };
  user_action_required: { type: "boolean"; probability: number };
};

function withJev(answers: Answers | (() => never), enabled = true) {
  let calls = 0;
  const restore = configureJudgeForTests({
    enabled,
    apiKey: () => "test-key",
    evaluate: (async () => {
      calls += 1;
      if (typeof answers === "function") answers();
      return { answers, usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 } };
    }) as never,
  });
  return { restore, calls: () => calls };
}

function verdict(category: string, p: number, retryable: number, userAction: number): Answers {
  const others = Object.fromEntries(["upstream_server_error", "none"].filter(c => c !== category).map(c => [c, (1 - p) / 2]));
  return {
    category: { type: "choice", choice: category, probabilities: { [category]: p, ...others } },
    retryable: { type: "boolean", probability: retryable },
    user_action_required: { type: "boolean", probability: userAction },
  };
}

const SUSPENDED = "Your account has been temporarily suspended due to unusual activity.";

test("keyword classifier misfiles an account suspension as an overloaded server", () => {
  expect(adapterFailureFromMessage(SUSPENDED)).toMatchObject({ httpStatus: 503, error: { code: "server_is_overloaded" } });
});

test("Jev refines a message-only failure to Codex's code, status and retryability", async () => {
  const jev = withJev(verdict("permission_denied", 0.92, 0.05, 0.95));
  try {
    const failure = await judgeAdapterFailure(SUSPENDED);
    expect(failure).toEqual({
      httpStatus: 403,
      error: { message: SUSPENDED, type: "permission_error", code: "permission_denied" },
      retryable: false,
      userActionRequired: true,
      source: "jev",
    });
    expect(jev.calls()).toBe(1);
  } finally {
    jev.restore();
  }
});

test("uncertain, 'none', disabled or failing Jev keeps the keyword payload", async () => {
  const cases: Array<[() => ReturnType<typeof withJev>, Partial<Awaited<ReturnType<typeof judgeAdapterFailure>>>]> = [
    [() => withJev(verdict("permission_denied", 0.6, 0.5, 0.5)), { source: "keywords", retryable: undefined, userActionRequired: undefined }],
    [() => withJev(verdict("none", 0.99, 0.1, 0.1)), { source: "keywords", retryable: false, userActionRequired: false }],
    [() => withJev(verdict("permission_denied", 0.99, 0.1, 0.9), false), { source: "keywords", retryable: undefined }],
    [() => withJev(() => { throw new Error("gateway down"); }), { source: "keywords" }],
  ];
  for (const [configure, expected] of cases) {
    const jev = configure();
    try {
      const failure = await judgeAdapterFailure(SUSPENDED);
      expect(failure).toMatchObject({ httpStatus: 503, error: { code: "server_is_overloaded" }, ...expected });
    } finally {
      jev.restore();
    }
  }
});

test("exact client-close phrases and empty messages never consult Jev", async () => {
  const jev = withJev(verdict("upstream_server_error", 0.99, 0.9, 0.1));
  try {
    expect(await judgeAdapterFailure("Request cancelled by client")).toMatchObject({ httpStatus: 499, source: "keywords" });
    expect(await judgeAdapterFailure("   ")).toMatchObject({ source: "keywords" });
    expect(jev.calls()).toBe(0);
  } finally {
    jev.restore();
  }
});

test("a user-blocking verdict is never reported retryable even when the retry verdict disagrees", async () => {
  const jev = withJev(verdict("subscription_required", 0.9, 0.85, 0.9));
  try {
    expect(await judgeAdapterFailure("Upgrade to ChatGPT Pro to unlock Pro mode.")).toMatchObject({
      httpStatus: 403,
      error: { code: "subscription_required" },
      retryable: false,
    });
  } finally {
    jev.restore();
  }
});

async function* failing(event: AdapterEvent): AsyncGenerator<AdapterEvent> {
  yield event;
}

test("bridge streams the Jev-refined error for message-only adapter failures and keeps adapter codes authoritative", async () => {
  const jev = withJev(verdict("context_length_exceeded", 0.95, 0.02, 0.9));
  try {
    const messageOnly = await new Response(bridgeToResponsesSSE(
      failing({ type: "error", message: "Message length exceeds limit. Please shorten your message." }),
      "chatgpt-web/test", undefined, undefined, undefined, undefined, 2_000,
    )).text();
    expect(messageOnly).toContain('"code":"context_length_exceeded"');
    expect(messageOnly).toContain('"retryable":false');

    const explicit = await new Response(bridgeToResponsesSSE(
      failing({ type: "error", message: "Message length exceeds limit.", status: 502, errorType: "server_error", code: "upstream_server_error", retryable: true }),
      "chatgpt-web/test", undefined, undefined, undefined, undefined, 2_000,
    )).text();
    expect(explicit).toContain('"code":"upstream_server_error"');
    expect(explicit).toContain('"retryable":true');
    expect(jev.calls()).toBe(1);
  } finally {
    jev.restore();
  }
});
