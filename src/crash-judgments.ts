import { confidentChoice, judge } from "./lib/judge";

/**
 * Item 19: crash-loop classification. When the launcher supervisor gives up restarting the daemon or
 * the tunnel, it only knows the last exit line. Jev reads that line plus the restart history and names
 * the kind of failure, so the launcher can show a fix instead of "automatic restart is disabled".
 * The supervisor invokes this through the hidden `triage-crash` CLI command, which keeps the gateway
 * key and the `ai` dependency inside the runtime process; the launcher never talks to Jev directly.
 */

export const CRASH_KINDS = {
  port_in_use: {
    description: "The daemon or tunnel could not bind its local port because another process (a previous instance, another wrapper, or an unrelated service) already listens on it.",
    fix: "Close the other program using the port (or a leftover ChatGPT Jev / Codex Web GPT instance), or change `port` in config, then start the launcher again.",
  },
  missing_binary_or_runtime: {
    description: "An executable, runtime file, or module needed to start is missing, unreadable, or incompatible (not found, ENOENT, cannot execute, bad version).",
    fix: "Reinstall the latest ChatGPT Jev release; the installer restores the bundled runtime and the pinned tunnel client.",
  },
  config_invalid: {
    description: "The process refused to start because its configuration, profile, key file, or descriptor is invalid, unsafe, or inconsistent.",
    fix: "Run Repair Codex setup from the launcher, or delete the invalid file named in the error and rerun setup.",
  },
  auth_lost: {
    description: "The process exited because ChatGPT or the tunnel rejected its credentials: signed out, expired session, revoked tunnel key, or forbidden.",
    fix: "Sign in to ChatGPT again from the launcher and rerun MCP setup so the tunnel gets a fresh key.",
  },
  transient_crash: {
    description: "An internal crash, out-of-memory, killed process, or network blip that does not point at a fixed local cause.",
    fix: "Restart the launcher once; if it keeps happening, export a safe log right after the failure and open a bug report.",
  },
} as const;

export type CrashKind = keyof typeof CRASH_KINDS;

export interface CrashLoopInput {
  /** Which supervised child failed. */
  child: "daemon" | "tunnel";
  /** Last redacted failure line the supervisor recorded, e.g. `daemon exited (1): EADDRINUSE ...`. */
  lastFailure: string;
  /** Restarts attempted inside the supervisor's window before giving up. */
  restarts: number;
}

export interface CrashLoopVerdict {
  kind: CrashKind;
  fix: string;
}

const MAX_FAILURE_TEXT = 2_000;
const CRASH_JUDGE_TIMEOUT_MS = 6_000;

export async function classifyCrashLoop(input: CrashLoopInput): Promise<CrashLoopVerdict | undefined> {
  const answers = await judge("runtime_crash_loop", {
    child: input.child,
    last_failure: input.lastFailure.slice(0, MAX_FAILURE_TEXT),
    restarts_in_last_minute: input.restarts,
    source: "The launcher supervisor of ChatGPT Jev (a local bridge routing Codex through a ChatGPT browser session) restarted this child process repeatedly and gave up. `last_failure` is the final redacted exit line; placeholders like [tunnel-id] replace secrets.",
  }, {
    crash_kind: {
      type: "choice",
      instructions: "Which kind of failure does `last_failure` most likely describe?",
      criteria: Object.fromEntries(Object.entries(CRASH_KINDS).map(([kind, cause]) => [kind, cause.description])) as Record<CrashKind, string>,
    },
  }, { timeoutMs: CRASH_JUDGE_TIMEOUT_MS }).catch(() => undefined);
  const kind = confidentChoice(answers?.crash_kind);
  return kind ? { kind, fix: CRASH_KINDS[kind].fix } : undefined;
}
