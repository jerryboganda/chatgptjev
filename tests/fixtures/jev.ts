import { configureJudgeForTests } from "../../src/lib/judge";

export function installJevFixture(): () => void {
  if (process.env.NODE_ENV !== "test") throw new Error("Jev fixtures require NODE_ENV=test");
  return configureJudgeForTests({
    enabled: true,
    apiKey: () => "offline-fixture",
    evaluate: (async ({ questions }: { questions: Record<string, { type: string }> }) => ({
      answers: Object.fromEntries(Object.entries(questions).map(([key, question]) => {
        if (question.type === "score") {
          const score = key === "difficulty" ? 2 : key === "completeness" ? 3 : key === "command_risk" ? 0 : /^record_\d+$/.test(key) ? 1 : undefined;
          if (score !== undefined) return [key, { type: "score", score }];
        }
        if (question.type === "boolean") {
          if (["preserves_latest_user_request", "justification_matches_command"].includes(key)) return [key, { type: "boolean", probability: 0.99 }];
          if (["introduces_contradiction", "injected_instructions"].includes(key) || /^line_\d+$/.test(key)) return [key, { type: "boolean", probability: 0.01 }];
        }
        throw new Error(`No integration fixture for Jev question ${key}`);
      })),
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    })) as never,
  });
}

if (process.argv.some(argument => /[\\/]src[\\/]cli\.ts$/.test(argument)) && process.argv.includes("mcp")) {
  installJevFixture();
}