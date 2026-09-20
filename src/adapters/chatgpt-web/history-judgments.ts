import type { CodexMessage, CodexParsedRequest } from "../../types";
import { judge, nearestScoreLevel } from "../../lib/judge";
import {
  compileChatGptWebPrompt,
  isCompactionCheckpointMessage,
  withoutSupersededModelSwitchContracts,
  type CompileChatGptWebPromptOptions,
  type CompiledChatGptWebPrompt,
} from "./prompt";
import type { ChatGptWebCapabilities } from "./model";

/**
 * Item 16: relevance-guided compaction trimming. When a compaction prompt exceeds the browser
 * byte budget, `compileChatGptWebPrompt` already drops history records (whole records, never
 * split) oldest-first, protecting the newest cumulative checkpoint and the final compaction
 * instruction. Jev only changes *which* records go first: the ones whose loss would cost the
 * checkpoint summary the least. Byte accounting, protections, and the omission notice stay in
 * code; a failed Jev decision stops compaction without discarding history.
 */

/** Loss levels, least costly first (Jev score = 0-based level index). */
export const HISTORY_LOSS_LEVELS = [
  "Nothing: redundant with the cumulative checkpoint, pure noise, or a superseded intermediate result.",
  "Little: minor detail that a good summary would leave out anyway.",
  "Some: useful evidence or context the summary would otherwise have to hedge about.",
  "Much: a key requirement, decision, result, or blocker the summary must carry forward.",
  "Everything: the summary cannot be written correctly without this record.",
] as const;

/** Maximum records per batch; every unprotected record is ranked. */
export const MAX_RANKED_HISTORY_RECORDS = 40;
const MAX_RECORD_TEXT = 600;
const HISTORY_JUDGE_TIMEOUT_MS = 4_000;

function recordText(message: CodexMessage): string {
  const content = message.content;
  const text = typeof content === "string"
    ? content
    : content.map(part => part.type === "text" ? part.text : part.type === "image" ? "[image]" : `[${part.type}]`).join("\n");
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > MAX_RECORD_TEXT ? `${trimmed.slice(0, MAX_RECORD_TEXT)}…` : trimmed;
}

/**
 * Indexes into `messages`, least valuable first. Protected checkpoints and final instructions
 * are never returned; missing or failed judgments stop compaction.
 */
export async function rankCompactionDiscardOrder(
  messages: readonly CodexMessage[],
  protectedIndexes: readonly number[],
): Promise<number[]> {
  const protectedSet = new Set(protectedIndexes);
  const candidates = messages
    .map((message, index) => ({ index, message }))
    .filter(({ index }) => !protectedSet.has(index));
  const finalInstruction = messages[messages.length - 1];
  const ranked: Array<{ index: number; level: number }> = [];
  for (let offset = 0; offset < candidates.length; offset += MAX_RANKED_HISTORY_RECORDS) {
    const batch = candidates.slice(offset, offset + MAX_RANKED_HISTORY_RECORDS);
    const questions = Object.fromEntries(batch.map(({ index }) => [
      `record_${index}`,
      { type: "score", instructions: `How much would the checkpoint summary lose if record ${index} were omitted?`, criteria: HISTORY_LOSS_LEVELS },
    ] as const)) as Record<string, { type: "score"; instructions: string; criteria: typeof HISTORY_LOSS_LEVELS }>;
    const answers = await judge("compaction_history_relevance", {
      compaction_instruction: finalInstruction ? recordText(finalInstruction) : "",
      records: batch.map(({ index, message }) => ({ index, role: message.role, text: recordText(message) })),
      source: "A coding agent's conversation history must be summarised into a checkpoint, but it does not fit the browser message budget, so whole records have to be dropped before summarising. Rate each record by how much the summary would lose without it.",
    }, questions, { timeoutMs: HISTORY_JUDGE_TIMEOUT_MS });
    ranked.push(...batch.map(({ index }) => ({ index, level: nearestScoreLevel(answers[`record_${index}`], HISTORY_LOSS_LEVELS.length) })));
  }
  // Stable: equal loss falls back to the upstream order (older first).
  return ranked.sort((a, b) => a.level - b.level || a.index - b.index).map(entry => entry.index);
}

/** Indexes the compaction trimmer never discards: the newest readable checkpoint and the final instruction. */
export function protectedCompactionIndexes(messages: readonly CodexMessage[], isCheckpoint: (message: CodexMessage) => boolean): number[] {
  const checkpointIndex = messages.findLastIndex(isCheckpoint);
  return checkpointIndex >= 0 ? [checkpointIndex, messages.length - 1] : [messages.length - 1];
}

/**
 * Compile like `compileChatGptWebPrompt`, but when a compaction prompt had to trim history, ask Jev
 * which records to give up first and compile once more with that order. Non-compaction requests
 * and prompts that fit are returned from the first pass untouched.
 */
export async function compileChatGptWebPromptWithRelevanceTrimming(
  parsed: CodexParsedRequest,
  capabilities: ChatGptWebCapabilities,
  turnToken?: string,
  options?: CompileChatGptWebPromptOptions,
): Promise<CompiledChatGptWebPrompt> {
  const first = compileChatGptWebPrompt(parsed, capabilities, turnToken, options);
  if (!parsed._compactionRequest || !first.trimmedCompactionMessages) return first;
  const messages = withoutSupersededModelSwitchContracts(parsed.context.messages);
  const order = await rankCompactionDiscardOrder(messages, protectedCompactionIndexes(messages, isCompactionCheckpointMessage));
  const second = compileChatGptWebPrompt(parsed, capabilities, turnToken, { ...options, compactionDiscardOrder: order });
  console.warn(`[chatgpt-jev] compaction trimming dropped ${second.trimmedCompactionMessages ?? 0} record(s) in Jev relevance order instead of oldest-first`);
  return second;
}
