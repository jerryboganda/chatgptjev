import { afterEach, expect, test } from "bun:test";
import { ChatGptWebAdapterError } from "../src/adapters/chatgpt-web/adapter-error";
import {
  createChatGptStructuredOutputValidator,
  structuredOutputCandidates,
} from "../src/adapters/chatgpt-web/output-validation";
import { configureJudgeForTests } from "../src/lib/judge";

type FakeAnswers = Record<string, unknown>;

function withJev(answer: (questions: Record<string, unknown>, state: Record<string, unknown>) => FakeAnswers, enabled = true) {
  const calls: Array<{ state: Record<string, unknown>; questions: Record<string, unknown> }> = [];
  const restore = configureJudgeForTests({
    enabled,
    apiKey: () => "test-key",
    evaluate: (async (options: { state: Record<string, unknown>; questions: Record<string, unknown> }) => {
      calls.push({ state: options.state, questions: options.questions });
      return { answers: answer(options.questions, options.state), usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 } };
    }) as never,
  });
  return { restore, calls };
}

let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });

const schema = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
} as const;

const validator = () => createChatGptStructuredOutputValidator({ type: "json_schema", name: "payload", strict: true, schema })!;

async function failure(promise: Promise<unknown>): Promise<ChatGptWebAdapterError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ChatGptWebAdapterError) return error;
    throw error;
  }
  throw new Error("expected the validator to reject");
}

test("candidate extraction prefers fenced blocks, then balanced spans longest first, and never echoes the whole answer", () => {
  const answer = 'Before {"a":[1,2]} middle ```json\n{"ok":true}\n``` after {"b":"}"}';
  expect(structuredOutputCandidates(answer)).toEqual(['{"ok":true}', '{"a":[1,2]}', '{"b":"}"}']);
  expect(structuredOutputCandidates('{"ok":true}')).toEqual([]);
  expect(structuredOutputCandidates('{"ok":true,"count":')).toEqual([]);
});

test("without Jev, ambiguous candidates and semantic failure triage stop explicitly", async () => {
  const validate = validator();
  await expect(validate('Old: {"ok":false}\nNew: {"ok":true}')).rejects.toThrow(/Jev/);
  await expect(validate('{"ok":"nope"}')).rejects.toThrow(/Jev/);
  expect(await validate('{"ok":true}')).toBe('{"ok":true}');
});

test("Jev picks the intended candidate when the answer contains several valid JSON spans", async () => {
  const jev = withJev(questions => {
    const criteria = (questions.intended as { criteria: Record<string, string> }).criteria;
    expect(Object.keys(criteria)).toEqual(["candidate_0", "candidate_1", "none"]);
    return { intended: { type: "choice", choice: "candidate_0", probabilities: { candidate_0: 0.92, candidate_1: 0.08 } } };
  });
  restore = jev.restore;
  const validate = validator();
  expect(await validate('Final answer: {"ok":false}\n\nFor comparison the old value was {"ok":true}')).toBe('{"ok":false}');
  expect(jev.calls).toHaveLength(1);
  expect(jev.calls[0]!.state.schema_name).toBe("payload");
});

test("an uncertain candidate verdict cannot substitute the last candidate", async () => {
  restore = withJev(() => ({
    intended: { type: "choice", choice: "candidate_0", probabilities: { candidate_0: 0.55, candidate_1: 0.45 } },
  })).restore;
  await expect(validator()('{"ok":false} or {"ok":true}')).rejects.toThrow(/Jev.*uncertain/);
});

test("a single extracted example still needs semantic approval and later candidates are not dropped", async () => {
  const jev = withJev(() => ({ intended: { type: "choice", choice: "none", probabilities: { none: 0.95, candidate_0: 0.05 } } }));
  restore = jev.restore;
  await expect(validator()('This is only an example: {"ok":true}')).rejects.toThrow(/Jev.*candidate/);
  expect(jev.calls).toHaveLength(1);
  expect(structuredOutputCandidates(Array.from({ length: 8 }, (_, index) => `{"value":${index}}`).join(" or "))).toHaveLength(8);
});

test("Jev triages an unrepairable failure: formatting or truncation is retryable, wrong content is not", async () => {
  const kind = (choice: string, p = 0.9) => () => ({
    failure_kind: { type: "choice", choice, probabilities: { [choice]: p, not_json: 1 - p } },
  });
  const validate = validator();

  restore = withJev(kind("truncated")).restore;
  const truncated = await failure(validate('{"ok":tr'));
  expect(truncated.retryable).toBe(true);
  expect(truncated.message).toContain("malformed JSON");
  expect(truncated.message).toContain("(truncated)");
  restore();

  restore = withJev(kind("semantically_wrong")).restore;
  const wrong = await failure(validate('{"ok":1}'));
  expect(wrong.retryable).toBe(false);
  expect(wrong.message).toContain("(semantically wrong)");
  expect(wrong.message).toContain("must be boolean");
  restore();

  restore = withJev(kind("truncated", 0.5)).restore;
  await expect(validate('{"ok":tr')).rejects.toThrow(/Jev.*uncertain/);
  restore();

  const throwing = configureJudgeForTests({
    enabled: true,
    apiKey: () => "test-key",
    evaluate: (async () => { throw new Error("gateway down"); }) as never,
  });
  restore = throwing;
  await expect(validate('{"ok":tr')).rejects.toThrow(/Jev.*failed/);
});

test("a disabled judge reports an explicit failure rather than an unjudged triage result", async () => {
  const jev = withJev(() => ({ failure_kind: { type: "choice", choice: "truncated", probabilities: { truncated: 0.95 } } }), false);
  restore = jev.restore;
  await expect(validator()('{"ok":tr')).rejects.toThrow(/Jev.*disabled/);
  expect(jev.calls).toHaveLength(0);
});
