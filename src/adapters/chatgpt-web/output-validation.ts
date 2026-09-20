import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type { CodexJsonSchemaOutputFormat } from "../../types";
import { confidentChoice, judge, JevDecisionError } from "../../lib/judge";
import { ChatGptWebAdapterError } from "./adapter-error";

/** Returns the answer to emit: the original when it validates, or a repaired equivalent. */
export type ChatGptStructuredOutputValidator = (answer: string) => Promise<string>;

function validationError(message: string, retryable = false): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(message, {
    status: 502,
    errorType: "server_error",
    code: "structured_output_validation_failed",
    retryable,
  });
}

// Item 14: strict-schema failures used to be terminal. Code now extracts deterministic
// candidates (fenced blocks, balanced JSON spans) and revalidates them against the same schema;
// Jev only breaks ties between several valid candidates and triages an unrepairable failure.

export const FAILURE_KINDS = {
  fenced_json: "The JSON is wrapped in Markdown code fences or quoted as a code block.",
  trailing_prose: "Valid JSON is present but surrounded by explanation, notes, or a preamble.",
  truncated: "The JSON stops mid-way: unbalanced braces or brackets, an unterminated string, a cut-off value.",
  semantically_wrong: "The output is complete JSON but has the wrong shape, keys, or types for the schema, or answers a different question.",
  not_json: "The output is prose, a refusal, or a question back to the user with no JSON at all.",
} as const;

export type StructuredOutputFailureKind = keyof typeof FAILURE_KINDS;

/** Formatting and truncation are transient model slips worth one retry; wrong content is not. */
const RETRYABLE_KINDS: ReadonlySet<StructuredOutputFailureKind> = new Set(["fenced_json", "trailing_prose", "truncated"]);

function fencedBlocks(answer: string): string[] {
  return [...answer.matchAll(/```[a-zA-Z0-9_-]*[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/g)].map(match => match[1]!.trim());
}

/** Every balanced top-level `{...}` / `[...]` span, longest first, respecting JSON strings. */
function balancedJsonSpans(answer: string): string[] {
  const spans: string[] = [];
  const stack: string[] = [];
  let start = -1;
  let inString = false;
  for (let index = 0; index < answer.length; index += 1) {
    const char = answer[index]!;
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { if (stack.length) inString = true; continue; }
    if (char === "{" || char === "[") {
      if (stack.length === 0) start = index;
      stack.push(char === "{" ? "}" : "]");
    } else if (char === "}" || char === "]") {
      if (stack.length === 0 || stack[stack.length - 1] !== char) { stack.length = 0; start = -1; continue; }
      stack.pop();
      if (stack.length === 0 && start >= 0) spans.push(answer.slice(start, index + 1));
    }
  }
  return spans.sort((a, b) => b.length - a.length);
}

export function structuredOutputCandidates(answer: string): string[] {
  const seen = new Set<string>([answer.trim()]);
  const candidates: string[] = [];
  for (const candidate of [...fencedBlocks(answer), ...balancedJsonSpans(answer)]) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
  }
  return candidates;
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

async function pickIntendedCandidate(schemaName: string, answer: string, valid: string[]): Promise<string> {
  const criteria = {
    ...Object.fromEntries(valid.map((candidate, index) => [`candidate_${index}`, candidate])),
    none: "None of these candidates is an unambiguous intended final answer; they are examples, quoted input, or incomplete alternatives.",
  };
  const answers = await judge("structured_output_candidate", {
    schema_name: schemaName,
    full_answer: answer,
    source: "A coding agent asked ChatGPT for one JSON document matching a strict schema. The listed JSON spans validate; identify the intended final answer, not an example, a before/after comparison, or quoted input.",
  }, {
    intended: { type: "choice", instructions: "Which candidate is the intended final JSON answer?", criteria },
  });
  const pick = confidentChoice(answers.intended);
  const index = /^candidate_\d+$/.test(pick) ? Number(pick.slice("candidate_".length)) : NaN;
  if (!Number.isInteger(index) || valid[index] === undefined) {
    throw new JevDecisionError("structured_output_candidate", "no intended candidate was identified; request a single JSON answer");
  }
  return valid[index]!;
}

export async function judgeStructuredOutputFailure(
  schemaName: string,
  answer: string,
  detail: string | undefined,
): Promise<StructuredOutputFailureKind> {
  const answers = await judge("structured_output_failure", {
    schema_name: schemaName,
    validator_detail: detail ?? null,
    answer,
    source: "ChatGPT's answer to a coding agent that required strict-schema JSON failed validation even after stripping code fences and extracting balanced JSON spans.",
  }, {
    failure_kind: { type: "choice", instructions: "Why did this answer fail?", criteria: FAILURE_KINDS },
  });
  return confidentChoice(answers?.failure_kind);
}

export function createChatGptStructuredOutputValidator(
  format: CodexJsonSchemaOutputFormat | undefined,
): ChatGptStructuredOutputValidator | undefined {
  if (!format?.strict) return undefined;

  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
    validateFormats: true,
  });
  addFormats(ajv);

  let validate: ValidateFunction;
  try {
    validate = ajv.compile(format.schema as object | boolean);
  } catch (cause) {
    throw new ChatGptWebAdapterError(
      `Codex supplied an invalid strict JSON schema ${JSON.stringify(format.name)}: ${cause instanceof Error ? cause.message : String(cause)}`,
      {
        status: 400,
        errorType: "invalid_request_error",
        code: "invalid_output_schema",
        retryable: false,
      },
    );
  }
  const schemaName = JSON.stringify(format.name);

  return async (answer: string): Promise<string> => {
    const parsed = parseJson(answer);
    if (parsed.ok && validate(parsed.value)) return answer;
    const detail = parsed.ok ? ajv.errorsText(validate.errors, { separator: "; " }) : undefined;

    const valid = structuredOutputCandidates(answer).filter(candidate => {
      const attempt = parseJson(candidate);
      return attempt.ok && validate(attempt.value);
    });
    if (valid.length > 0) {
      const repaired = await pickIntendedCandidate(format.name, answer, valid);
      console.warn(`[chatgpt-web] structured output for ${schemaName} repaired: extracted valid JSON from ${answer.length} chars (${valid.length} valid candidate${valid.length === 1 ? "" : "s"})`);
      return repaired;
    }

    const kind = await judgeStructuredOutputFailure(format.name, answer, detail);
    const why = ` (${kind.replace(/_/g, " ")})`;
    const retryable = RETRYABLE_KINDS.has(kind);
    if (!parsed.ok) {
      throw validationError(`ChatGPT Web returned malformed JSON for strict Codex output schema ${schemaName}${why}`, retryable);
    }
    throw validationError(
      `ChatGPT Web returned JSON that does not satisfy strict Codex output schema ${schemaName}${why}${detail ? `: ${detail}` : ""}`,
      retryable,
    );
  };
}
