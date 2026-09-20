# ChatGPT Jev

Before changing the runtime, launcher, Jev policy, packaging, or Codex integration, read [AGENT-HANDOFF-CHATGPT-JEV.md](AGENT-HANDOFF-CHATGPT-JEV.md) for the current source, installed-build status, and verification limits.

## Required Jev Workflow

The owner approved required Jev use for suitable semantic decisions in both this application and the coding workflow.

- Load the installed TypeSafe skill for Jev work. Use the shared `judge` in `src/lib/judge.ts`, model `typesafe-ai/jev`, through Vercel AI Gateway and `AI_GATEWAY_API_KEY`.
- For semantic design choices, ambiguous interpretation, ranking, classification, and review triage, give Jev the relevant evidence and explicit alternatives. Validate the typed answer before making the affected decision. If the required answer is unavailable or uncertain, pause that decision and report the problem; do not silently substitute a heuristic.
- Keep exact computation, file reads, schema validation, code generation, and tool execution in their appropriate tools. Jev supplies judgments, not generated code or executed actions. Its verdict does not establish facts or authorize an otherwise unauthorized action.
- Keep credentials out of logs, files, renderer state, and judgment evidence. The gateway key belongs only in the process environment. Record actual live verdicts and disclose failed calls; distinguish cache hits and offline fixtures from new inference.
- Use exact-input caching where appropriate. Unit and integration tests use explicit offline providers through `configureJudgeForTests` or `tests/fixtures/jev.ts`; production must not acquire a test bypass. `NODE_ENV=test` blocks the default live provider.

## Isolation

Work only on the ChatGPT Jev fork and its own artifacts. Preserve the original Codex Web GPT installation, runtime processes, and `~/.codex-chatgpt-web` state. Preserve authentication, native Codex permissions, secret protection, and exact route ownership checks. Taking over Codex's `openai_base_url` or `model_provider` requires explicit owner approval.

`origin` is the upstream repository, not the owner's fork. Do not push there. Commits, branch creation, installation, and real-profile setup are separate actions requiring authorization; packaging alone is not installation.

## Verification

Run a focused check after each implementation change. Run Bun tests in individually capped child processes on Windows: Bun 1.4.0 can freeze in named-pipe tests without firing its own timeout. Terminate only the child owned by the check, never all Bun processes.

Report current test results, excluded or stalled tests, live Jev evidence, and source versus packaged/installed status separately. Historical release evidence does not verify a newer source tree. Keep the handoff current when the Jev policy or release status changes.