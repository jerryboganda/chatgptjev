import { readFileSync } from "node:fs";
import { findTopLevelAssignment, splitLines } from "./codex-integration-document";
import { confidentChoice, judge, judgeEnabled } from "./lib/judge";

/**
 * Item 20: route-conflict detection. The integration inspector refuses to touch a Codex route it no
 * longer recognises and reports only "openai_base_url changed after setup". Jev reads the route that
 * is there now (the URL, the selected provider, and the provider tables in config.toml) and names who
 * owns it, so the launcher and `doctor` can say which program to disable instead of asking the user
 * to guess. The inspector's exact-match rule is untouched: this only explains a conflict it found.
 */

export const ROUTE_CONFLICT_ERROR_PREFIX = "Codex openai_base_url changed after setup";

export const ROUTE_OWNERS = {
  other_wrapper: {
    description: "A third-party Codex wrapper, router, or proxy (for example OpenCodex, Headroom, OmniRoute, Codex++, CC Switch, or another local bridge on a different port) rewired the route to itself.",
    fix: "Only one program can own Codex's openai_base_url. Disable that tool's provider or proxy mode (keep it as an MCP integration if you want), run Repair Codex setup, then fully restart Codex.",
  },
  stale_self: {
    description: "An older or parallel install of this bridge (Codex Web GPT / ChatGPT Jev on another port, profile, or version) owns the route rather than this installation.",
    fix: "Quit the other bridge instance, uninstall or disconnect its Codex integration, then run Repair Codex setup here and fully restart Codex.",
  },
  manual_provider: {
    description: "The user pointed Codex at a remote or self-hosted model provider by hand (a cloud API, OpenRouter, an Ollama/vLLM endpoint, or a custom base URL) and selected that provider.",
    fix: "Decide which provider Codex should use. To return to ChatGPT Jev, run Repair Codex setup; to keep your provider, use Remove Codex integration so the launcher stops reporting a conflict.",
  },
  restored_default: {
    description: "The route was removed or reset to Codex's official default (no openai_base_url, or the stock OpenAI / ChatGPT backend), for example by a Codex update, reinstall, or manual cleanup.",
    fix: "Run Repair Codex setup once to reinstall the ChatGPT Jev route, then fully restart Codex.",
  },
} as const;

export type RouteOwner = keyof typeof ROUTE_OWNERS;

export interface RouteConflictInput {
  /** The route this installation wrote (from the journal). */
  expectedRouteUrl: string | undefined;
  /** Codex `config.toml` text as it is now. */
  configText: string;
}

const MAX_PROVIDER_TABLES = 12;
const ROUTE_JUDGE_TIMEOUT_MS = 4_000;

/** The parts of config.toml that identify the current route owner; values only, no secrets. */
export function currentRouteEvidence(configText: string): {
  openai_base_url: string;
  model_provider: string;
  provider_tables: Array<{ name: string; base_url?: string; name_field?: string }>;
} {
  const lines = splitLines(configText);
  // Jev state must be JSON: a missing top-level assignment is reported as the literal string "absent".
  const read = (key: string): string => {
    try {
      return findTopLevelAssignment(lines, key).value ?? "absent";
    } catch {
      return "unreadable";
    }
  };
  const providerTables: Array<{ name: string; base_url?: string; name_field?: string }> = [];
  let current: { name: string; base_url?: string; name_field?: string } | undefined;
  for (const line of lines) {
    const table = /^\s*\[model_providers\.([^\]]+)\]\s*$/.exec(line);
    if (table) {
      current = { name: table[1]!.trim().replace(/^"|"$/g, "") };
      if (providerTables.length < MAX_PROVIDER_TABLES) providerTables.push(current);
      continue;
    }
    if (/^\s*\[/.test(line)) {
      current = undefined;
      continue;
    }
    if (!current) continue;
    const field = /^\s*(base_url|name)\s*=\s*"([^"]*)"/.exec(line);
    if (field) current[field[1] === "name" ? "name_field" : "base_url"] = field[2];
  }
  return { openai_base_url: read("openai_base_url"), model_provider: read("model_provider"), provider_tables: providerTables };
}

export async function judgeCodexRouteOwner(input: RouteConflictInput): Promise<{ owner: RouteOwner; fix: string } | undefined> {
  if (!judgeEnabled()) return undefined;
  const evidence = currentRouteEvidence(input.configText);
  const answers = await judge("codex_route_owner", {
    expected_route_url: input.expectedRouteUrl ?? "unknown",
    current: evidence,
    source: "Codex CLI/Desktop `config.toml` after this bridge's managed route stopped matching. `expected_route_url` is the local URL this installation wrote; `current` is what the file contains now (`absent` means the assignment is not in the file).",
  }, {
    owner: {
      type: "choice",
      instructions: "Who owns Codex's model route now, judging from `current` compared with `expected_route_url`?",
      criteria: Object.fromEntries(Object.entries(ROUTE_OWNERS).map(([owner, entry]) => [owner, entry.description])) as Record<RouteOwner, string>,
    },
  }, { timeoutMs: ROUTE_JUDGE_TIMEOUT_MS }).catch(() => undefined);
  const owner = confidentChoice(answers?.owner);
  return owner ? { owner, fix: ROUTE_OWNERS[owner].fix } : undefined;
}

/**
 * When the inspector reported a route conflict, returns one sentence naming the likely owner and the
 * fix; otherwise (no conflict, unreadable config, unsure or disabled Jev) returns `undefined`.
 */
export async function explainCodexRouteConflict(inspection: {
  errors: readonly string[];
  routeUrl?: string;
  configPath: string;
}): Promise<string | undefined> {
  if (!inspection.errors.some(error => error.startsWith(ROUTE_CONFLICT_ERROR_PREFIX))) return undefined;
  let configText: string;
  try {
    configText = readFileSync(inspection.configPath, "utf8");
  } catch {
    return undefined;
  }
  const verdict = await judgeCodexRouteOwner({ expectedRouteUrl: inspection.routeUrl, configText });
  return verdict ? `Jev: the route now looks owned by ${verdict.owner.replace(/_/g, " ")}. ${verdict.fix}` : undefined;
}
