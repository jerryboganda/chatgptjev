import { CHATGPT_STOPPED_THINKING_LABELS } from "./ui-labels";
import { ChatGptWebAdapterError } from "./adapter-error";
import { confidentBoolean, confidentChoice, judge, judgeConfigured, judgeEnabled } from "../../lib/judge";

/**
 * Jev-backed UI judgments for ChatGPT alerts, dialogs, and terminal status labels that the exact
 * locale regexes in browser-worker.ts do not know yet. Everything here is fail-open: no verdict,
 * no change in behaviour. Exact matches in code always run first and stay authoritative.
 */

const DIALOG_KINDS = {
  rate_limit: "Too many requests / sending messages too quickly; a temporary cooldown that clears in minutes.",
  usage_cap: "A plan usage limit or message cap was reached; it resets at a stated time or after upgrading.",
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
  expired_session: { status: 401, errorType: "authentication_error", code: "chatgpt_session_expired", retryable: false, hint: "Sign in again in ChatGPT Jev." },
  subscription_failure: { status: 503, errorType: "server_error", code: "chatgpt_subscription_unavailable", retryable: true, hint: "Reload ChatGPT inside the launcher and retry." },
  account_limited: { status: 403, errorType: "permission_error", code: "permission_denied", retryable: false, hint: "Check the account status in the ChatGPT tab." },
  context_too_long: { status: 400, errorType: "invalid_request_error", code: "context_length_exceeded", retryable: false, hint: "Run /compact or shorten the task, then retry." },
  generic_error: { status: 502, errorType: "server_error", code: "upstream_server_error", retryable: true, hint: "Retry the turn." },
};

/** Dialogs the worker drives itself; never let a judgment interrupt them. */
const CODE_OWNED_DIALOG = /Allow ChatGPT to use|Not in history/i;
const MAX_DIALOG_TEXT = 1_500;
const DIALOG_JUDGE_TIMEOUT_MS = 1_500;

export interface ChatGptDialogTextSource {
  locator(selector: string): {
    filter(options: { visible: boolean }): { allInnerTexts(): Promise<string[]> };
  };
}

/** Visible alert/dialog text, or `[]` when unavailable (closed page, fake page, no judge). */
export async function visibleChatGptDialogTexts(page: ChatGptDialogTextSource): Promise<string[]> {
  if (!judgeEnabled() || !judgeConfigured()) return [];
  try {
    const texts = await page.locator('[role="alert"], [role="dialog"]').filter({ visible: true }).allInnerTexts();
    return texts.map(text => text.replace(/\s+/g, " ").trim()).filter(text => text && !CODE_OWNED_DIALOG.test(text));
  } catch {
    return [];
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
    const excerpt = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    throw new ChatGptWebAdapterError(`ChatGPT showed: "${excerpt}" ${failure.hint}`, failure);
  }
}

const knownStoppedLabels = new Set<string>(CHATGPT_STOPPED_THINKING_LABELS);
/** Labels Jev confirmed at runtime; fed back into the browser-side exact match on the next scan. */
export const learnedStoppedThinkingLabels = new Set<string>();
const judgedStatusLabels = new Set<string>();
const MAX_STATUS_LABEL_LENGTH = 48;
const MAX_JUDGED_LABELS = 512;

const normalizeLabel = (value: string): string => value.replace(/\s+/g, " ").trim();

/**
 * Fire-and-forget: ask Jev whether unknown short status labels mean "the model stopped thinking".
 * Runs off the observation loop's critical path; a confirmed label is picked up by the next DOM scan.
 */
export function learnStoppedThinkingLabels(statusTexts: readonly string[]): void {
  if (!judgeEnabled() || !judgeConfigured()) return;
  for (const raw of statusTexts) {
    const label = normalizeLabel(raw);
    if (!label || label.length > MAX_STATUS_LABEL_LENGTH || knownStoppedLabels.has(label)
      || learnedStoppedThinkingLabels.has(label) || judgedStatusLabels.has(label)) continue;
    if (judgedStatusLabels.size >= MAX_JUDGED_LABELS) judgedStatusLabels.clear();
    judgedStatusLabels.add(label);
    void judgeStoppedThinkingLabel(label).then(stopped => {
      if (stopped) learnedStoppedThinkingLabels.add(label);
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
