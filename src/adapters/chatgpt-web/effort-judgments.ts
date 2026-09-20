import type { CodexMessage } from "../../types";
import { judge, nearestScoreLevel } from "../../lib/judge";

/**
 * Item 13: effort-tier recommendation. The routed model fixes the effort ChatGPT runs with, so this
 * never changes a route. It only logs a suggestion when Jev rates the request far easier or far
 * harder than the routed tier, so the user can pick a cheaper or stronger `chatgpt-web/*` model.
 */

export const EFFORT_TIERS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortTier = (typeof EFFORT_TIERS)[number];

const TIER_LABELS: Record<EffortTier, string> = { low: "Instant", medium: "Medium", high: "High", xhigh: "Extra High", max: "Pro" };
/** Public Codex model slugs, in `EFFORT_TIERS` order. */
const TIER_MODELS: Record<EffortTier, string> = { low: "chatgpt-web/light", medium: "chatgpt-web/medium", high: "chatgpt-web/high", xhigh: "chatgpt-web/extra-high", max: "chatgpt-web/pro" };

/** One difficulty level per tier, in `EFFORT_TIERS` order (Jev score = 0-based level index). */
export const REQUEST_DIFFICULTY_LEVELS = [
  "Trivial: a one-line answer, a rename, a typo fix, a quick lookup, or a yes/no question.",
  "Simple: a small, well-specified change or explanation confined to one place.",
  "Moderate: multi-step work touching several places that needs some investigation or design.",
  "Hard: subtle debugging, architecture decisions, ambiguous requirements, or a large refactor.",
  "Very hard: deep research, novel algorithms, complex concurrency or security reasoning, or a long autonomous task.",
] as const;

/** Suggest only when the gap is this many tiers or more; adjacent tiers are a judgment call. */
export const EFFORT_SUGGESTION_MIN_GAP = 2;
const EFFORT_SUGGESTION_COOLDOWN_MS = 10 * 60_000;
const MAX_REQUEST_TEXT = 2_000;
const EFFORT_JUDGE_TIMEOUT_MS = 3_000;

const lastSuggestedAt = new Map<string, number>();

export function resetEffortSuggestionsForTests(): void {
  lastSuggestedAt.clear();
}

/** Text of the newest user message (skills, tool results, and agent traffic are not the request). */
export function latestUserRequestText(messages: readonly CodexMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "user" || message.origin === "codex_skill") continue;
    const text = typeof message.content === "string"
      ? message.content
      : message.content.filter(part => part.type === "text").map(part => part.text).join("\n");
    if (text.trim()) return text.trim();
  }
  return "";
}

/**
 * Returns the suggestion line to log, or undefined for a suitable tier or a duplicate notification.
 * A failed Jev judgment stops the request.
 */
export async function suggestEffortTier(
  messages: readonly CodexMessage[],
  routed: EffortTier,
  now = Date.now(),
): Promise<string | undefined> {
  const request = latestUserRequestText(messages);
  if (!request) return undefined;
  const answers = await judge("effort_tier", {
    request: request.length > MAX_REQUEST_TEXT ? `${request.slice(0, MAX_REQUEST_TEXT)}…` : request,
    prior_turns: messages.length,
    source: "The newest user request sent to a coding agent that runs on ChatGPT with a fixed reasoning-effort tier. Rate how much reasoning effort the request itself needs.",
  }, {
    difficulty: { type: "score", instructions: "How difficult is this request?", criteria: REQUEST_DIFFICULTY_LEVELS },
  }, { timeoutMs: EFFORT_JUDGE_TIMEOUT_MS });
  const level = nearestScoreLevel(answers.difficulty, REQUEST_DIFFICULTY_LEVELS.length);
  const recommended = EFFORT_TIERS[level]!;
  const gap = level - EFFORT_TIERS.indexOf(routed);
  if (Math.abs(gap) < EFFORT_SUGGESTION_MIN_GAP) return undefined;
  const key = `${routed}->${recommended}`;
  const last = lastSuggestedAt.get(key);
  if (last !== undefined && now - last < EFFORT_SUGGESTION_COOLDOWN_MS) return undefined;
  lastSuggestedAt.set(key, now);
  const difficulty = REQUEST_DIFFICULTY_LEVELS[level]!.split(":")[0]!.toLowerCase();
  return gap < 0
    ? `this request looks ${difficulty}; ${TIER_MODELS[recommended]} (${TIER_LABELS[recommended]}) would likely finish faster and use less of your ChatGPT quota than the routed ${TIER_LABELS[routed]}`
    : `this request looks ${difficulty}; ${TIER_MODELS[recommended]} (${TIER_LABELS[recommended]}) would likely do better than the routed ${TIER_LABELS[routed]}`;
}
