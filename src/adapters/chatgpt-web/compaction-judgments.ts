import { confidentBoolean, judge, judgeConfigured, judgeEnabled, nearestScoreLevel } from "../../lib/judge";
import type { CodexMessage, CodexParsedRequest } from "../../types";
import { LATEST_USER_PROMPT_MARKER } from "./compaction-handoff";
import { extractChatGptCompactionSourceRevision } from "./environment";

/** Ordered Score levels (index 0 = worst). Jev returns a fractional position between them. */
export const COMPACTION_COMPLETENESS_LEVELS = [
  "Unusable: empty, a refusal, a reply to the conversation instead of a summary of it, or a summary of some other task.",
  "Thin: names the task but drops decisions, file paths, constraints, verified results, or open items the next turn would need.",
  "Adequate: task, decisions and current state are present with only minor gaps.",
  "Complete: task, decisions, constraints, file paths, verified results and remaining work are all carried forward.",
] as const;

export interface CompactionHandoffVerdict {
  /** False only when Jev is confident the summary would lose the thread; fail-open otherwise. */
  acceptable: boolean;
  completeness?: number;
  preservesLatestUserRequest?: boolean;
  introducesContradiction?: boolean;
  reasons: string[];
}

export const MIN_ACCEPTABLE_COMPLETENESS = 1;
export const MAX_SUMMARY_CHARS = 6000;
export const MAX_TRANSCRIPT_TAIL_CHARS = 6000;
export const MAX_LATEST_REQUEST_CHARS = 2000;
/** Compaction is already a slow path; give the three batched verdicts room for a large summary. */
export const COMPACTION_JUDGE_TIMEOUT_MS = 6000;

const ACCEPT: CompactionHandoffVerdict = { acceptable: true, reasons: [] };

function clipEnd(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function clipStart(value: string, max: number): string {
  return value.length <= max ? value : `…${value.slice(value.length - max)}`;
}

function messageText(message: CodexMessage): string {
  const content = message.content;
  if (typeof content === "string") return content;
  return content.flatMap(part => (part.type === "text" ? [part.text] : part.type === "thinking" ? [] : part.type === "toolCall"
    ? [`[tool call ${part.name}(${JSON.stringify(part.arguments)})]`]
    : ["[image]"])).join("\n");
}

/** Role-tagged tail of the conversation being compacted; bounded so the state stays small. */
export function transcriptTail(messages: readonly CodexMessage[], maxChars = MAX_TRANSCRIPT_TAIL_CHARS): string {
  const lines: string[] = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0 && used < maxChars; index -= 1) {
    const message = messages[index]!;
    const text = messageText(message).trim();
    if (!text) continue;
    const role = message.role === "toolResult" ? `tool:${message.toolName}` : message.role;
    const line = `[${role}] ${clipEnd(text, 1200)}`;
    lines.unshift(line);
    used += line.length + 1;
  }
  return clipStart(lines.join("\n"), maxChars);
}

function summaryBody(summary: string): string {
  const offset = summary.lastIndexOf(`\n${LATEST_USER_PROMPT_MARKER}\n`);
  return clipEnd((offset < 0 ? summary : summary.slice(0, offset)).trim(), MAX_SUMMARY_CHARS);
}

function latestUserRequest(parsed: CodexParsedRequest): string | undefined {
  try {
    const content = extractChatGptCompactionSourceRevision(parsed).content;
    const text = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.flatMap(part => {
          const value = part as { type?: unknown; text?: unknown };
          return (value.type === "input_text" || value.type === "text") && typeof value.text === "string" ? [value.text] : [];
        }).join("\n")
        : undefined;
    return text ? clipEnd(text, MAX_LATEST_REQUEST_CHARS) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Item 15: ask Jev whether a compaction summary can carry the conversation forward before the
 * retained ChatGPT conversation is retired. The caller re-summarizes at most once on a reject.
 */
export async function judgeCompactionHandoff(
  parsed: CodexParsedRequest,
  summary: string,
): Promise<CompactionHandoffVerdict> {
  if (!judgeEnabled() || !judgeConfigured()) return ACCEPT;
  const answers = await judge("compaction_handoff", {
    summary: summaryBody(summary),
    latest_user_request: latestUserRequest(parsed) ?? null,
    transcript_tail: transcriptTail(parsed.context.messages),
    source: "A summary ChatGPT wrote to hand a long Codex coding conversation to a fresh context window. The next turn sees only this summary plus the latest user request, so anything missing here is lost.",
  }, {
    completeness: {
      type: "score",
      instructions: "How completely does the summary carry the conversation forward?",
      criteria: COMPACTION_COMPLETENESS_LEVELS,
    },
    preserves_latest_user_request: {
      type: "boolean",
      instructions: "Does the summary preserve what the user most recently asked for, so the next turn can continue it without re-asking?",
    },
    introduces_contradiction: {
      type: "boolean",
      instructions: "Does the summary state something the transcript tail contradicts, such as different files, decisions, results, or task status?",
    },
  }, { timeoutMs: COMPACTION_JUDGE_TIMEOUT_MS });
  if (!answers) return ACCEPT;

  const completeness = nearestScoreLevel(answers.completeness, COMPACTION_COMPLETENESS_LEVELS.length);
  const preservesLatestUserRequest = confidentBoolean(answers.preserves_latest_user_request);
  const introducesContradiction = confidentBoolean(answers.introduces_contradiction);
  const reasons: string[] = [];
  if (completeness !== undefined && completeness < MIN_ACCEPTABLE_COMPLETENESS) {
    reasons.push(`completeness ${completeness}/${COMPACTION_COMPLETENESS_LEVELS.length - 1}`);
  }
  if (preservesLatestUserRequest === false) reasons.push("drops the latest user request");
  if (introducesContradiction === true) reasons.push("contradicts the transcript");
  return {
    acceptable: reasons.length === 0,
    completeness,
    preservesLatestUserRequest,
    introducesContradiction,
    reasons,
  };
}
