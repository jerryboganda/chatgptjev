import type { CheckStatus, DoctorCheck } from "./doctor";
import { confidentChoice, judge, judgeConfigured, judgeEnabled, JevDecisionError } from "./lib/judge";

/**
 * Item 18: doctor triage. `doctor` lists every failing check, but the checks are symptoms of one
 * another (a missing route makes the catalog check fail, a dead daemon makes the tunnel look down).
 * Jev reads the failing checks together and names the single most likely root cause, mapped to the
 * matching TROUBLESHOOTING.md section. Deterministic checks are never changed; the triage is one
 * extra advisory line. Required triage failures are reported alongside the deterministic checks.
 */

const TROUBLESHOOTING = "https://github.com/miuuyy/codex-chatgpt-web/blob/main/TROUBLESHOOTING.md";

export const DOCTOR_ROOT_CAUSES = {
  route_conflict: {
    description: "Another Codex wrapper, router, or manual provider replaced Codex's openai_base_url / model route, so the ChatGPT Jev route is missing, inconsistent, or points elsewhere.",
    fix: "Disable the other tool's provider or proxy mode, run Repair Codex setup, then fully restart Codex.",
    anchor: "openai_base_url-changed-after-setup-or-a-model-is-not-supported",
  },
  daemon_down: {
    description: "The Responses proxy daemon is not running, is the wrong version or mode, or its port is owned by another service; the browser, tunnel, and route may otherwise be fine.",
    fix: "Reopen the ChatGPT Jev launcher (or run `chatgpt-jev serve`), then run doctor again.",
    anchor: "the-first-five-minutes",
  },
  login_required: {
    description: "The ChatGPT sign-in used for model turns is missing, unverified, or no longer trusted.",
    fix: "Sign in again from the launcher (or run `chatgpt-jev login`) and retry.",
    anchor: "chatgpt-sign-in-does-not-complete",
  },
  browser_unavailable: {
    description: "The embedded launcher browser or the configured Chrome executable cannot be reached, so no ChatGPT turn can be driven.",
    fix: "Reopen the launcher, or point chromeExecutablePath at an installed Chrome, and rerun the browser smoke test.",
    anchor: "the-browser-smoke-test-fails",
  },
  tunnel_or_connector: {
    description: "Full mode's MCP tunnel is not ready (binary, key, service, runtime) or the ChatGPT connector is not attached, while the browser side is healthy.",
    fix: "Rerun MCP setup from the launcher and confirm the connector once at chatgpt.com settings while the tunnel is ready.",
    anchor: "full-harness-or-mcp-verification-fails",
  },
  stale_install: {
    description: "Leftovers from an earlier install or OS service, unsafe file permissions, or an invalid configuration file are blocking a clean start.",
    fix: "Run Repair Codex setup, or reinstall the latest release without removing the private profile.",
    anchor: "update-repair-and-remove",
  },
} as const;

export type DoctorRootCause = keyof typeof DOCTOR_ROOT_CAUSES;

export const DOCTOR_TRIAGE_CHECK_ID = "jev-triage";
export const JEV_CHECK_ID = "jev";
const MAX_CHECK_DETAIL = 600;
const DOCTOR_JUDGE_TIMEOUT_MS = 4_000;

/** Reports whether required Jev judgments are available to this process. */
export function jevAvailabilityCheck(): DoctorCheck {
  if (!judgeConfigured()) {
    return {
      id: JEV_CHECK_ID,
      status: "error",
      message: "Jev judgments are inactive: AI_GATEWAY_API_KEY is not set for this process",
      detail: "Set AI_GATEWAY_API_KEY in the runtime environment and restart. Required semantic decisions cannot continue without Jev.",
    };
  }
  if (!judgeEnabled()) return { id: JEV_CHECK_ID, status: "error", message: "Required Jev judgments are disabled" };
  return { id: JEV_CHECK_ID, status: "ok", message: "Jev judgments are configured" };
}

/** One advisory check naming the most likely root cause of the failing checks, or `undefined`. */
export async function triageDoctorChecks(
  checks: readonly DoctorCheck[],
  mode: string | undefined,
): Promise<DoctorCheck | undefined> {
  const failing = checks.filter(check => check.status === "error");
  if (failing.length === 0) return undefined;
  try {
    const answers = await judge("doctor_triage", {
      mode: mode ?? "unknown",
      failing_checks: failing.map(check => ({
        id: check.id,
        message: check.message,
        ...(check.detail ? { detail: check.detail.slice(0, MAX_CHECK_DETAIL) } : {}),
      })),
      passing_check_ids: checks.filter(check => check.status !== "error").map(check => check.id),
      source: "Output of the ChatGPT Jev `doctor` command: a local bridge that routes Codex through a ChatGPT browser session. Checks fail together when they share a cause.",
    }, {
      root_cause: {
        type: "choice",
        instructions: "Which single underlying problem best explains all of the failing checks together, given the passing ones?",
        criteria: Object.fromEntries(Object.entries(DOCTOR_ROOT_CAUSES).map(([kind, cause]) => [kind, cause.description])) as Record<DoctorRootCause, string>,
      },
    }, { timeoutMs: DOCTOR_JUDGE_TIMEOUT_MS });
    const kind = confidentChoice(answers.root_cause);
    const cause = DOCTOR_ROOT_CAUSES[kind];
    return {
      id: DOCTOR_TRIAGE_CHECK_ID,
      status: "warning" satisfies CheckStatus,
      message: `Jev: most likely root cause is ${kind.replace(/_/g, " ")}`,
      detail: `${cause.fix} See ${TROUBLESHOOTING}#${cause.anchor}`,
    };
  } catch (error) {
    if (!(error instanceof JevDecisionError)) throw error;
    return { id: DOCTOR_TRIAGE_CHECK_ID, status: "error", message: error.message };
  }
}
