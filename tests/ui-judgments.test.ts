import { afterEach, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { throwIfChatGptSessionFailureAlert } from "../src/adapters/chatgpt-web/browser-worker";
import {
  learnStoppedThinkingLabels,
  learnedStoppedThinkingLabels,
  resetChatGptUiJudgmentsForTests,
  throwIfChatGptJudgedFailureDialog,
  visibleChatGptDialogTexts,
} from "../src/adapters/chatgpt-web/ui-judgments";
import { configureJudgeForTests } from "../src/lib/judge";

type FakeAnswers = Record<string, unknown>;

function withJev(answer: (questions: Record<string, unknown>) => FakeAnswers, enabled = true) {
  const seen: string[] = [];
  const restore = configureJudgeForTests({
    enabled,
    apiKey: () => "test-key",
    evaluate: (async (options: { state: Record<string, unknown>; questions: Record<string, unknown> }) => {
      seen.push(JSON.stringify(options.state));
      return { answers: answer(options.questions), usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 } };
    }) as never,
  });
  return { restore, seen };
}

const choice = (kind: string, p = 0.9) => ({
  kind: { type: "choice", choice: kind, probabilities: { [kind]: p, unrelated_ui: 1 - p } },
});

/** Fake page: exact locale regexes see `dialogTexts` too, so a miss there is a real miss. */
function fakePage(dialogTexts: string[]): Page {
  const text = dialogTexts.join("\n");
  const locator = {
    filter: (options: { hasText?: string | RegExp; visible?: boolean }) => {
      if (options.visible) return { allInnerTexts: async () => dialogTexts };
      const hasText = options.hasText;
      const matches = typeof hasText === "string" ? text.includes(hasText) : hasText?.test(text) ?? true;
      return matches ? locator : { filter: () => ({ last: () => ({ isVisible: async () => false }) }), last: () => ({ isVisible: async () => false }) };
    },
    last: () => ({ isVisible: async () => dialogTexts.length > 0 }),
  };
  return { locator: () => locator } as unknown as Page;
}

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
  resetChatGptUiJudgmentsForTests();
});

test("a confidently judged error dialog becomes a structured adapter failure with the dialog excerpt", async () => {
  const jev = withJev(() => choice("usage_cap"));
  restore = jev.restore;
  const cap = "You've reached your Plus plan limit for GPT-5.6 Pro. Your limit resets at 3:15 PM.";

  await expect(throwIfChatGptJudgedFailureDialog(fakePage([cap]))).rejects.toMatchObject({
    name: "ChatGptWebAdapterError",
    status: 429,
    errorType: "rate_limit_error",
    code: "rate_limit_exceeded",
    retryable: false,
    message: `ChatGPT showed: "${cap}" Wait for the limit to reset or switch models.`,
  });
});

test("non-error, uncertain, and code-owned dialogs never interrupt the turn", async () => {
  const jev = withJev(questions => "kind" in questions ? choice("tool_confirmation") : {});
  restore = jev.restore;

  await throwIfChatGptJudgedFailureDialog(fakePage(["Share this conversation with a link"]));
  await throwIfChatGptJudgedFailureDialog(fakePage(["Allow ChatGPT to use codex-jev?"]));
  await throwIfChatGptJudgedFailureDialog(fakePage(["Not in history · No model training · Memory off"]));
  expect(jev.seen).toHaveLength(1);
  expect(jev.seen[0]).toContain("Share this conversation");

  jev.restore();
  restore = withJev(() => choice("expired_session", 0.55)).restore;
  await throwIfChatGptJudgedFailureDialog(fakePage(["Please log in again"]));
});

test("the judged fallback never touches the page while Jev is disabled", async () => {
  restore = withJev(() => choice("generic_error"), false).restore;
  const untouchable = { locator: () => { throw new Error("page must not be read"); } } as unknown as Page;

  expect(await visibleChatGptDialogTexts(untouchable)).toEqual([]);
  await throwIfChatGptJudgedFailureDialog(untouchable);
});

test("throwIfChatGptSessionFailureAlert falls through to Jev only after the exact regexes miss", async () => {
  const jev = withJev(() => choice("expired_session"));
  restore = jev.restore;

  await expect(throwIfChatGptSessionFailureAlert(fakePage(["Your session has expired. Please log in again to continue using the app."]))).rejects.toMatchObject({
    code: "chatgpt_session_expired",
  });
  expect(jev.seen).toHaveLength(0);

  await expect(throwIfChatGptSessionFailureAlert(fakePage(["Sesión finalizada. Vuelve a iniciar sesión para continuar."]))).rejects.toMatchObject({
    status: 401,
    code: "chatgpt_session_expired",
    retryable: false,
  });
  expect(jev.seen).toHaveLength(1);
});

test("unknown short status labels are judged once, off the critical path, and confirmed labels are learned", async () => {
  const jev = withJev(() => ({ stopped: { type: "boolean", probability: 0.96 } }));
  restore = jev.restore;
  const novel = "Ha dejado de razonar";

  learnStoppedThinkingLabels(["Stopped thinking", novel, "x".repeat(49), "Thinking about the failing test and how the fixture", novel]);
  expect(learnedStoppedThinkingLabels.size).toBe(0);
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(jev.seen).toHaveLength(1);
  expect(jev.seen[0]).toContain(novel);
  expect([...learnedStoppedThinkingLabels]).toEqual([novel]);

  learnStoppedThinkingLabels([novel]);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(jev.seen).toHaveLength(1);
});

test("an ordinary progress status is not learned as a stopped label", async () => {
  restore = withJev(() => ({ stopped: { type: "boolean", probability: 0.03 } })).restore;

  learnStoppedThinkingLabels(["Analizando la solicitud"]);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(learnedStoppedThinkingLabels.size).toBe(0);
});
