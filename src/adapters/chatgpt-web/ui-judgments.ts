import { CHATGPT_STOPPED_THINKING_LABELS } from "./ui-labels";
import { ChatGptWebAdapterError, chatGptStoppedThinkingError } from "./adapter-error";
import { CHATGPT_ACCOUNT_LIMIT_ADVICE, noteChatGptAccountLimited } from "./concurrency";
import { confidentBoolean, confidentChoice, judge, JevDecisionError } from "../../lib/judge";

/**
 * Jev-backed UI judgments for ChatGPT alerts, dialogs, and terminal status labels that the exact
 * locale regexes in browser-worker.ts do not know yet. Missing, failed or uncertain semantic
 * judgments stop explicitly. Exact protocol matches remain authoritative.
 */

const DIALOG_KINDS = {
  rate_limit: "Too many requests / sending messages too quickly; a temporary cooldown that clears in minutes.",
  usage_cap: "A plan usage limit or message cap was reached; it resets at a stated time or after upgrading.",
  account_temporarily_limited: "The account is temporarily limited, paused, or in a cooldown because of unusual activity or too many simultaneous conversations; not a suspension and not a plan cap.",
  expired_session: "The login session expired or the user must sign in again.",
  subscription_failure: "The app could not load the account subscription or plan details.",
  account_limited: "The account is suspended, deactivated, restricted, or blocked for policy or region reasons.",
  context_too_long: "The message or conversation is too long for the model.",
  generic_error: "Something went wrong with no more specific cause; retrying is suggested.",
  tool_confirmation: "Asks the user to allow or deny a tool, app, or connector action.",
  temporary_chat_notice: "Explains a temporary chat: not in history, no training, memory off.",
  unrelated_ui: "Any other UI: settings, model pickers, onboarding tips, sharing, feedback, upsell banners, or ordinary content.",
} as const;

type DialogKind = keyof typeof DIALOG_KINDS;

const DIALOG_FAILURES: Partial<Record<DialogKind, { status: number; errorType: string; code: string; retryable: boolean; hint: string }>> = {
  rate_limit: { status: 429, errorType: "rate_limit_error", code: "rate_limit_exceeded", retryable: true, hint: "Try again in a few minutes." },
  usage_cap: { status: 429, errorType: "rate_limit_error", code: "rate_limit_exceeded", retryable: false, hint: "Wait for the limit to reset or switch models." },
  account_temporarily_limited: { status: 429, errorType: "rate_limit_error", code: "account_temporarily_limited", retryable: false, hint: `Stop starting turns until the cooldown clears. ${CHATGPT_ACCOUNT_LIMIT_ADVICE}` },
  expired_session: { status: 401, errorType: "authentication_error", code: "chatgpt_session_expired", retryable: false, hint: "Sign in again in ChatGPT Jev." },
  subscription_failure: { status: 503, errorType: "server_error", code: "chatgpt_subscription_unavailable", retryable: true, hint: "Reload ChatGPT inside the launcher and retry." },
  account_limited: { status: 403, errorType: "permission_error", code: "permission_denied", retryable: false, hint: "Check the account status in the ChatGPT tab." },
  context_too_long: { status: 400, errorType: "invalid_request_error", code: "context_length_exceeded", retryable: false, hint: "Run /compact or shorten the task, then retry." },
  generic_error: { status: 502, errorType: "server_error", code: "upstream_server_error", retryable: true, hint: "Retry the turn." },
};

const MAX_DIALOG_TEXT = 1_500;
const DIALOG_JUDGE_TIMEOUT_MS = 1_500;

export interface ChatGptDialogTextSource {
  locator(selector: string): {
    filter(options: { visible: boolean }): { allInnerTexts(): Promise<string[]> };
  };
}

/** Read visible alerts and dialogs; a failed read is not evidence that no dialog exists. */
export async function visibleChatGptDialogTexts(
  page: ChatGptDialogTextSource,
  selector = '[role="alert"], [role="dialog"]',
): Promise<string[]> {
  try {
    const texts = await page.locator(selector).filter({ visible: true }).allInnerTexts();
    return texts.map(text => text.replace(/\s+/g, " ").trim()).filter(Boolean);
  } catch {
    throw new JevDecisionError("chatgpt_dialog", "the page could not be read; retry the operation");
  }
}

export async function judgeChatGptDialog(text: string): Promise<DialogKind | undefined> {
  const answers = await judge("chatgpt_dialog", {
    dialog_text: text.slice(0, MAX_DIALOG_TEXT),
    source: "Visible text of a ChatGPT web UI alert or dialog while a coding-agent turn was running. The exact known rate-limit, expired-session, and subscription alerts have already been ruled out.",
  }, {
    kind: { type: "choice", instructions: "What is this dialog?", criteria: DIALOG_KINDS },
  }, { timeoutMs: DIALOG_JUDGE_TIMEOUT_MS });
  return confidentChoice(answers?.kind);
}

/** Throw a structured failure when Jev confidently recognises an error dialog the exact regexes missed. */
export async function throwIfChatGptJudgedFailureDialog(page: ChatGptDialogTextSource): Promise<void> {
  for (const text of await visibleChatGptDialogTexts(page)) {
    const kind = await judgeChatGptDialog(text);
    const failure = kind && DIALOG_FAILURES[kind];
    if (!failure) continue;
    // Item 11: the account limit is per account, not per turn; clamp concurrency for every caller.
    if (kind === "account_temporarily_limited") noteChatGptAccountLimited();
    const excerpt = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    throw new ChatGptWebAdapterError(`ChatGPT showed: "${excerpt}" ${failure.hint}`, failure);
  }
}

const knownStoppedLabels = new Set<string>(CHATGPT_STOPPED_THINKING_LABELS);
/** Labels Jev confirmed at runtime; fed back into the browser-side exact match on the next scan. */
export const learnedStoppedThinkingLabels = new Set<string>();
const judgedStatusLabels = new Set<string>();
const STATUS_LABEL_BATCH_SIZE = 32;
const MAX_JUDGED_LABELS = 512;

const normalizeLabel = (value: string): string => value.replace(/\s+/g, " ").trim();

/**
 * Await every unknown status judgment before continuing observation. Successful judgments are
 * remembered for identical labels; failures are never cached as permission to continue.
 */
export async function learnStoppedThinkingLabels(statusTexts: readonly string[]): Promise<void> {
  const labels = [...new Set(statusTexts.map(normalizeLabel))].filter(label => label
    && !knownStoppedLabels.has(label) && !learnedStoppedThinkingLabels.has(label) && !judgedStatusLabels.has(label));
  for (let offset = 0; offset < labels.length; offset += STATUS_LABEL_BATCH_SIZE) {
    const batch = labels.slice(offset, offset + STATUS_LABEL_BATCH_SIZE);
    const answers = await judge("stopped_thinking_labels", {
      labels: batch,
      source: "Status labels rendered by the ChatGPT web UI inside an assistant turn, in the account's language.",
    }, Object.fromEntries(batch.map((_label, index) => [`label_${index}`, {
      type: "boolean" as const,
      instructions: `Does labels[${index}] state that thinking or reasoning stopped or was interrupted, rather than ongoing work or an answer being completed?`,
    }])));
    const verdicts = batch.map((_label, index) => confidentBoolean(answers[`label_${index}`]));
    batch.forEach((label, index) => {
      if (judgedStatusLabels.size >= MAX_JUDGED_LABELS) judgedStatusLabels.clear();
      judgedStatusLabels.add(label);
      if (verdicts[index]) learnedStoppedThinkingLabels.add(label);
    });
  }
}

export async function judgeStoppedThinkingLabel(label: string): Promise<boolean | undefined> {
  const answers = await judge("stopped_thinking_label", {
    status_label: label,
    known_examples: ["Stopped thinking", "Denken gestoppt", "思考を停止しました"],
    source: "A short status label rendered by the ChatGPT web UI inside an assistant turn, in the account's language.",
  }, {
    stopped: {
      type: "boolean",
      instructions: "`status_label` states that the model's thinking/reasoning was stopped or interrupted (a terminal state), not that it is thinking, searching, working, or done answering.",
    },
  });
  return confidentBoolean(answers?.stopped);
}

/** Test hook. */
export function resetChatGptUiJudgmentsForTests(): void {
  learnedStoppedThinkingLabels.clear();
  judgedStatusLabels.clear();
}

// ---------------------------------------------------------------------------------------------
// Item 6: what is a turn that has shown no completion for a minute or more actually doing?

export const STALL_KINDS = {
  still_generating: "ChatGPT is still working: thinking, searching, running a tool, or streaming text; status labels describe ongoing activity.",
  stopped_by_ui: "Generation was stopped or interrupted by the UI (a stopped/interrupted status, a regenerate prompt) without an error message.",
  errored: "ChatGPT reported a failure for this turn: something went wrong, a network or server error, or a request to retry.",
  rate_limited: "The turn was blocked by a rate limit, cooldown, or usage cap.",
  login_lost: "The session is no longer authenticated; the UI asks the user to log in or sign up.",
  unknown: "The evidence does not say what is happening.",
} as const;

export type StallKind = keyof typeof STALL_KINDS;

export interface StalledTurnEvidence {
  elapsedSec: number;
  running: boolean;
  completionActionVisible: boolean;
  statusTexts: readonly string[];
  overlayTexts: readonly string[];
  answerTail: string;
}

export const MAX_STALL_ANSWER_TAIL = 400;
const MAX_STALL_TEXTS = 12;
const STALL_JUDGE_TIMEOUT_MS = 2_500;

export async function judgeStalledTurn(evidence: StalledTurnEvidence): Promise<StallKind | undefined> {
  const answers = await judge("stalled_turn", {
    seconds_without_completion: Math.round(evidence.elapsedSec),
    stop_button_visible: evidence.running,
    completed_turn_actions_visible: evidence.completionActionVisible,
    status_labels: evidence.statusTexts.slice(-MAX_STALL_TEXTS).map(normalizeLabel).filter(Boolean),
    overlays: evidence.overlayTexts.slice(-MAX_STALL_TEXTS).map(text => normalizeLabel(text).slice(0, 300)).filter(Boolean),
    answer_tail: evidence.answerTail.slice(-MAX_STALL_ANSWER_TAIL),
    source: "A ChatGPT web turn driven by a coding agent has not completed for a while. The evidence is what the page shows right now; the exact known error dialogs and stopped-thinking labels have already been ruled out.",
  }, {
    kind: { type: "choice", instructions: "What is this turn doing?", criteria: STALL_KINDS },
  }, { timeoutMs: STALL_JUDGE_TIMEOUT_MS });
  return confidentChoice(answers?.kind);
}

/**
 * Continue only when Jev says the turn is still generating. Unknown state is reported explicitly;
 * a stale stop button does not override a completed semantic judgment.
 */
export async function stalledTurnFailure(evidence: StalledTurnEvidence): Promise<ChatGptWebAdapterError | undefined> {
  const kind = await judgeStalledTurn(evidence);
  if (kind === "still_generating") return undefined;
  if (!kind || kind === "unknown") throw new JevDecisionError("stalled_turn", "the turn state is uncertain; inspect the ChatGPT page");
  const excerpt = [...evidence.overlayTexts, ...evidence.statusTexts].map(normalizeLabel).filter(Boolean).join(" | ").slice(0, 200);
  const shown = excerpt ? ` ChatGPT showed: "${excerpt}".` : "";
  switch (kind) {
    case "stopped_by_ui":
      return chatGptStoppedThinkingError();
    case "errored":
      return new ChatGptWebAdapterError(`ChatGPT reported an error before completing the turn.${shown} Retry the turn.`, DIALOG_FAILURES.generic_error!);
    case "rate_limited":
      return new ChatGptWebAdapterError(`ChatGPT rate-limited this turn.${shown} ${DIALOG_FAILURES.rate_limit!.hint}`, DIALOG_FAILURES.rate_limit!);
    case "login_lost":
      return new ChatGptWebAdapterError(`ChatGPT lost its login during the turn.${shown} ${DIALOG_FAILURES.expired_session!.hint}`, DIALOG_FAILURES.expired_session!);
  }
}

// Item 5: the DOM-position rule decides commentary vs answer. When it leaves a finished turn with
// no answer root at all while commentary Markdown exists, Jev breaks the tie; a confident DOM result
// (any answer root) is never overridden.

export const ANSWER_ROOT_KINDS = {
  final_answer: "The assistant's actual reply to the request: the deliverable, result, explanation, or decision the user asked for.",
  intermediate_commentary: "Progress narration or planning while working ('Let me check the file', 'Now I'll run the tests'), not the reply itself.",
  tool_status: "A tool or search status line such as 'Searched the web', 'Ran command', 'Reading files', 'Thought for 12s'.",
  embedded_ui_chrome: "Widget or interface text: button labels, menu items, chart axes, loading placeholders, footers.",
} as const;

export type AnswerRootKind = keyof typeof ANSWER_ROOT_KINDS;

export const MAX_PROMOTION_CANDIDATES = 4;
const PROMOTION_JUDGE_TIMEOUT_MS = 3_000;

/**
 * Returns the normalized text of the last commentary root Jev confidently reads as the final
 * answer, or undefined. Every nonempty root is judged in bounded batches.
 */
export async function judgeAnswerRootPromotion(commentaryTexts: readonly string[]): Promise<string | undefined> {
  const candidates = commentaryTexts.map(normalizeLabel).filter(Boolean);
  let promoted: string | undefined;
  for (let offset = 0; offset < candidates.length; offset += MAX_PROMOTION_CANDIDATES) {
    const blocks = candidates.slice(offset, offset + MAX_PROMOTION_CANDIDATES).map((text, index) => ({ index: offset + index, text }));
    const questions = Object.fromEntries(blocks.map(({ index }) => [
      `root_${index}`,
      { type: "choice", instructions: `What is Markdown block ${index} (0-based, in page order)?`, criteria: ANSWER_ROOT_KINDS },
    ] as const)) as Record<string, { type: "choice"; instructions: string; criteria: typeof ANSWER_ROOT_KINDS }>;
    const answers = await judge("answer_root_promotion", {
      turn_finished: true,
      blocks,
      source: "ChatGPT finished generating (stop button gone) but the page shows only Markdown blocks the DOM rule classified as intermediate commentary; no block is positioned as the final answer. Decide what each block really is.",
    }, questions, { timeoutMs: PROMOTION_JUDGE_TIMEOUT_MS });
    for (const block of blocks) {
      if (confidentChoice(answers[`root_${block.index}`]) === "final_answer") promoted = block.text;
    }
  }
  return promoted;
}

// Item 12: when the composer is missing, say what the page is actually showing instead of the
// generic "no visible composer" line.

export const LOGIN_STATES = {
  login_form: "An email/password or 'Log in / Sign up' form, or the marketing landing page shown to signed-out visitors.",
  mfa_prompt: "A one-time code, authenticator, SMS, or email verification step after entering credentials.",
  passkey_only: "A passkey or security-key prompt (Touch ID, Windows Hello, 'Use your passkey') with no password option shown.",
  captcha_challenge: "A CAPTCHA, 'verify you are human', Cloudflare, or unusual-traffic challenge.",
  onboarding: "A welcome, terms-acceptance, cookie, or plan-selection screen shown to a signed-in user before the chat.",
  composer_ready: "The normal signed-in chat with the message composer visible.",
  unknown: "Anything else: an error page, a blank or still-loading page, or a different product.",
} as const;

export type LoginState = keyof typeof LOGIN_STATES;

const LOGIN_GUIDANCE: Partial<Record<LoginState, string>> = {
  login_form: "ChatGPT is signed out. Run the browser login again and sign in.",
  mfa_prompt: "ChatGPT is waiting for a verification code. Finish the two-factor step in the login window, then retry.",
  passkey_only: "ChatGPT wants a passkey. Complete the passkey prompt in the login window (or choose another sign-in method on chatgpt.com), then retry.",
  captcha_challenge: "ChatGPT shows a human-verification challenge. Solve it in the login window, then retry.",
  onboarding: "ChatGPT shows a welcome or consent screen. Dismiss it in the login window until the composer appears, then retry.",
  composer_ready: "The composer exists but ChatGPT Jev could not find it; the ChatGPT DOM may have changed. Update ChatGPT Jev or report the issue.",
};

const MAX_LOGIN_PAGE_TEXT = 2_500;
const LOGIN_JUDGE_TIMEOUT_MS = 2_500;

export interface ChatGptLoginPageSource {
  url(): string;
  evaluate<T>(pageFunction: () => T): Promise<T>;
}

/** Required guidance for a page without a composer; unreadable or uncertain state stops explicitly. */
export async function describeChatGptLoginState(page: ChatGptLoginPageSource): Promise<string | undefined> {
  const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
  const url = (() => { try { return page.url(); } catch { return ""; } })();
  if (!text.trim() && !url) throw new JevDecisionError("chatgpt_login_state", "the page could not be read");
  const answers = await judge("chatgpt_login_state", {
    url: url.replace(/\?.*$/, ""),
    page_text: normalizeLabel(text).slice(0, MAX_LOGIN_PAGE_TEXT),
    source: "Visible text of a chatgpt.com page opened by an automation that expected the signed-in chat composer but did not find it.",
  }, {
    state: { type: "choice", instructions: "What is this page showing?", criteria: LOGIN_STATES },
  }, { timeoutMs: LOGIN_JUDGE_TIMEOUT_MS });
  const state = confidentChoice(answers?.state);
  if (state === "unknown") throw new JevDecisionError("chatgpt_login_state", "the page state is uncertain; inspect the login window");
  return LOGIN_GUIDANCE[state];
}
