import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";
import { resolveChatGptWebModelMode } from "../src/adapters/chatgpt-web/model";
import { ChatGptExternalTurnProgress } from "../src/adapters/chatgpt-web/turn-progress";
import { configureJudgeForTests, JevDecisionError } from "../src/lib/judge";
import { CHATGPT_STOP_BUTTON_SELECTOR } from "../src/chatgpt-session";

test.each([[true, false, true], [false, false, true], [true, true, true], [true, false, false]])("browser turns preserve recovery, ordering and final-only tools (owned=%s, tools=%s, multipart=%s)", async (owned, tools, multipart) => {
  const diagnostics = mkdtempSync(join(tmpdir(), "compaction-observation-"));
  const finalResponse = new Error("fixture reached final response observation");
  const capabilities = { localToolsEnabled: tools, solAvailable: true, extraHighAvailable: true, proAvailable: true };
  const progress = tools ? new ChatGptExternalTurnProgress() : undefined;
  const recoveryCallbacks: unknown[] = [];
  const actions: string[] = [];
  const sendBudgets: number[] = [];
  let stage = "";
  let released = false;
  const page = { evaluate: async () => ({}), isClosed: () => false };
  const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
    config: { appName: "Codex Jev", browserDiagnosticsPath: diagnostics, ...(owned ? { browserHostDescriptorPath: "owned-descriptor" } : {}) },
    runStage: async (_trace: string, name: string, timeout: number, action: (signal: AbortSignal) => Promise<unknown>) => {
      stage = name;
      if (name === "send" || name.endsWith("_send")) sendBudgets.push(timeout);
      return action(new AbortController().signal);
    },
    prepareSavedChatSurface: async () => {},
    selectModelAndEffort: async (_page: unknown, model: string, effort: string) => {
      actions.push(`effort:${effort}`);
      return resolveChatGptWebModelMode(model, effort, capabilities);
    },
    captureSubmissionBaseline: async () => ({}),
    attachPrompt: async (_page: unknown, _text: string, localTools: boolean) => {
      expect(localTools).toBe(false);
      actions.push("attach:plain");
    },
    attachPromptWithCompactionRetry: async (_page: unknown, _text: string, localTools: boolean) => {
      expect(localTools).toBe(tools);
      actions.push(localTools ? "attach:tools" : "attach:plain");
    },
    attachFiles: async () => { actions.push("files"); },
    sendAttachedPrompt: async (...args: unknown[]) => {
      // Context ingestion cannot mistake tool activity for acknowledgement of a part.
      expect(args[4]).toBe(stage === "send" ? progress : undefined);
      if (stage !== "send") expect(args[5]).toBeUndefined();
      recoveryCallbacks.push(args[7]);
      actions.push("send");
      return "user_turn";
    },
    waitForNewAssistantTurn: async (...args: unknown[]) => {
      expect(args[4]).toBe(stage === "send" ? progress : undefined);
      recoveryCallbacks.push(args[7]);
      actions.push("observe");
      if (stage === "send") throw finalResponse;
      return {};
    },
    waitForMultipartAcknowledgement: async () => { actions.push("ack"); },
  });
  try {
    await expect(worker.runBrowserTurn({
      traceId: "compaction_recovery_fixture",
      modelId: "gpt-5.6-sol",
      reasoning: "high",
      capabilities,
      compaction: !tools,
      externalProgress: progress,
      completionFence: tools ? {
        begin: async () => { throw new Error("fixture must stop before completion"); },
        commit: async () => { throw new Error("fixture must stop before completion"); },
      } : undefined,
      prepare: async () => ({ text: "Summarize the context", images: [], multipart: multipart ? { parts: ['{"part":1}', '{"part":2}', '{"part":3}'], commit: "Summarize" } : undefined, release: () => { released = true; } }),
    }, owned ? "owned-surface" : undefined, page)).rejects.toBe(finalResponse);
    expect(recoveryCallbacks.map(callback => typeof callback)).toEqual(
      Array(multipart ? 6 : 2).fill(owned ? "function" : "undefined"),
    );
    expect(actions).toEqual([
      ...(multipart ? [
        "effort:low",
        "attach:plain", "send", "observe", "ack",
        "attach:plain", "send", "observe", "ack",
      ] : []),
      "effort:high",
      tools ? "attach:tools" : "attach:plain", "files", "send", "observe",
    ]);
    expect(sendBudgets).toEqual(multipart ? [180_000, 180_000, 180_000] : [20_000]);
    expect(released).toBe(true);
  } finally {
    rmSync(diagnostics, { recursive: true, force: true });
  }
});

test.each(["recovers", "cancelled", "deadline", "upstream error", "stalled review", "active progress", "pending output", "late successful review", "missing snapshot", "interleaved review"])("an accepted turn handles %s without resubmission", async outcome => {
  const diagnostics = mkdtempSync(join(tmpdir(), "jev-observation-recovery-"));
  const completionDuringPause = ["missing snapshot", "interleaved review"].includes(outcome);
  const stallScenario = ["stalled review", "pending output"].includes(outcome) || completionDuringPause;
  const immediateReview = stallScenario || outcome === "active progress" || outcome === "late successful review";
  const capabilities = { localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: true };
  const controller = new AbortController();
  const delivered: string[] = [];
  const notices: string[] = [];
  let paused = false;
  let reviews = 0;
  let stallReviews = 0;
  let observations = 0;
  let generating = false;
  let missedSnapshot = false;
  let sends = 0;
  let heartbeats = 0;
  let released = false;
  let now = Date.now();
  const nativeSetTimeout = globalThis.setTimeout;
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  const timers = spyOn(globalThis, "setTimeout").mockImplementation(((callback: (...args: unknown[]) => void, delay = 0, ...args: unknown[]) => (
    nativeSetTimeout(() => { now += delay; callback(...args); }, 0)
  )) as typeof setTimeout);
  const restore = configureJudgeForTests({
    enabled: true, apiKey: () => "offline-fixture",
    evaluate: (async ({ questions }: { questions: Record<string, unknown> }) => {
      if ("kind" in questions) {
        stallReviews += 1;
        const selected = outcome === "active progress" ? "errored" : completionDuringPause ? "completed" : "still_generating";
        const probability = stallScenario && stallReviews <= (completionDuringPause ? 3 : 6) ? 0.55 : 0.98;
        return {
          answers: { kind: { type: "choice", choice: selected, probabilities: { [selected]: probability, unknown: 1 - probability } } },
          usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
        };
      }
      reviews += 1;
      if (!immediateReview) expect(delivered).toEqual([]);
      return {
        answers: Object.fromEntries(Object.keys(questions).map(id => [id, {
          type: "boolean", probability: !immediateReview && reviews <= 6 ? 0.5 : 0.98,
        }])),
        usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
      };
    }) as never,
  });
  const absent = { last() { return this; }, filter() { return this; }, allInnerTexts: async () => [], isVisible: async () => false };
  const response = {
    getByText: () => absent,
    getByTestId: () => ({ ...absent, isVisible: async () => outcome === "upstream error" && paused }),
  };
  const page = {
    evaluate: async () => ({}), isClosed: () => false,
    locator: (selector: string) => selector === CHATGPT_STOP_BUTTON_SELECTOR ? { ...absent, isVisible: async () => generating } : absent,
  };
  const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
    config: { appName: "Codex Jev", browserDiagnosticsPath: diagnostics, turnTimeoutMs: ["deadline", "late successful review"].includes(outcome) ? 4_000 : undefined },
    runStage: async (_trace: string, _name: string, _timeout: number, action: (signal: AbortSignal) => Promise<unknown>) => action(controller.signal),
    prepareSavedChatSurface: async () => {},
    selectModelAndEffort: async (_page: unknown, model: string, effort: string) => resolveChatGptWebModelMode(model, effort, capabilities),
    captureSubmissionBaseline: async () => ({}),
    attachPromptWithCompactionRetry: async () => {},
    attachFiles: async () => {},
    sendAttachedPrompt: async () => { sends += 1; return "user_turn"; },
    waitForNewAssistantTurn: async () => ({ locator: response }),
    reconcileAssistantTurnBinding: async (_page: unknown, _baseline: unknown, binding: unknown) => binding,
    stalledTurnDiagnostic: async () => "fixture",
    responseDomSnapshot: async () => {
      observations += 1;
      if (stallScenario) now += 15_000;
      if (outcome === "active progress") now += 31_000;
      if (outcome === "late successful review" && observations === 2) now += 10_000;
      generating = stallScenario ? stallReviews < 7 : outcome === "active progress" && observations <= 4;
      const interrupted = completionDuringPause && paused && !missedSnapshot;
      if (interrupted) missedSnapshot = true;
      if (interrupted && outcome === "interleaved review") throw new JevDecisionError("stopped_thinking_labels", "offline fixture review uncertain", true);
      const missing = interrupted && outcome === "missing snapshot";
      if (completionDuringPause && paused) generating = false;
      const texts = ["Reviewed answer", ...((outcome === "pending output" && paused) || outcome === "late successful review" ? ["New reviewed answer"] : [])];
      return {
        responsePresent: !missing, stoppedThinkingVisible: false, visibleText: texts.join("\n\n"), fullHtml: texts.map(text => `<p>${text}</p>`).join(""),
        completionActionVisible: !generating,
        traceBlocks: outcome === "active progress" && generating ? [{ kind: "status", key: "progress", text: `Processed task ${observations}` }] : [],
        markdownSegments: texts.map((text, index) => ({ key: `paragraph_${index}`, tag: "p", text, html: `<p>${text}</p>`, streamable: true })),
      };
    },
  });
  try {
    const pending = worker.runBrowserTurn({
      traceId: "required_review_fixture", modelId: "gpt-5.6-sol", reasoning: "high", capabilities,
      abortSignal: controller.signal,
      prepare: async () => ({ text: "Continue the task", images: [], release: () => { released = true; } }),
      onTextDelta: (text: string) => {
        if (!immediateReview) expect(reviews).toBeGreaterThan(6);
        if (outcome === "pending output" && paused) expect(stallReviews).toBeGreaterThan(6);
        delivered.push(text);
      },
      onHeartbeat: () => { heartbeats += 1; },
      onCommentary: (text: string) => {
        notices.push(text);
        if (text.includes("Waiting for required Jev review")) {
          paused = true;
          if (outcome === "cancelled") controller.abort(new DOMException("user stopped", "AbortError"));
        }
      },
    }, undefined, page);
    if (["recovers", "stalled review", "active progress", "pending output"].includes(outcome) || completionDuringPause) {
      const expected = outcome === "pending output" ? "Reviewed answer\n\nNew reviewed answer" : "Reviewed answer";
      expect(await pending).toBe(expected);
      expect(delivered.join("")).toBe(expected);
      if (outcome === "recovers") expect(reviews).toBe(7);
      if (stallScenario) expect(stallReviews).toBe(completionDuringPause ? 4 : 7);
      if (outcome === "active progress") expect(stallReviews).toBe(0);
      expect(heartbeats).toBeGreaterThan(1);
      expect(notices.filter(text => text.includes("review completed"))).toHaveLength(outcome === "active progress" ? 0 : 1);
    } else {
      const failure = await pending.then(() => undefined, (error: Error & { code?: string }) => error);
      if (outcome === "cancelled") expect(failure?.name).toBe("AbortError");
      if (["deadline", "late successful review"].includes(outcome)) expect(failure?.message).toContain("turn timed out");
      if (outcome === "upstream error") expect(failure?.code).toBe("upstream_server_error");
      expect(delivered).toEqual([]);
    }
    expect(notices.filter(text => text.includes("Waiting for required Jev review"))).toHaveLength(["active progress", "late successful review"].includes(outcome) ? 0 : 1);
    expect(sends).toBe(1);
    expect(released).toBeTrue();
  } finally {
    restore();
    timers.mockRestore();
    clock.mockRestore();
    rmSync(diagnostics, { recursive: true, force: true });
  }
});
