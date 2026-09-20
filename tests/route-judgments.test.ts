import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureJudgeForTests } from "../src/lib/judge";
import {
  currentRouteEvidence,
  explainCodexRouteConflict,
  judgeCodexRouteOwner,
  ROUTE_CONFLICT_ERROR_PREFIX,
  ROUTE_OWNERS,
} from "../src/route-judgments";

const OTHER_WRAPPER_CONFIG = [
  'model = "gpt-5"',
  'model_provider = "omniroute"',
  'openai_base_url = "http://127.0.0.1:20128/v1"',
  "",
  "[model_providers.omniroute]",
  'name = "OmniRoute"',
  'base_url = "http://127.0.0.1:20128/v1"',
  'wire_api = "responses"',
  "",
  "[mcp_servers.chatgpt-jev]",
  'command = "chatgpt-jev"',
].join("\n");

const restores: Array<() => void> = [];
const tempDirs: string[] = [];

afterEach(() => {
  while (restores.length) restores.pop()!();
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function useFakeJudge(fake: (input: { state: unknown; questions: unknown }) => unknown): { calls: Array<{ state: unknown; questions: unknown }> } {
  const calls: Array<{ state: unknown; questions: unknown }> = [];
  restores.push(configureJudgeForTests({
    enabled: true,
    apiKey: () => "test-key",
    evaluate: (async (input: { state: unknown; questions: unknown }) => {
      calls.push(input);
      return fake(input);
    }) as never,
  }));
  return { calls };
}

function confidentOwner(owner: keyof typeof ROUTE_OWNERS) {
  const probabilities = Object.fromEntries(Object.keys(ROUTE_OWNERS).map(key => [key, key === owner ? 0.94 : 0.02]));
  return { answers: { owner: { type: "choice", choice: owner, probabilities } }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
}

describe("route judgments", () => {
  test("currentRouteEvidence reads the live route, provider, and provider tables without secrets", () => {
    const evidence = currentRouteEvidence([
      OTHER_WRAPPER_CONFIG,
      "[model_providers.cloud]",
      'name = "Cloud"',
      'base_url = "https://api.example.com/v1"',
      'env_key = "CLOUD_API_KEY"',
    ].join("\n"));
    expect(evidence.openai_base_url).toBe("http://127.0.0.1:20128/v1");
    expect(evidence.model_provider).toBe("omniroute");
    expect(evidence.provider_tables).toEqual([
      { name: "omniroute", name_field: "OmniRoute", base_url: "http://127.0.0.1:20128/v1" },
      { name: "cloud", name_field: "Cloud", base_url: "https://api.example.com/v1" },
    ]);
    expect(JSON.stringify(evidence)).not.toContain("CLOUD_API_KEY");
    expect(currentRouteEvidence('model = "gpt-5"\n')).toEqual({ openai_base_url: "absent", model_provider: "absent", provider_tables: [] });
  });

  test("a confident owner verdict names the owner and the matching fix", async () => {
    const { calls } = useFakeJudge(() => confidentOwner("other_wrapper"));
    const verdict = await judgeCodexRouteOwner({ expectedRouteUrl: "http://127.0.0.1:8977/v1", configText: OTHER_WRAPPER_CONFIG });
    expect(verdict).toEqual({ owner: "other_wrapper", fix: ROUTE_OWNERS.other_wrapper.fix });
    expect(calls).toHaveLength(1);
    const state = calls[0]!.state as { expected_route_url: string; current: { openai_base_url: string } };
    expect(state.expected_route_url).toBe("http://127.0.0.1:8977/v1");
    expect(state.current.openai_base_url).toBe("http://127.0.0.1:20128/v1");
  });

  test("explainCodexRouteConflict only runs for the route-conflict error and reads the live config", async () => {
    const { calls } = useFakeJudge(() => confidentOwner("stale_self"));
    const dir = mkdtempSync(join(tmpdir(), "jev-route-"));
    tempDirs.push(dir);
    const configPath = join(dir, "config.toml");
    writeFileSync(configPath, OTHER_WRAPPER_CONFIG);

    expect(await explainCodexRouteConflict({ errors: ["Managed Codex route marker changed after setup; refusing to overwrite it"], configPath })).toBeUndefined();
    expect(calls).toHaveLength(0);

    const hint = await explainCodexRouteConflict({
      errors: [`${ROUTE_CONFLICT_ERROR_PREFIX}; refusing to overwrite the user's newer value`],
      routeUrl: "http://127.0.0.1:8977/v1",
      configPath,
    });
    expect(hint).toBe(`Jev: the route now looks owned by stale self. ${ROUTE_OWNERS.stale_self.fix}`);
    expect(calls).toHaveLength(1);
  });

  test("unsure verdicts, judge failures, and unreadable configs leave the inspection unexplained", async () => {
    const unsure = useFakeJudge(() => ({
      answers: { owner: { type: "choice", choice: "other_wrapper", probabilities: { other_wrapper: 0.4, manual_provider: 0.35, stale_self: 0.2, restored_default: 0.05 } } },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    }));
    expect(await judgeCodexRouteOwner({ expectedRouteUrl: "http://127.0.0.1:8977/v1", configText: OTHER_WRAPPER_CONFIG })).toBeUndefined();
    expect(unsure.calls).toHaveLength(1);
    restores.pop()!();

    useFakeJudge(() => { throw new Error("gateway down"); });
    expect(await judgeCodexRouteOwner({ expectedRouteUrl: undefined, configText: OTHER_WRAPPER_CONFIG })).toBeUndefined();
    expect(await explainCodexRouteConflict({
      errors: [ROUTE_CONFLICT_ERROR_PREFIX],
      configPath: join(tmpdir(), "jev-route-missing", "config.toml"),
    })).toBeUndefined();
  });
});
