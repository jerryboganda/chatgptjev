/**
 * ChatGPT Web concurrency is deliberately bounded. Every active Codex turn owns a real
 * browser document in the signed-in account, so unbounded fan-out would create account-level
 * traffic that is indistinguishable from spam.
 */
export const MAX_CHATGPT_BROWSER_TABS = 5;

/**
 * Item 11: after ChatGPT reports the account temporarily limited, hold concurrency at one browser
 * turn until the cooldown clears instead of letting spawned agents keep hitting the limit.
 */
export const CHATGPT_ACCOUNT_LIMIT_COOLDOWN_MS = 15 * 60_000;
export const CHATGPT_ACCOUNT_LIMIT_ADVICE = "Set `max_concurrent_threads_per_session = 1` under `[agents]` in ~/.codex/config.toml to stay under the limit.";

let accountLimitedUntil = 0;

export function noteChatGptAccountLimited(now = Date.now()): void {
  accountLimitedUntil = Math.max(accountLimitedUntil, now + CHATGPT_ACCOUNT_LIMIT_COOLDOWN_MS);
}

export function chatGptAccountLimitedUntil(now = Date.now()): number | undefined {
  return now < accountLimitedUntil ? accountLimitedUntil : undefined;
}

export function resetChatGptAccountLimitForTests(): void {
  accountLimitedUntil = 0;
}

/** Error to throw when a new browser turn would exceed the current ceiling, or undefined. */
export function chatGptBrowserTabCeilingError(active: number, now = Date.now()): Error | undefined {
  const limitedUntil = chatGptAccountLimitedUntil(now);
  if (limitedUntil !== undefined && active >= 1) {
    const minutes = Math.max(1, Math.ceil((limitedUntil - now) / 60_000));
    return new Error(
      `ChatGPT reported this account temporarily limited; ChatGPT Jev allows one browser turn at a time for the next ${minutes} min. ${CHATGPT_ACCOUNT_LIMIT_ADVICE}`,
    );
  }
  if (active >= MAX_CHATGPT_BROWSER_TABS) {
    return new Error(
      `ChatGPT Web supports at most ${MAX_CHATGPT_BROWSER_TABS} simultaneous browser turns; close or finish a browser tab before starting another`,
    );
  }
  return undefined;
}
