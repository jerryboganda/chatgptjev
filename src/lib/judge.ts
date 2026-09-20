import { createHash } from "node:crypto";
import { experimental_evaluate as evaluate } from "ai";

/**
 * Jev (TypeSafe System One) wrapper for the ChatGPT Jev daemon.
 *
 * Contract shared by every call site:
 * - Jev judges *meaning* of free text / DOM text; exact facts (status codes, counters, schemas)
 *   stay in code. Callers always keep their existing heuristic as the fallback.
 * - Fail-open: any disabled/missing-key/timeout/provider error resolves to `undefined`.
 * - Bounded latency: one request per event, `JEV_TIMEOUT_MS` hard cap.
 * - Privacy: the gateway key lives only in this daemon process (never the Electron renderer);
 *   `onJudgeEvent` receives probabilities and ids only, never the judged content.
 */
export const JEV_MODEL = "typesafe-ai/jev";
/** Default per-request budget. A cold gateway round-trip measured ~1.3 s; hot paths pass a tighter value. */
export const JEV_TIMEOUT_MS = 2500;
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

export interface JudgeEvent {
  /** Caller-chosen id naming the decision site, e.g. "adapter_error". */
  site: string;
  outcome: "answered" | "cached" | "disabled" | "failed" | "timeout";
  elapsedMs: number;
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
  onEvent: (event: JudgeEvent) => void;
  now: () => number;
}

const deps: JudgeDependencies = {
  evaluate,
  // `bun test` sets NODE_ENV=test: the suite must never reach the live gateway.
  enabled: process.env.NODE_ENV !== "test",
  apiKey: () => process.env[JEV_API_KEY_ENV]?.trim() || undefined,
  timeoutMs: JEV_TIMEOUT_MS,
  onEvent: () => {},
  now: () => performance.now(),
};

const cache = new Map<string, Record<string, unknown>>();

/** Runtime switch (config `jevEnabled`, launcher toggle). Defaults to on. */
export function setJudgeEnabled(enabled: boolean): void {
  deps.enabled = enabled;
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
 * Resolves to the typed answers, or `undefined` when the caller must use its own heuristic.
 */
export async function judge<const Q extends JudgeQuestions>(
  site: string,
  state: JudgeState,
  questions: Q,
  { timeoutMs = deps.timeoutMs }: { timeoutMs?: number } = {},
): Promise<JudgeAnswers<Q> | undefined> {
  const started = deps.now();
  const apiKey = deps.apiKey();
  if (!deps.enabled || !apiKey) {
    deps.onEvent({ site, outcome: "disabled", elapsedMs: 0 });
    return undefined;
  }
  const key = cacheKey(site, state, questions);
  const cached = cache.get(key);
  if (cached) {
    // LRU: re-insert so the most recently used entry is evicted last.
    cache.delete(key);
    cache.set(key, cached);
    deps.onEvent({ site, outcome: "cached", elapsedMs: deps.now() - started, answers: probabilitiesOnly(cached) });
    return cached as JudgeAnswers<Q>;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Model id strings resolve through the AI Gateway provider, which reads the key from
    // `AI_GATEWAY_API_KEY` in this process; the key never leaves the daemon.
    const result = await deps.evaluate({
      model: JEV_MODEL,
      state,
      questions,
      maxRetries: 0,
      abortSignal: controller.signal,
    });
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
  } catch (error) {
    const aborted = controller.signal.aborted;
    deps.onEvent({
      site,
      outcome: aborted ? "timeout" : "failed",
      elapsedMs: deps.now() - started,
      error: aborted ? `timeout after ${timeoutMs}ms` : error instanceof Error ? error.message : String(error),
    });
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Top choice when it is both probable and clearly separated from the runner-up; else `undefined`. */
export function confidentChoice<C extends string>(
  answer: ChoiceAnswer<C> | undefined,
  { minProbability = CHOICE_MIN_PROBABILITY, minMargin = CHOICE_MIN_MARGIN } = {},
): C | undefined {
  if (!answer) return undefined;
  const probabilities = answer.probabilities;
  if (!probabilities) return undefined;
  const sorted = Object.entries(probabilities).sort(([, a], [, b]) => (b as number) - (a as number));
  const top = sorted[0];
  if (!top) return undefined;
  const [choice, p] = top as [C, number];
  const runnerUp = (sorted[1]?.[1] as number | undefined) ?? 0;
  if (p < minProbability || p - runnerUp < minMargin) return undefined;
  return choice;
}

/** Noul verdict: true / false when the probability is decisive, `undefined` when it is not. */
export function confidentBoolean(
  answer: BooleanAnswer | undefined,
  { yes = NOUL_YES, no = NOUL_NO } = {},
): boolean | undefined {
  if (!answer || !Number.isFinite(answer.probability)) return undefined;
  if (answer.probability >= yes) return true;
  if (answer.probability <= no) return false;
  return undefined;
}

/** Score answers are probability-weighted positions on the ordered levels; round to the nearest level. */
export function nearestScoreLevel(answer: ScoreAnswer | undefined, levelCount: number): number | undefined {
  if (!answer || !Number.isFinite(answer.score) || levelCount < 1) return undefined;
  return Math.min(levelCount - 1, Math.max(0, Math.round(answer.score)));
}
