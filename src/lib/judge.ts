import { createHash } from "node:crypto";
import { experimental_evaluate as evaluate } from "ai";

/**
 * Jev (TypeSafe System One) wrapper for the ChatGPT Jev daemon.
 *
 * Contract shared by every call site:
 * - Jev judges meaning; exact facts, authorization and schemas stay in code.
 * - Missing, failed or uncertain decisions stop explicitly; no heuristic fallback.
 * - One retry within a hard deadline; identical inputs can reuse a logged Jev verdict.
 * - Privacy: the gateway key lives only in this daemon process (never the Electron renderer);
 *   `onJudgeEvent` receives probabilities and ids only, never the judged content.
 */
export const JEV_MODEL = "typesafe-ai/jev";
/** Total judgment budget: enough room for a brief gateway outage to clear instead of failing a turn. */
export const JEV_TIMEOUT_MS = 20_000;
/** Attempts inside one budget: bounded patience, never an unbounded retry loop. */
export const JEV_MAX_RECOVERY_ATTEMPTS = 3;
/** Polite pause between attempts; grows by this step per attempt. */
export const JEV_RETRY_BASE_DELAY_MS = 500;
/** Floor on the time a retry attempt must still have to be started. */
export const JEV_RETRY_MIN_REMAINING_MS = 250;
export const JEV_API_KEY_ENV = "AI_GATEWAY_API_KEY";
/** Choice is accepted when the top option has at least this probability ... */
export const CHOICE_MIN_PROBABILITY = 0.7;
/** ... and beats the runner-up by at least this margin. */
export const CHOICE_MIN_MARGIN = 0.3;
/** Noul (boolean) verdicts: p >= YES is "yes", p <= NO is "no", anything between is "unsure". */
export const NOUL_YES = 0.7;
export const NOUL_NO = 0.3;
const CACHE_MAX_ENTRIES = 512;

type EvaluateArgs = Parameters<typeof evaluate>[0];
export type JudgeState = EvaluateArgs["state"];
export type JudgeQuestions = EvaluateArgs["questions"];
export type JudgeAnswers<Q extends JudgeQuestions> = Awaited<ReturnType<typeof evaluate<Q>>>["answers"];
export type ChoiceAnswer<C extends string = string> = { choice: C; probabilities?: Record<C, number> };
export type BooleanAnswer = { probability: number };
export type ScoreAnswer = { score: number; probabilities?: Record<string, number> };

export class JevDecisionError extends Error {
  readonly status = 503;
  readonly errorType = "server_error";
  readonly code = "jev_decision_required";
  readonly retryable = false;

  constructor(readonly site: string, readonly detail: string, readonly recoverable = false) {
    super(`Jev is required at ${site}: ${detail}. No heuristic fallback was used.`);
    this.name = "JevDecisionError";
  }
}

export interface JudgeEvent {
  /** Caller-chosen id naming the decision site, e.g. "adapter_error". */
  site: string;
  outcome: "answered" | "cached" | "disabled" | "failed" | "timeout" | "recovering";
  elapsedMs: number;
  attempt?: number;
  maxAttempts?: number;
  /** Probabilities only (no judged content). */
  answers?: Record<string, unknown>;
  inputTokens?: number;
  error?: string;
}

export interface JudgeDependencies {
  evaluate: typeof evaluate;
  enabled: boolean;
  apiKey: () => string | undefined;
  timeoutMs: number;
  /** Delay before retry attempt N (1-based) when the failure looks transient. */
  retryDelayMs: (attempt: number) => number;
  onEvent: (event: JudgeEvent) => void;
  now: () => number;
}

const deps: JudgeDependencies = {
  evaluate,
  // `bun test` sets NODE_ENV=test: the suite must never reach the live gateway.
  enabled: process.env.NODE_ENV !== "test",
  apiKey: () => process.env[JEV_API_KEY_ENV]?.trim() || undefined,
  timeoutMs: JEV_TIMEOUT_MS,
  retryDelayMs: attempt => JEV_RETRY_BASE_DELAY_MS * attempt,
  onEvent: () => {},
  now: () => performance.now(),
};

const cache = new Map<string, Record<string, unknown>>();

/** Legacy callers may enable Jev, but cannot disable required decisions. */
export function setJudgeEnabled(enabled: boolean): void {
  if (!enabled) throw new JevDecisionError("configuration", "judgments cannot be disabled");
  if (process.env.NODE_ENV !== "test") deps.enabled = true;
}

/** Route safe-log events (probabilities only) to the daemon logger. */
export function onJudgeEvent(listener: (event: JudgeEvent) => void): void {
  deps.onEvent = listener;
}

/** True when a key is present; independent of the runtime switch (doctor reports both). */
export function judgeConfigured(): boolean {
  return Boolean(deps.apiKey());
}

export function judgeEnabled(): boolean {
  return deps.enabled && judgeConfigured();
}

/** Test seam: swap the evaluate implementation / clock; returns a restore function. */
export function configureJudgeForTests(overrides: Partial<JudgeDependencies>): () => void {
  const previous = { ...deps };
  Object.assign(deps, overrides);
  cache.clear();
  return () => {
    Object.assign(deps, previous);
    cache.clear();
  };
}

function cacheKey(site: string, state: JudgeState, questions: JudgeQuestions): string {
  return createHash("sha256").update(JSON.stringify([site, state, questions])).digest("hex");
}

function probabilitiesOnly(answers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, answer] of Object.entries(answers)) {
    const a = answer as Partial<ChoiceAnswer & BooleanAnswer & ScoreAnswer>;
    out[id] = a.probability !== undefined
      ? { probability: round(a.probability) }
      : a.score !== undefined
        ? { score: round(a.score) }
        : { choice: a.choice, probabilities: a.probabilities ? mapValues(a.probabilities, round) : undefined };
  }
  return out;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function mapValues<T, U>(record: Record<string, T>, f: (value: T) => U): Record<string, U> {
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, f(v)]));
}

/**
 * Ask Jev one batch of independent questions over shared state.
 * Resolves to typed answers or rejects with an explicit decision failure.
 */
export async function judge<const Q extends JudgeQuestions>(
  site: string,
  state: JudgeState,
  questions: Q,
  { timeoutMs = deps.timeoutMs, signal, validate }: {
    timeoutMs?: number;
    signal?: AbortSignal;
    validate?: (answers: JudgeAnswers<Q>) => void;
  } = {},
): Promise<JudgeAnswers<Q>> {
  signal?.throwIfAborted();
  const started = deps.now();
  const apiKey = deps.apiKey();
  if (!deps.enabled || !apiKey) {
    const error = new JevDecisionError(site, !apiKey
      ? `configure ${JEV_API_KEY_ENV} before continuing`
      : "judgments cannot be disabled");
    deps.onEvent({ site, outcome: "failed", elapsedMs: 0, error: error.message });
    throw error;
  }
  const key = cacheKey(site, state, questions);
  const cached = cache.get(key);
  if (cached) {
    try {
      validate?.(cached as JudgeAnswers<Q>);
      cache.delete(key);
      cache.set(key, cached);
      deps.onEvent({ site, outcome: "cached", elapsedMs: deps.now() - started, answers: probabilitiesOnly(cached) });
      return cached as JudgeAnswers<Q>;
    } catch (error) {
      if (!(error instanceof JevDecisionError)) throw error;
      cache.delete(key);
    }
  }
  const maxAttempts = validate ? JEV_MAX_RECOVERY_ATTEMPTS : 1;
  for (let attempt = 1; ; attempt += 1) {
    signal?.throwIfAborted();
    // The budget is total: each attempt draws down the same deadline, so retries
    // can never exceed the caller's ceiling. A hopeless remainder is not started.
    const remainingMs = Math.max(1, timeoutMs - (deps.now() - started));
    if (attempt > 1 && remainingMs < JEV_RETRY_MIN_REMAINING_MS) {
      const error = new JevDecisionError(site, `timed out after ${timeoutMs}ms; retry the operation`, true);
      deps.onEvent({ site, outcome: "timeout", elapsedMs: deps.now() - started, error: error.message });
      throw error;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    let validating = false;
    const deadline = new Promise<never>((_resolve, reject) => {
      cancel = () => {
        controller.abort(signal?.reason);
        reject(signal?.reason);
      };
      signal?.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(() => {
        controller.abort();
        reject(new JevDecisionError(site, `timed out after ${timeoutMs}ms; retry the operation`, true));
      }, remainingMs);
    });
    // A settled race leaves the deadline promise pending until the budget fires;
    // swallow that late rejection so it can never surface as unhandled.
    deadline.catch(() => {});
    if (attempt > 1) {
      // Grace period: a polite pause before retrying, capped at half the remaining
      // budget so a tight caller ceiling still leaves room for the next attempt,
      // and immediately responsive to caller cancellation.
      let delayTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          deadline,
          new Promise<void>(settle => { delayTimer = setTimeout(settle, Math.min(deps.retryDelayMs(attempt - 1), Math.floor(remainingMs / 2))); }),
        ]);
      } finally {
        clearTimeout(delayTimer);
      }
      signal?.throwIfAborted();
    }
    try {
      const result = await Promise.race([
        deadline,
        Promise.resolve().then(() => deps.evaluate({
          model: JEV_MODEL,
          state,
          questions,
          maxRetries: 1,
          abortSignal: controller.signal,
        })),
      ]);
      signal?.throwIfAborted();
      validating = true;
      validate?.(result.answers);
      signal?.throwIfAborted();
      const answers = result.answers as Record<string, unknown>;
      cache.set(key, answers);
      if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
      deps.onEvent({
        site,
        outcome: "answered",
        elapsedMs: deps.now() - started,
        answers: probabilitiesOnly(answers),
        inputTokens: result.usage.inputTokens,
      });
      return result.answers;
    } catch (cause) {
      if (signal?.aborted) {
        deps.onEvent({ site, outcome: "failed", elapsedMs: deps.now() - started, error: "The owning operation cancelled its required Jev judgment" });
        throw signal.reason;
      }
      if (validating && !(cause instanceof JevDecisionError)) throw cause;
      const error = new JevDecisionError(site, validating && cause instanceof JevDecisionError
        ? cause.detail
        : controller.signal.aborted
          ? `timed out after ${timeoutMs}ms; retry the operation`
          : "the gateway request failed; check Jev availability and retry the operation", true);
      deps.onEvent({
        site,
        outcome: attempt < maxAttempts ? "recovering" : controller.signal.aborted ? "timeout" : "failed",
        elapsedMs: deps.now() - started,
        attempt,
        maxAttempts,
        error: error.message,
      });
      if (attempt >= maxAttempts) throw error;
    } finally {
      clearTimeout(timer);
      if (cancel) signal?.removeEventListener("abort", cancel);
    }
  }
}

/** Require a probable choice clearly separated from the runner-up. */
export function confidentChoice<C extends string>(
  answer: ChoiceAnswer<C> | undefined,
  { minProbability = CHOICE_MIN_PROBABILITY, minMargin = CHOICE_MIN_MARGIN } = {},
): C {
  if (!answer) throw new JevDecisionError("choice", "the answer is missing");
  const probabilities = answer.probabilities;
  if (!probabilities) throw new JevDecisionError("choice", "the probabilities are missing");
  const sorted = Object.entries(probabilities).sort(([, a], [, b]) => (b as number) - (a as number));
  const top = sorted[0];
  if (!top) throw new JevDecisionError("choice", "the probabilities are empty");
  const [choice, p] = top as [C, number];
  const runnerUp = (sorted[1]?.[1] as number | undefined) ?? 0;
  if (!Number.isFinite(p) || !Number.isFinite(runnerUp) || p < minProbability || p - runnerUp < minMargin) {
    throw new JevDecisionError("choice", "the answer is uncertain; clarify the input and retry");
  }
  return choice;
}

/** Require a decisive yes/no probability. */
export function confidentBoolean(
  answer: BooleanAnswer | undefined,
  { yes = NOUL_YES, no = NOUL_NO } = {},
): boolean {
  if (!answer || !Number.isFinite(answer.probability)) throw new JevDecisionError("boolean", "the probability is missing or invalid");
  if (answer.probability >= yes) return true;
  if (answer.probability <= no) return false;
  throw new JevDecisionError("boolean", "the answer is uncertain; clarify the input and retry");
}

/** Score answers are probability-weighted positions on the ordered levels; round to the nearest level. */
export function nearestScoreLevel(answer: ScoreAnswer | undefined, levelCount: number): number {
  if (!answer || !Number.isFinite(answer.score) || levelCount < 1) throw new JevDecisionError("score", "the score is missing or invalid");
  return Math.min(levelCount - 1, Math.max(0, Math.round(answer.score)));
}
