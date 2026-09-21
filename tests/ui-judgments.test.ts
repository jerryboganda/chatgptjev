import { afterEach, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { promotedAnswerSegment, throwIfChatGptSessionFailureAlert } from "../src/adapters/chatgpt-web/browser-worker";
import { ChatGptMarkdownBuffer } from "../src/adapters/chatgpt-web/markdown";
import {
  CHATGPT_ACCOUNT_LIMIT_COOLDOWN_MS,
  MAX_CHATGPT_BROWSER_TABS,
  chatGptAccountLimitedUntil,
  chatGptBrowserTabCeilingError,
  noteChatGptAccountLimited,
  resetChatGptAccountLimitForTests,
} from "../src/adapters/chatgpt-web/concurrency";
import {
  MAX_PROMOTION_CANDIDATES,
  describeChatGptLoginState,
  judgeAnswerRootPromotion,
  judgeStoppedThinkingLabel,
  learnStoppedThinkingLabels,
  learnedStoppedThinkingLabels,
  resetChatGptUiJudgmentsForTests,
  stalledTurnFailure,
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
  resetChatGptAccountLimitForTests();
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

test("non-error and approval dialogs are judged, while uncertain dialogs stop explicitly", async () => {
  const jev = withJev(questions => "kind" in questions ? choice("tool_confirmation") : {});
  restore = jev.restore;

  await throwIfChatGptJudgedFailureDialog(fakePage(["Share this conversation with a link"]));
  await throwIfChatGptJudgedFailureDialog(fakePage(["Allow ChatGPT to use codex-jev?"]));
  await throwIfChatGptJudgedFailureDialog(fakePage(["Not in history · No model training · Memory off"]));
  expect(jev.seen).toHaveLength(3);
  expect(jev.seen[0]).toContain("Share this conversation");

  jev.restore();
  restore = withJev(() => choice("expired_session", 0.55)).restore;
  await expect(throwIfChatGptJudgedFailureDialog(fakePage(["Please log in again"]))).rejects.toThrow(/Jev.*uncertain/);
});

test("disabled Jev cannot bypass a visible dialog and an unreadable page is reported", async () => {
  restore = withJev(() => choice("generic_error"), false).restore;
  const untouchable = { locator: () => { throw new Error("page must not be read"); } } as unknown as Page;

  await expect(visibleChatGptDialogTexts(untouchable)).rejects.toThrow(/page/);
  await expect(throwIfChatGptJudgedFailureDialog(fakePage(["A new error occurred"]))).rejects.toThrow(/Jev.*disabled/);
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

test("all unknown status labels are awaited and successful judgments may be reused", async () => {
  const jev = withJev(questions => Object.fromEntries(Object.keys(questions).map((id, index) => [id, { type: "boolean", probability: index === 0 ? 0.96 : 0.02 }])));
  restore = jev.restore;
  const novel = "Ha dejado de razonar";

  await learnStoppedThinkingLabels(["Stopped thinking", novel, "x".repeat(49), "Thinking about the failing test and how the fixture", novel]);

  expect(jev.seen).toHaveLength(1);
  expect(jev.seen[0]).toContain(novel);
  expect(jev.seen[0]).toContain("Thinking about the failing test and how the fixture");
  expect([...learnedStoppedThinkingLabels]).toEqual([novel]);

  await learnStoppedThinkingLabels([novel]);
  expect(jev.seen).toHaveLength(1);
});

test("an ordinary progress status is not learned as a stopped label", async () => {
  restore = withJev(questions => Object.fromEntries(Object.keys(questions).map(id => [id, { type: "boolean", probability: 0.03 }]))).restore;

  await learnStoppedThinkingLabels(["Analizando la solicitud"]);
  expect(learnedStoppedThinkingLabels.size).toBe(0);
});

const stalled = (overrides: Partial<Parameters<typeof stalledTurnFailure>[0]> = {}) => ({
  elapsedSec: 61.4,
  running: false,
  completionActionVisible: false,
  statusTexts: [],
  overlayTexts: [],
  answerTail: "",
  ...overrides,
});

const stallChoice = (kind: string, p = 0.9) => () => ({
  kind: { type: "choice", choice: kind, probabilities: { [kind]: p, unknown: 1 - p } },
});

test("a stalled turn Jev confidently calls over becomes the matching structured failure", async () => {
  const jev = withJev(stallChoice("errored"));
  restore = jev.restore;

  const failure = await stalledTurnFailure(stalled({ overlayTexts: ["Hmm... something seems to have gone wrong."], answerTail: "x".repeat(1000) }));
  expect(failure).toMatchObject({ status: 502, code: "upstream_server_error", retryable: true });
  expect(failure?.message).toContain('ChatGPT showed: "Hmm... something seems to have gone wrong."');
  const state = JSON.parse(jev.seen[0]!) as { answer_tail: string; seconds_without_completion: number; stop_button_visible: boolean };
  expect(state.answer_tail).toHaveLength(400);
  expect(state.seconds_without_completion).toBe(61);
  expect(state.stop_button_visible).toBe(false);

  restore();
  restore = withJev(stallChoice("stopped_by_ui")).restore;
  expect(await stalledTurnFailure(stalled({ statusTexts: ["Generazione interrotta"] }))).toMatchObject({ status: 502, code: "chatgpt_stopped_thinking" });

  restore();
  restore = withJev(stallChoice("rate_limited")).restore;
  expect(await stalledTurnFailure(stalled())).toMatchObject({ status: 429, code: "rate_limit_exceeded", retryable: true });

  restore();
  restore = withJev(stallChoice("login_lost")).restore;
  expect(await stalledTurnFailure(stalled({ running: true, overlayTexts: ["Log in or sign up"] }))).toMatchObject({ status: 401, code: "chatgpt_session_expired" });
});

test("only a generating verdict keeps waiting; uncertain or unavailable judgments stop", async () => {
  restore = withJev(stallChoice("still_generating")).restore;
  expect(await stalledTurnFailure(stalled({ statusTexts: ["Thinking"] }))).toBeUndefined();
  for (const answers of [stallChoice("unknown"), stallChoice("errored", 0.55)]) {
    restore?.();
    restore = withJev(answers).restore;
    await expect(stalledTurnFailure(stalled({ statusTexts: ["Thinking"] }))).rejects.toThrow(/Jev/);
  }

  restore?.();
  restore = withJev(stallChoice("errored")).restore;
  expect(await stalledTurnFailure(stalled({ running: true }))).toMatchObject({ code: "upstream_server_error" });

  restore();
  const off = withJev(stallChoice("errored"), false);
  restore = off.restore;
  await expect(stalledTurnFailure(stalled())).rejects.toThrow(/Jev.*disabled/);
  expect(off.seen).toHaveLength(0);
});

test("a turn completed during review has an explicit Jev outcome before the completion fence", async () => {
  restore = withJev(questions => {
    const criteria = (questions.kind as { criteria: Record<string, string> }).criteria;
    return stallChoice(Object.hasOwn(criteria, "completed") ? "completed" : "unknown")();
  }).restore;
  expect(await stalledTurnFailure(stalled({ running: false, completionActionVisible: true, answerTail: "The task is complete." }))).toBeUndefined();
});

const rootAnswers = (kinds: Record<string, [string, number?]>) => (questions: Record<string, unknown>) =>
  Object.fromEntries(Object.keys(questions).map(key => {
    const [kind, p = 0.9] = kinds[key] ?? ["intermediate_commentary"];
    return [key, { type: "choice", choice: kind, probabilities: { [kind]: p, [kind === "tool_status" ? "intermediate_commentary" : "tool_status"]: 1 - p } }];
  }));

test("a finished turn without an answer root promotes the last commentary block Jev confidently calls the final answer", async () => {
  const jev = withJev(rootAnswers({ root_0: ["final_answer"], root_1: ["intermediate_commentary"], root_2: ["final_answer"] }));
  restore = jev.restore;
  expect(await judgeAnswerRootPromotion(["Let me check the file.", "Running tests now.", "All 12 tests pass; the bug was the off-by-one in paginate()."]))
    .toBe("All 12 tests pass; the bug was the off-by-one in paginate().");
  expect(jev.seen).toHaveLength(1);
  expect(JSON.parse(jev.seen[0]!)).toMatchObject({ turn_finished: true, blocks: [{ index: 0 }, { index: 1 }, { index: 2 }] });

  // Every nonempty block is judged in bounded batches.
  restore();
  const bounded = withJev(rootAnswers({ [`root_${MAX_PROMOTION_CANDIDATES + 2}`]: ["final_answer"] }));
  restore = bounded.restore;
  const many = Array.from({ length: MAX_PROMOTION_CANDIDATES + 3 }, (_, index) => `block ${index}`);
  expect(await judgeAnswerRootPromotion([...many, "   "])).toBe(`block ${MAX_PROMOTION_CANDIDATES + 2}`);
  expect(JSON.parse(bounded.seen[0]!).blocks).toHaveLength(MAX_PROMOTION_CANDIDATES);
  expect(bounded.seen).toHaveLength(2);
});

test("uncertainty and disabled judgments fail explicitly; non-answer verdicts never invent an answer", async () => {
  restore = withJev(rootAnswers({ root_0: ["final_answer", 0.6] })).restore;
  await expect(judgeAnswerRootPromotion(["Almost done."])).rejects.toThrow(/Jev.*uncertain/);

  restore();
  restore = withJev(rootAnswers({ root_0: ["tool_status"], root_1: ["embedded_ui_chrome"] })).restore;
  expect(await judgeAnswerRootPromotion(["Searched the web", "Copy code"])).toBeUndefined();

  restore();
  const off = withJev(rootAnswers({ root_0: ["final_answer"] }), false);
  restore = off.restore;
  await expect(judgeAnswerRootPromotion(["The answer is 42."])).rejects.toThrow(/Jev.*disabled/);
  expect(await judgeAnswerRootPromotion([])).toBeUndefined();
  expect(off.seen).toHaveLength(0);
});

test("a promoted commentary block streams through the Markdown buffer as the completed answer", () => {
  const buffer = new ChatGptMarkdownBuffer();
  const text = "Done.\n\nThe fix is in `paginate()`: use <= instead of <.\nBoth callers & tests updated.";
  const delta = buffer.observe([promotedAnswerSegment(text)]);
  expect(delta).toBe("");
  const final = buffer.finish();
  expect(final.markdown).toBe(final.delta);
  expect(final.markdown).toContain("Done.\n\n");
  expect(final.markdown).toContain("use <= instead of <.");
  expect(final.markdown).toContain("Both callers & tests updated.");
});

const loginPage = (text: string, url = "https://chatgpt.com/auth/login?next=%2F") => ({
  url: () => url,
  evaluate: async <T>(_fn: () => T) => text as unknown as T,
});
const loginChoice = (state: string, p = 0.9) => () => ({
  state: { type: "choice", choice: state, probabilities: { [state]: p, unknown: 1 - p } },
});

for (const scenario of [
  { name: "dialog", run: () => throwIfChatGptJudgedFailureDialog(fakePage(["Review app permissions"])), selected: "tool_confirmation", expected: undefined },
  { name: "status labels", run: () => learnStoppedThinkingLabels(["Continuing the task"]), selected: "unused", expected: undefined },
  { name: "single label", run: () => judgeStoppedThinkingLabel("Continuing the task"), selected: "unused", expected: false },
  { name: "stall", run: () => stalledTurnFailure(stalled({ running: true })), selected: "still_generating", expected: undefined },
  { name: "answer promotion", run: () => judgeAnswerRootPromotion(["The result is ready."]), selected: "final_answer", expected: "The result is ready." },
  { name: "login", run: () => describeChatGptLoginState(loginPage("What can I help with?")), selected: "composer_ready", expected: "The composer exists but ChatGPT Jev could not find it; the ChatGPT DOM may have changed. Update ChatGPT Jev or report the issue." },
]) {
  test(`${scenario.name} recovers from an uncertain answer before consuming a verdict`, async () => {
    let attempts = 0;
    const jev = withJev(questions => {
      attempts += 1;
      return Object.fromEntries(Object.entries(questions).map(([id, question]) => [id,
        (question as { type: string }).type === "boolean"
          ? { type: "boolean", probability: attempts === 1 ? 0.5 : 0.02 }
          : { type: "choice", choice: scenario.selected, probabilities: { [scenario.selected]: attempts === 1 ? 0.55 : 0.95, other: attempts === 1 ? 0.45 : 0.05 } },
      ]));
    });
    restore = jev.restore;
    expect(await scenario.run()).toBe(scenario.expected);
    expect(attempts).toBe(2);
  });
}

test("a composer-less page gets a precise instruction for the screen Jev confidently recognises", async () => {
  const jev = withJev(loginChoice("mfa_prompt"));
  restore = jev.restore;
  expect(await describeChatGptLoginState(loginPage("Enter the 6-digit code from your authenticator app  Resend code")))
    .toContain("verification code");
  // Query strings never reach Jev; the visible text does.
  expect(JSON.parse(jev.seen[0]!)).toMatchObject({ url: "https://chatgpt.com/auth/login", page_text: "Enter the 6-digit code from your authenticator app Resend code" });

  restore();
  restore = withJev(loginChoice("passkey_only")).restore;
  expect(await describeChatGptLoginState(loginPage("Use your passkey  Windows Hello"))).toContain("passkey");

  restore();
  restore = withJev(loginChoice("captcha_challenge")).restore;
  expect(await describeChatGptLoginState(loginPage("Verify you are human"))).toContain("human-verification");

  restore();
  restore = withJev(loginChoice("composer_ready")).restore;
  expect(await describeChatGptLoginState(loginPage("What can I help with?"))).toContain("DOM may have changed");
});

test("unknown, uncertain, unreadable, or unjudged login pages are reported explicitly", async () => {
  restore = withJev(loginChoice("unknown")).restore;
  await expect(describeChatGptLoginState(loginPage("Loading…"))).rejects.toThrow(/Jev/);

  restore();
  restore = withJev(loginChoice("login_form", 0.6)).restore;
  await expect(describeChatGptLoginState(loginPage("Log in  Sign up"))).rejects.toThrow(/Jev.*uncertain/);

  restore();
  const jev = withJev(loginChoice("login_form"));
  restore = jev.restore;
  const unreadable = { url: () => { throw new Error("closed"); }, evaluate: async () => { throw new Error("closed"); } };
  await expect(describeChatGptLoginState(unreadable as never)).rejects.toThrow(/Jev.*page/);
  expect(jev.seen).toHaveLength(0);

  restore();
  const off = withJev(loginChoice("login_form"), false);
  restore = off.restore;
  await expect(describeChatGptLoginState(loginPage("Log in"))).rejects.toThrow(/Jev.*disabled/);
  expect(off.seen).toHaveLength(0);
});

test("a judged account-limit dialog fails the turn with the clamp advice and holds concurrency at one turn", async () => {
  expect(chatGptBrowserTabCeilingError(MAX_CHATGPT_BROWSER_TABS - 1)).toBeUndefined();
  expect(chatGptBrowserTabCeilingError(MAX_CHATGPT_BROWSER_TABS)?.message).toContain(`at most ${MAX_CHATGPT_BROWSER_TABS}`);
  expect(chatGptAccountLimitedUntil()).toBeUndefined();

  restore = withJev(() => choice("account_temporarily_limited")).restore;
  const failure = throwIfChatGptJudgedFailureDialog(fakePage(["Our systems have detected unusual activity. Your account is temporarily limited."]));
  await expect(failure).rejects.toMatchObject({ status: 429, code: "account_temporarily_limited", retryable: false });
  await expect(failure).rejects.toThrow("max_concurrent_threads_per_session = 1");

  const now = Date.now();
  expect(chatGptAccountLimitedUntil(now)).toBeGreaterThan(now);
  expect(chatGptBrowserTabCeilingError(0, now)).toBeUndefined();
  const clamped = chatGptBrowserTabCeilingError(1, now);
  expect(clamped?.message).toContain("one browser turn at a time");
  expect(clamped?.message).toContain("[agents]");
  // The cooldown clears on its own and a repeat report extends it rather than shortening it.
  expect(chatGptBrowserTabCeilingError(1, now + CHATGPT_ACCOUNT_LIMIT_COOLDOWN_MS)).toBeUndefined();
  noteChatGptAccountLimited(now + 60_000);
  expect(chatGptAccountLimitedUntil(now + CHATGPT_ACCOUNT_LIMIT_COOLDOWN_MS)).toBe(now + 60_000 + CHATGPT_ACCOUNT_LIMIT_COOLDOWN_MS);
});

test("ordinary rate-limit dialogs never engage the account-limit clamp", async () => {
  restore = withJev(() => choice("rate_limit")).restore;
  await expect(throwIfChatGptJudgedFailureDialog(fakePage(["Too many requests. Please slow down."]))).rejects.toMatchObject({ status: 429, retryable: true });
  expect(chatGptAccountLimitedUntil()).toBeUndefined();
  expect(chatGptBrowserTabCeilingError(2)).toBeUndefined();
});
