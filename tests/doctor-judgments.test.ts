import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, saveConfig } from "../src/config";
import { installCodexIntegration } from "../src/codex-integration";
import {
  DOCTOR_ROOT_CAUSES,
  DOCTOR_TRIAGE_CHECK_ID,
  JEV_CHECK_ID,
  jevAvailabilityCheck,
  triageDoctorChecks,
} from "../src/doctor-judgments";
import { formatDoctorReport, runDoctor, type DoctorCheck } from "../src/doctor";
import { configureJudgeForTests } from "../src/lib/judge";

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

/** Choice fake answering `root_cause` with the given probabilities (or throwing). */
function withJev(probabilities: Record<string, number> | (() => never), enabled = true, apiKey = "test-key") {
  const seen: Array<{ state: Record<string, unknown>; questions: Record<string, { criteria?: Record<string, string> }> }> = [];
  const restoreJev = configureJudgeForTests({
    enabled,
    apiKey: () => apiKey,
    evaluate: (async (options: { state: Record<string, unknown>; questions: Record<string, { criteria?: Record<string, string> }> }) => {
      seen.push({ state: options.state, questions: options.questions });
      if (typeof probabilities === "function") probabilities();
      const top = Object.entries(probabilities).sort(([, a], [, b]) => b - a)[0]![0];
      return {
        answers: { root_cause: { type: "choice", choice: top, probabilities } },
        usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
      };
    }) as never,
  });
  return { restore: restoreJev, seen };
}

const routeConflictChecks: DoctorCheck[] = [
  { id: "config", status: "ok", message: "Configuration is valid" },
  { id: "browser-host", status: "ok", message: "Embedded launcher browser is authenticated and reachable (pid 4)" },
  { id: "codex", status: "error", message: "Codex integration is inconsistent", detail: `openai_base_url changed after setup: ${"x".repeat(700)}` },
  { id: "service", status: "ok", message: "Launcher owns the background runtime" },
  { id: "proxy", status: "ok", message: "Responses proxy is healthy on 127.0.0.1:8123" },
  { id: "tools", status: "warning", message: "Browser-only mode intentionally has no local tools or MCP tunnel" },
];

test("a confident root cause becomes one advisory check with the fix and the troubleshooting anchor", async () => {
  const jev = withJev({ route_conflict: 0.88, daemon_down: 0.06, stale_install: 0.06 });
  restore = jev.restore;

  const triage = await triageDoctorChecks(routeConflictChecks, "browser-only");

  expect(triage).toMatchObject({ id: DOCTOR_TRIAGE_CHECK_ID, status: "warning" });
  expect(triage!.message).toBe("Jev: most likely root cause is route conflict");
  expect(triage!.detail).toContain(DOCTOR_ROOT_CAUSES.route_conflict.fix);
  expect(triage!.detail).toContain(`#${DOCTOR_ROOT_CAUSES.route_conflict.anchor}`);

  expect(jev.seen).toHaveLength(1);
  const state = jev.seen[0]!.state as { mode: string; failing_checks: Array<{ id: string; detail?: string }>; passing_check_ids: string[] };
  expect(state.mode).toBe("browser-only");
  expect(state.failing_checks.map(check => check.id)).toEqual(["codex"]);
  expect(state.failing_checks[0]!.detail!.length).toBeLessThanOrEqual(600);
  expect(state.passing_check_ids).toEqual(["config", "browser-host", "service", "proxy", "tools"]);
  expect(Object.keys(jev.seen[0]!.questions.root_cause!.criteria!)).toEqual(Object.keys(DOCTOR_ROOT_CAUSES));
});

test("healthy reports need no triage; unsure, failed, or disabled Jev adds an explicit error", async () => {
  const healthy = routeConflictChecks.map(check => ({ ...check, status: check.status === "error" ? "ok" as const : check.status }));
  const unsure = withJev({ route_conflict: 0.5, daemon_down: 0.45, stale_install: 0.05 });
  restore = unsure.restore;
  expect(await triageDoctorChecks(healthy, "browser-only")).toBeUndefined();
  expect(unsure.seen).toHaveLength(0);
  expect(await triageDoctorChecks(routeConflictChecks, "browser-only")).toMatchObject({ id: DOCTOR_TRIAGE_CHECK_ID, status: "error", message: expect.stringMatching(/Jev.*uncertain/) });
  restore();

  const failing = withJev(() => { throw new Error("gateway down"); });
  restore = failing.restore;
  expect(await triageDoctorChecks(routeConflictChecks, "browser-only")).toMatchObject({ id: DOCTOR_TRIAGE_CHECK_ID, status: "error", message: expect.stringMatching(/Jev.*failed/) });
  restore();

  const disabled = withJev({ route_conflict: 1 }, false);
  restore = disabled.restore;
  expect(await triageDoctorChecks(routeConflictChecks, "browser-only")).toMatchObject({ id: DOCTOR_TRIAGE_CHECK_ID, status: "error", message: expect.stringMatching(/Jev.*disabled/) });
  expect(disabled.seen).toHaveLength(0);
});

test("Jev is a readiness requirement, not an optional advisory", () => {
  const configured = withJev({ route_conflict: 1 });
  restore = configured.restore;
  expect(jevAvailabilityCheck()).toEqual({ id: JEV_CHECK_ID, status: "ok", message: "Jev judgments are configured" });
  restore();

  const unconfigured = withJev({ route_conflict: 1 }, true, "");
  restore = unconfigured.restore;
  expect(jevAvailabilityCheck()).toMatchObject({ id: JEV_CHECK_ID, status: "error", message: expect.stringContaining("AI_GATEWAY_API_KEY") });
  restore();

  const disabled = withJev({ route_conflict: 1 }, false);
  restore = disabled.restore;
  expect(jevAvailabilityCheck()).toMatchObject({ id: JEV_CHECK_ID, status: "error", message: expect.stringContaining("disabled") });
});

test("doctor retains a JSON report when route-owner inference fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "jev-doctor-report-"));
  const previous = { app: process.env.CHATGPT_JEV_HOME, codex: process.env.CODEX_HOME };
  process.env.CHATGPT_JEV_HOME = join(root, "app");
  process.env.CODEX_HOME = join(root, "codex");
  restore = withJev(() => { throw new Error("private-provider-failure"); }).restore;
  try {
    const config = { ...defaultConfig("browser-only"), port: 1, browserHost: "managed-chrome" as const };
    saveConfig(config);
    installCodexIntegration(config);
    const path = join(process.env.CODEX_HOME, "config.toml");
    writeFileSync(path, readFileSync(path, "utf8").replace("http://127.0.0.1:1", "https://other.example.test"));
    const report = await runDoctor();
    expect(report.ok).toBeFalse();
    expect(report.checks).toContainEqual(expect.objectContaining({ id: "codex", status: "error" }));
    expect(report.checks).toContainEqual(expect.objectContaining({ id: "jev-route-owner", status: "error" }));
    expect(JSON.parse(JSON.stringify(report)).ok).toBeFalse();
    expect(JSON.stringify(report)).not.toContain("private-provider-failure");
  } finally {
    for (const [key, value] of [["CHATGPT_JEV_HOME", previous.app], ["CODEX_HOME", previous.codex]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("the formatted report prints the triage under the deterministic checks and keeps readiness from them", () => {
  const rendered = formatDoctorReport({
    ok: false,
    mode: "browser-only",
    checks: [
      ...routeConflictChecks,
      { id: JEV_CHECK_ID, status: "ok", message: "Jev judgments are configured" },
      { id: DOCTOR_TRIAGE_CHECK_ID, status: "warning", message: "Jev: most likely root cause is route conflict", detail: "Disable the other tool. See x#y" },
    ],
  });
  const lines = rendered.trimEnd().split("\n");
  expect(lines.at(-1)).toBe("Doctor result: not ready");
  expect(lines.at(-3)).toBe("! Jev: most likely root cause is route conflict");
  expect(lines.at(-2)).toBe("  Disable the other tool. See x#y");
});
