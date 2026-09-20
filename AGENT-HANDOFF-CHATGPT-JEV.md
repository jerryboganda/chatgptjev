# AGENT HANDOFF — ChatGPT Jev (Codex Web GPT fork + Jev judgment layer)

**Handoff written:** 2026-09-20
**Written by:** outgoing agent (GitHub Copilot / Claude session) after audit → fork → 19 Jev integrations → installer → side-by-side install → regression → parity proof
**For:** any incoming AI agent picking up this project
**Status:** DELIVERED. Repo clean at `3f1130f` (branch `chatgpt-jev`). Installer built, installed side-by-side with the untouched Codex Web GPT, smoke-tested, regression-tested. One deliberate gap: `setup` has NOT been run in the owner's real profile (§10). Read this whole document before touching anything.

---

## 0. TL;DR — WHERE THINGS STAND

| Item | State |
|---|---|
| Source repo | ✅ `d:\Projects\chatgpt-jev`, branch `chatgpt-jev`, HEAD `3f1130f`, working tree clean, 0 uncommitted files |
| Base | upstream `miuuyy/codex-chatgpt-web` tag **v5.0.8** = commit `00aab23` (MIT). `origin` still points at upstream — **never push** |
| Rebrand | ✅ commit `9705851` — product "ChatGPT Jev", own appId/GUID/home dir/port/pipe/connector names; auto-updates disabled |
| Jev items | ✅ 19 of 20 implemented (items 1–6, 8–20). **Item 7 deliberately skipped** (redundant, §4) |
| Config/CLI/UI switch | ✅ `jevEnabled` config, `--jev/--no-jev` setup flags, launcher Settings row "AI judgments (Jev)" (commit `276e62c`) |
| Windows installer | ✅ `launcher/artifacts/chatgpt-jev-5.0.8-win-x64.exe` (153,492,418 bytes, built 2026-09-20 10:08) |
| Installed | ✅ `%LOCALAPPDATA%\Programs\ChatGPT Jev\ChatGPT Jev.exe` (7518 files). HKCU uninstall GUID `a10be615-f3b8-4a54-9f50-2c5fd912e945` |
| Codex Web GPT untouched | ✅ verified byte-count/newest-file unchanged: 6081 files / 554,415,894 bytes / newest 2026-09-19 19:39:19; GUID `d1a6026a-6210-588e-9a2b-da3936f94e02` |
| Packaged smoke | ✅ `PACKAGED_LAUNCHER_SMOKE_OK win32/x64` |
| Regression | ✅ launcher 309 pass / 1 env-fail / 2 skip; core 689 pass / 3 env-fail / 1 Bun-wedge test — **zero Jev-related failures** (§8) |
| Parity proof | ✅ installed Codex Web GPT == fresh build of untouched v5.0.8: runtime 5997/5997, Electron shell 24/24, renderer 5/5 SHA-256 identical (§9) |
| Setup in real profile | ⬜ NOT RUN (would take Codex's `openai_base_url` from the running Codex Web GPT — owner must choose, §10) |

**Two most important facts:**
1. The owner's installed "Codex Web GPT" **is** the open-source upstream product; the fork was cloned from that exact release. The fork is upstream + string rebrand + additive Jev modules with **upstream-rule fallbacks everywhere** (Jev off/unavailable/unsure ⇒ identical behaviour to upstream).
2. **Do not intermix the two projects.** Never edit anything under `%LOCALAPPDATA%\Programs\Codex Web GPT` or `~/.codex-chatgpt-web`. Never kill `bun.exe` processes whose path is under `~\.codex-chatgpt-web\versions\...\runtime\` — they are the running Codex Web GPT app.

---

## 1. OWNER'S DECISIONS (verbatim intent — binding)

1. "PLEASE USING **JEV** MAXIMALLY … SCAN THE ENTIRE PROJECT AND GIVE ME A LIST OF ALL OPTIMIZATIONS" → audit produced 20 items; owner chose **"Full — all 20 items in priority order"**.
2. "YES RUN EVERYWHERE WILL FULL POWER AND 100% RESULTS" → Jev is used in **all** modes, **including Zero Risk mode**.
3. "OPTION 1 BUT **DONT MERGE IT WITH THE CURRENT PROJECT** -- CREATE A TOTALLY DIFFERENT PROJECT … **NAME IT CHATGPT JEV** … **DONT INTERMIX BOTH PROJECTS**" → separate folder, separate product identity, separate install dir, separate state dir, separate port, separate connector names.
4. "Local clone only (no GitHub account needed)" → no GitHub fork; no remote of our own; commits are local.
5. Install **side-by-side**, leaving the installed Codex Web GPT untouched and running.
6. Priority order used for implementation: 1+2 → 3+4 → 8+9+10 → 15 → 6+7 → rest.

Security rules carried through: the Jev key `AI_GATEWAY_API_KEY` is in the owner's **User** environment. Never print it, never put it in files, never pass it to the Electron renderer (only the daemon process reads it).

---

## 2. PROJECT FACTS

### 2.1 Two installed apps (both v5.0.8)
| | Codex Web GPT (owner's original, DO NOT TOUCH) | ChatGPT Jev (this fork) |
|---|---|---|
| Install dir | `%LOCALAPPDATA%\Programs\Codex Web GPT` | `%LOCALAPPDATA%\Programs\ChatGPT Jev` |
| Exe | `Codex Web GPT.exe` | `ChatGPT Jev.exe` |
| NSIS GUID / HKCU uninstall key | `d1a6026a-6210-588e-9a2b-da3936f94e02` | `a10be615-f3b8-4a54-9f50-2c5fd912e945` |
| appId | upstream | `dev.chatgptjev.launcher` |
| Home dir / env | `~/.codex-chatgpt-web`, `CODEX_CHATGPT_WEB_HOME` | `~/.chatgpt-jev`, `CHATGPT_JEV_HOME` (DEV: `~/.chatgpt-jev-dev`, `CHATGPT_JEV_DEV_HOME`) |
| Default port | 17841 | **17851** |
| Named pipe | `\\.\pipe\codex-chatgpt-web-<id>` | `\\.\pipe\chatgpt-jev-<id>` |
| ChatGPT connector names | "Codex Native2" / "Codex Zero Risk" | **"Codex Jev"** / **"Codex Jev Zero Risk"** |
| Browser partition | upstream | `persist:chatgpt-jev-chatgpt` (DEV `persist:chatgpt-jev-dev-chatgpt`) |
| Runtime CLI | `resources\runtime\bin\codex-chatgpt-web.cmd` | `resources\runtime\bin\chatgpt-jev.cmd` |
| Codex config comments | `# Managed by codex-chatgpt-web` | `# Managed by chatgpt-jev` |
| Auto-update | on | **off** (`updatesEnabled=false` passed from `main.cjs` to `update.cjs`) |

Shared constraint: **only one wrapper can own Codex's `openai_base_url` / `model_provider` at a time.** Whichever ran `setup --replace-codex-route` last owns it. Item 20 (route judgments) exists precisely to name the owner and the repair.

### 2.2 Source layout (fork)
- `src/` — Bun/TypeScript daemon: `cli.ts` (serve/setup/doctor/route/dev/hidden `triage-crash`), `server.ts`, `bridge.ts`, `config.ts`, `setup.ts`, `doctor.ts`, adapters in `src/adapters/chatgpt-web/` (Playwright-driven ChatGPT web session), `src/dev-chat/` (DEV profile).
- `src/lib/judge.ts` — the Jev wrapper (§5). `src/lib/errors.ts` — adapter failure classification.
- `launcher/` — Electron shell (`electron/*.cjs`), Vite/React renderer (`src/App.tsx`, `i18n.ts`, `types.ts`), tests `tests/*.test.cjs`, packaging `scripts/package.cjs`, `scripts/smoke-package.cjs`.
- `scripts/build-runtime-bundle.ts` — builds `dist/runtime` (bundled `app/cli.js`, `app/browser-helper.cjs`, production `node_modules`, `bun.exe`, `bin/chatgpt-jev.cmd`, notices, sha256 `manifest.json`).
- `scripts/rebrand-chatgpt-jev.ps1` — idempotent rename script used for `9705851` (protects the upstream slug `miuuyy/codex-chatgpt-web`).
- `tests/` — 66 core `*.test.ts` files (Bun test).
- Docs/README were **not** rebranded (intentional; low value).

### 2.3 Toolchain
- **Bun 1.4.0** at `%USERPROFILE%\.bun\bin` — prepend to PATH in every new shell: `$env:Path = "$env:USERPROFILE\.bun\bin;$env:Path"`. The build script asserts Bun version == `package.json` `packageManager` pin.
- Node v24.19.0 (launcher tests via `node --test`), electron-builder 26.15.3, Electron 41.10.7, Vite renderer.
- Jev via `ai@7.0.107`: `import { experimental_evaluate as evaluate } from "ai"`, model `typesafe-ai/jev`, key env `AI_GATEWAY_API_KEY`. Load into a shell without printing: `$env:AI_GATEWAY_API_KEY = [Environment]::GetEnvironmentVariable('AI_GATEWAY_API_KEY','User')`.

---

## 3. CHRONOLOGY (commit log `00aab23..3f1130f`, all 2026-09-20)

| Commit | What |
|---|---|
| `00aab23` | upstream v5.0.8 (unchanged base) |
| `9705851` | Rebrand fork as ChatGPT Jev (identity, home, port, connector, installer GUID; updates disabled) |
| `a6ad551` | Jev: judge wrapper + adapter error classification and retry verdicts (items 1–2) |
| `3794f6e` | Jev: classify unknown ChatGPT alerts/dialogs + learn stopped-thinking labels (items 3–4) |
| `4e0ddd9` | Jev: exec approval risk/justification/injection verdicts + tool-result secret gate (items 8–10) |
| `f52729d` | Jev: compaction handoff quality gate with one re-summary (item 15) |
| `8998626` | Jev: effort-tier suggestion from request difficulty (item 13) |
| `e11a5be` | Jev: structured-output candidate tie-break + failure triage (item 14); wire 13 and 15 |
| `cf799f3` | Jev: stalled-turn classification (6), commentary→answer promotion (5), account-limit clamp (11), login-state guidance (12); **item 7 skipped** |
| `005668d` | Jev: relevance-ordered compaction trimming ahead of oldest-first (item 16) |
| `91f0523` | Jev: embedded widget classification keeps UI chrome out of answers (item 17) |
| `45e09b6` | Jev: doctor names most likely root cause + reports Jev availability (item 18) |
| `df0c3f0` | Jev: launcher crash loops end with classified cause + fix via runtime triage command (item 19) |
| `13274d7` | Jev: route conflicts name who owns Codex's `openai_base_url` and how to repair (item 20) |
| `276e62c` | Jev: `jevEnabled` config switch, `--jev/--no-jev` setup flags, daemon Jev logging, launcher toggle |
| `0d310c9` | Build: bundle Apache-2.0 notice for `@ai-sdk/provider-utils` (tarball has no LICENSE) |
| `3f1130f` | Build: drop `.gitkeep`/`.DS_Store` from runtime manifest (electron-builder strips them) |

Commit identity pattern used: `git -c user.name='ChatGPT Jev' -c user.email='chatgpt-jev@localhost' commit -q -m "..."`.

Diff scope vs upstream: 138 files, +4836/−936, **0 upstream files deleted**. Rebrand step alone: 104 files +857/−816 (string renames). Jev step: 59 files +3980/−121 (12 new judgment modules + 12 new test files + wiring).

---

## 4. THE 20 ITEMS — WHAT EACH DOES, WHERE, AND ITS FALLBACK

Common contract (see §5): Jev judges *meaning* of free text/DOM text; exact facts stay in code; **every site keeps the upstream heuristic as fallback**; fail-open on disabled/missing key/timeout/error; bounded latency.

| # | Item | Jev site id(s) | Module → wired into | Fallback when Jev off/unsure |
|---|---|---|---|---|
| 1 | Judge wrapper | — | `src/lib/judge.ts` | n/a (returns `undefined`) |
| 2 | Adapter failure classification + retry verdict | `adapter_failure` (`adapter_error` example id in judge.ts docs) | `src/lib/errors.ts` `judgeAdapterFailure` (+`ADAPTER_FAILURE_CATEGORIES`) → `src/bridge.ts` `adapterFailureFromEvent` (now async; `buildResponseJSON` async; `server.ts` awaits) | upstream regex classifier |
| 3 | Classify unknown ChatGPT alerts/dialogs | `chatgpt_dialog`, `subscription_failure` | `src/adapters/chatgpt-web/ui-judgments.ts` `visibleChatGptDialogTexts`, `judgeChatGptDialog`, `throwIfChatGptJudgedFailureDialog` → browser-worker | upstream fixed dialog list |
| 4 | Learn "stopped thinking" labels at runtime | `stopped_thinking_label`, `status_label(s)`, `completed_turn_actions_visible` | ui-judgments `learn/learnedStoppedThinkingLabels` | upstream static label set |
| 5 | Commentary→answer promotion when DOM yields empty completion | `answer_root_promotion` | ui-judgments `judgeAnswerRootPromotion` → `browser-worker.ts` `completeTurn()` hook (`CHATGPT_EMPTY_COMPLETION_MESSAGE`, `promotedAnswerSegment`) | upstream empty-completion error; DOM answer roots are never overridden |
| 6 | Stalled-turn classification | `stalled_turn` | ui-judgments `STALL_KINDS/judgeStalledTurn/stalledTurnFailure`; browser-worker observation loop `CHATGPT_STALL_FIRST_CHECK_MS=60s`, `CHATGPT_STALL_JUDGE_INTERVAL_MS=90s` | upstream stall timeout path |
| 7 | Bridge stall-budget effort hook | — | **SKIPPED**: bridge stall budget already == adapter liveness (heartbeats reset it); nothing for Jev to add | — |
| 8–10 | Exec approval risk/justification/prompt-injection verdicts + tool-result secret gate | `command_risk`, `tool_result_secrets` | `src/adapters/chatgpt-web/tool-judgments.ts` (`judgeExecApproval`, `redactKnownSecrets`, `maskSecretsInText`, `maskSecretsInToolResult`) → `mcp-server.ts` | upstream approval flow; deterministic secret regexes still run |
| 11 | Account-limit concurrency clamp | (uses dialog kind `account_temporarily_limited` → 429 `rate_limit_error`, `retryable:false`) | `concurrency.ts` (`CHATGPT_ACCOUNT_LIMIT_COOLDOWN_MS`=15 min, `noteChatGptAccountLimited`, `chatGptBrowserTabCeilingError` → 1 tab during cooldown else MAX 5) → `browser-worker.ts run()`, `turn-execution.ts getOrCreate()` | upstream MAX 5 tabs |
| 12 | Login-state guidance | `chatgpt_login_state` | ui-judgments `describeChatGptLoginState` → `src/chatgpt-session.ts` `assertAuthenticatedChatGptPage`, `src/browser-login.ts` | upstream generic "not logged in" message |
| 13 | Effort-tier suggestion from request difficulty | `effort_tier` (+`prior_turns` state key) | `effort-judgments.ts` `suggestEffortTier` (gap ≥ 2 + 10-min cooldown) → `index.ts` after 2nd `resolveChatGptWebModelMode`; **advisory only** (`console.warn "[chatgpt-jev] effort suggestion: …"`) | nothing (never changes routing) |
| 14 | Structured-output candidate tie-break + failure triage | `structured_output_candidate`, `structured_output_failure` | `output-validation.ts` rewritten async `(answer) => Promise<string>`; deterministic candidates (fenced blocks, balanced JSON spans) revalidated first; Jev only tie-breaks multiple valid candidates and triages unrepairable failures (fenced_json/trailing_prose/truncated → retryable) → `index.ts` two call sites await | upstream deterministic validator |
| 15 | Compaction handoff quality gate | `compaction_handoff` | `compaction-judgments.ts` `judgeCompactionHandoff` → accept or `runFreshCompactionFallback("jev_rejected_handoff")` (one re-summary max) → `index.ts` | accept as upstream does |
| 16 | Relevance-ordered compaction trimming | `compaction_history_relevance` | `history-judgments.ts` `rankCompactionDiscardOrder`, `protectedCompactionIndexes`, `compileChatGptWebPromptWithRelevanceTrimming` + `prompt.ts` `compactionDiscardOrder` option → 3 compaction-capable prepare sites in `index.ts` | upstream oldest-first trimming |
| 17 | Embedded widget classification | `answer_widget` | `widget-judgments.ts` `ChatGptWidgetFilter.filter(segments)` (sticky verdict per html, never empties, ≤6 candidates/scan, 2.5 s) → `browser-worker.ts` before `markdownBuffer.observe` | keep all segments (upstream) |
| 18 | Doctor root-cause triage + Jev availability check | `doctor_triage` | `src/doctor-judgments.ts` (`jevAvailabilityCheck` id `jev`, `triageDoctorChecks` id `jev-triage` → warning + TROUBLESHOOTING anchor) → `doctor.ts` `finishDoctorReport` | plain upstream check list |
| 19 | Launcher crash-loop classification | `runtime_crash_loop` (+`last_failure`) | `src/crash-judgments.ts` `classifyCrashLoop` (6 s timeout); hidden CLI `triage-crash --child --failure --restarts` prints JSON; `launcher/electron/runtime-supervisor.cjs` option `classifyCrashLoop` (execFile runtime CLI only when `AI_GATEWAY_API_KEY` in env; `null` disables) → after give-up publishes `… Jev: this looks like <kind>. <fix>`, log `runtime.<name>_crash_triaged` | upstream give-up message |
| 20 | Codex route-owner explanation | `codex_route_owner` | `src/route-judgments.ts` (`ROUTE_OWNERS` other_wrapper/stale_self/manual_provider/restored_default; `currentRouteEvidence`, `judgeCodexRouteOwner`, `explainCodexRouteConflict`) → `cli.ts route status` `hint`, `doctor.ts` codex check detail, `launcher/electron/runtime.cjs` `parseBridgeRouteResult` `; hint` | upstream conflict error text |

Tests added (all under `tests/`): `judge`, `adapter-failure-judge`, `ui-judgments`, `tool-judgments`, `compaction-judgments`, `effort-judgments`, `output-judgments`, `history-judgments`, `widget-judgments`, `doctor-judgments`, `crash-judgments`, `route-judgments` (`*.test.ts`). Launcher tests extended: `runtime-supervisor`, `runtime-host`, `packaging-contract`, etc.

---

## 5. THE JEV WRAPPER CONTRACT (`src/lib/judge.ts`)

- Constants: `JEV_MODEL="typesafe-ai/jev"`, `JEV_TIMEOUT_MS=2500` (cold gateway ≈1.3 s; hot paths pass tighter), `JEV_API_KEY_ENV="AI_GATEWAY_API_KEY"`, `CHOICE_MIN_PROBABILITY=0.7`, `CHOICE_MIN_MARGIN=0.3`, `NOUL_YES=0.7`, `NOUL_NO=0.3`, LRU cache 512 entries keyed by sha of site+state+questions.
- Exports: `judge`, `confidentChoice`, `confidentBoolean`, `nearestScoreLevel`, `setJudgeEnabled`, `onJudgeEvent`, `judgeConfigured`, `judgeEnabled`, `configureJudgeForTests`, types `JudgeEvent{site,outcome,elapsedMs,answers?,inputTokens?,error?}`, `JudgeDependencies`.
- **Disabled automatically when `NODE_ENV=test`** (Bun test sets it) — the suite never reaches the live gateway. Tests inject fakes via `configureJudgeForTests` (use **factories**, never a pre-built array of fakes — all configure calls run upfront).
- Score answers are a **0-based level index** (`nearestScoreLevel`).
- Jev `state` must be JSON-serialisable — `undefined` values break the SDK; use `"absent"` strings.
- `onJudgeEvent` receives probabilities/ids only, never judged content. `serve` logs them as `console.warn` lines; listening line shows `(mode, jev on|off|unconfigured)`.
- Importing `src/lib/judge.ts` from a script **outside the repo** yields a second module instance (listeners never fire). Put scratch benches inside the repo root as `scratch-*.ts` with `./src` imports, run, delete.

---

## 6. SWITCHES: CONFIG, CLI, LAUNCHER

- `AppConfig.jevEnabled?: boolean` (validated in `src/config.ts`). `loadConfig()` applies **disable-only** (`setJudgeEnabled(false)`) — config can never flip Jev on under `NODE_ENV=test`. Written by `setup.ts` (`SetupOptions.jevEnabled`, part of `baseConfig` shared by prod + DEV; counts as `meaningfulRuntimeChange`).
- CLI: `chatgpt-jev setup --jev | --no-jev` (production parser in `src/cli.ts` **and** DEV parser in `src/dev-chat/cli.ts` — separate allowlists). `mcp-main.ts` loads config only if it exists.
- Launcher: `runtime.cjs` `jevStatus()` / `setJev(enabled)` → `runSetup("jev", [...setup args, "--jev"|"--no-jev"])` (DEV: `runDevSetup`, no route flags); `main.cjs` IPC `launcher:jev` (no arg = status, boolean = set; **rejected during active turns**); `preload.cjs` exposes `jev`; `types.ts` `JevStatus{configured,enabled,keyPresent}`; `App.tsx` SettingsSurface row **"AI judgments (Jev)"** after "Skills as files"; i18n keys `jevJudgments/jevJudgmentsBody/jevKeyMissing` in all 5 locales. No `state.cjs` changes.
- `doctor` reports both "Jev judgments are configured" (key present) and enabled state, independent of each other.

---

## 7. BUILD & INSTALL PIPELINE

From `d:\Projects\chatgpt-jev\launcher` with Bun on PATH:
1. `bun run package:win` → `bun run build` (tsc + vite) → `bun run build:runtime` (`scripts/prepare-runtime.cjs` → root `scripts/build-runtime-bundle.ts`) → `scripts/package.cjs --win` (electron-builder NSIS, per-user). Output: `launcher/artifacts/chatgpt-jev-5.0.8-win-x64.exe`.
2. `bun run smoke:package` → silent `/S /currentuser` install + `ChatGPT Jev.exe --launcher-smoke-test` → expects `PACKAGED_LAUNCHER_SMOKE_OK`.
3. Verify both HKCU uninstall keys exist (`d1a6026a…` Codex Web GPT, `a10be615…` ChatGPT Jev) and Codex Web GPT file count/bytes unchanged.

Build fixes that were required (keep them):
- `0d310c9`: `@ai-sdk/provider-utils@5.0.45` ships no LICENSE → `LICENSES/ai-sdk-provider-utils-5.0.45-Apache-2.0.txt` + `bundledLicenseOverrides` entry in `scripts/generate-third-party-notices.ts` (mirrors the tiktoken override). 111 runtime pkgs standalone / 119 with launcher.
- `3f1130f`: electron-builder's `builder-util` `walk` unconditionally drops `.gitkeep`/`.DS_Store` from `extraResources`; `undici` ships `lib/llhttp/.gitkeep` → packaged launcher died at start with "Runtime bundle file is missing" (sha256 manifest check). Fix: `runtimeManifestFiles()` in `scripts/build-runtime-bundle.ts` `rmSync`s and skips those names. Manifest now 7440 files.

Installed-build checks already done: `"%LOCALAPPDATA%\Programs\ChatGPT Jev\resources\runtime\bin\chatgpt-jev.cmd" --version` → `5.0.8`; `doctor` with isolated `CHATGPT_JEV_HOME`/`CODEX_HOME` → "Configuration is missing … Run chatgpt-jev setup first" + "Jev judgments are configured" (exit 1 expected; no route touched).

---

## 8. VERIFICATION EVIDENCE

- Typecheck: core `bun run typecheck` 0 errors; launcher `tsc --noEmit` 0 errors; `vite build` OK.
- Launcher tests (`node --test tests/*.test.cjs`): **309 pass / 1 fail / 2 skipped**. The 1 failure is the pre-existing EPERM symlink test (Windows, no symlink privilege) — identical on upstream baseline.
- Core tests (66 files via capped per-file runner, §11): **689 pass / 3 fail / 2 hung**. Failures: 2 × EPERM symlink in `codex-integration`, 1 × "Bigger Context" 33 s timeout in `browser-worker-contract` — all identical on upstream baseline (rebrand-only run: 717 pass / same 3 fails). Hung: `chatgpt-web-harness` and `turn-broker-lifecycle` — Bun 1.4.0 Windows named-pipe wedge (§9). `turn-broker-lifecycle` passes 13/13 alone; `chatgpt-web-harness` with `-t "^(?!.*revoking a turn rejects pending invocations)"` → 82 pass / 0 fail / 1 filtered.
- Live Jev benches (deleted scratch scripts, results recorded): error classifier 17/18 vs upstream regex 8/18; stopped-label 16/16; crash-loop 6/6 confident; route-owner 5/5 at p=0.97–0.99.
- Packaged smoke: `PACKAGED_LAUNCHER_SMOKE_OK win32/x64`.

---

## 9. PARITY PROOF (answers "was the source really the same as the installed app?")

Method: `git worktree` of untouched `00aab23` in `%TEMP%`, `bun install --frozen-lockfile --ignore-scripts`, `bun run scripts/build-runtime-bundle.ts <out>` (stops at notices step without `launcher/node_modules` — irrelevant), `@electron/asar` extract of the installed `app.asar`, `bun run build` in the worktree's `launcher/`. SHA-256 compared:
- Runtime: **5997 / 5997 files identical** (`app/cli.js` `6A5B17C8D6FF…`, `app/browser-helper.cjs` `47EBBF9516B8…`, `app/package.json` `E988A5670FF4…`, `bin/codex-chatgpt-web.cmd` `948AF260CC06…`, every `node_modules` file). Only `LICENSE`, `THIRD_PARTY_NOTICES.txt`, 3 `LICENSES/*` not rebuilt.
- Electron shell (`app.asar/electron/*.cjs`): **24 / 24 identical** to `launcher/electron/` source.
- Renderer (`app.asar/dist/**`, content-hashed names `index-B2QxcYSm.js`, `index-DgsvyiQX.css`): **5 / 5 identical**.
Conclusion: installed Codex Web GPT is a verbatim upstream v5.0.8 build; ChatGPT Jev = that code + rebrand + additive Jev. All temp artifacts removed.

---

## 10. NOT DONE / OPEN DECISIONS FOR THE OWNER

1. **`chatgpt-jev setup` has not been run in the owner's real profile.** Doing so with `--replace-codex-route` takes Codex's `openai_base_url`/`model_provider` away from the running Codex Web GPT (only one owner). Owner must decide which app owns the route. `route status` / `doctor` will name the owner (item 20). To try Jev without touching Codex: run the launcher/daemon with an isolated `CHATGPT_JEV_HOME` and `CODEX_HOME`.
2. Item 7 skipped (redundant) — re-open only if the owner wants a Jev hook on the bridge stall budget despite heartbeat liveness.
3. Docs/README/CHANGELOG still say codex-chatgpt-web; rebrand them only if asked.
4. No macOS/Linux packaging attempted (`package:mac`/`package:linux` untested for the fork).
5. `origin` = `https://github.com/miuuyy/codex-chatgpt-web.git` (upstream, read-only for us). Owner wanted local-only; if a remote is ever wanted, add a **new** remote — do not push to `origin`.

---

## 11. COMMAND CHEAT SHEET (PowerShell)

```powershell
# every new shell
$env:Path = "$env:USERPROFILE\.bun\bin;$env:Path"
$env:AI_GATEWAY_API_KEY = [Environment]::GetEnvironmentVariable('AI_GATEWAY_API_KEY','User')   # never echo it
Set-Location 'd:\Projects\chatgpt-jev'

bun run typecheck                                  # core tsc
bun run --cwd launcher typecheck                   # launcher tsc
bun run --cwd launcher test *> "$env:TEMP\l.txt"; Select-String -Path "$env:TEMP\l.txt" -Pattern '^\S* (tests|pass|fail) \d+'
# core tests: ALWAYS capped per file (Bun wedge) — see Appendix A
& "$env:TEMP\jev-run-tests.ps1" -CapSeconds 240 -Files @('tests/judge.test.ts','tests/ui-judgments.test.ts')
Get-Content "$env:TEMP\jevrun-report.txt"

bun run --cwd launcher package:win                 # installer → launcher/artifacts/
bun run --cwd launcher smoke:package               # silent reinstall + PACKAGED_LAUNCHER_SMOKE_OK

# kill ONLY stray test bun processes (never the Codex Web GPT runtime bun.exe)
Get-Process -Name bun -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*\.bun\bin\*' } | Stop-Process -Force

git -c user.name='ChatGPT Jev' -c user.email='chatgpt-jev@localhost' commit -q -m "..."
```

Gotchas learned (all verified this session):
- `powershell -File runner.ps1 -Files a,b` passes ONE string; call the script with `& … -Files @('a','b')`.
- `Start-Process -ArgumentList` entries containing spaces need embedded double quotes.
- Launcher spec reporter prints non-ASCII glyphs → redirect `*> file` then filter; core uses `^\(fail\)|^\d+ pass`.
- Bun 1.4.0 on Windows intermittently wedges (event loop frozen, 0 CPU, timeouts never fire) in named-pipe TurnBroker tests — reproduced on untouched upstream, not Jev. Never run `bun test` inline without a cap.
- `git stash pop` fails ("already exists") when an untracked file replaced a tracked one — check `git stash list`, drop manually.
- Windows 8.3 short paths (`DRFAIS~1`) break `.Substring(path.Length)` relative-path math — resolve with `(Get-Item $dir).FullName` first.
- `Join-String` does not exist in Windows PowerShell 5.1 — use `-join`.

---

## 12. MEMORY / RECORDS

- Copilot user memory: `/memories/codex-web-gpt.md` (both apps, parity proof), `/memories/typesafe-jev.md` (Jev integration lessons), `/memories/electron-builder-gotchas.md`.
- Session memory (detailed commit-by-commit log + gotchas): `/memories/session/chatgpt-jev-build.md`.
- MemPalace wing `codex_web_gpt`: rooms `milestones` (installer + side-by-side), `bugs` (.gitkeep/electron-builder, Bun wedge), `decisions` (parity proof + diff scope), plus diary entry.
- Repomix packs from the audit (may be gone from `%TEMP%`): compressed `f509588c9777923b`, targeted `4719b2872083a6f1`.

---

## APPENDIX A — capped per-file core test runner (`%TEMP%\jev-run-tests.ps1`; recreate if missing)

```powershell
param(
  [string]$Repo = 'd:\Projects\chatgpt-jev',
  [int]$CapSeconds = 240,
  [string[]]$Files
)
Set-Location $Repo
$bun = "$env:USERPROFILE\.bun\bin\bun.exe"
if (-not $Files) { $Files = Get-ChildItem tests -Filter *.test.ts | ForEach-Object { "tests/$($_.Name)" } }
$report = @()
foreach ($file in $Files) {
  $attempt = 0
  do {
    $attempt++
    $out = "$env:TEMP\jevrun-$([IO.Path]::GetFileNameWithoutExtension($file)).txt"
    $p = Start-Process -FilePath $bun -ArgumentList 'test', $file -RedirectStandardError $out -RedirectStandardOutput "$out.out" -PassThru -NoNewWindow
    $done = $p.WaitForExit($CapSeconds * 1000)
    if (-not $done) { Stop-Process -Id $p.Id -Force; Start-Sleep -Milliseconds 300 }
    $lines = Get-Content $out -ErrorAction SilentlyContinue | ForEach-Object { ($_ -replace '[^\x20-\x7E]', '') }
    $pass = ($lines | Where-Object { $_ -match '^\s*(\d+) pass' } | Select-Object -Last 1) -replace '\D', ''
    $fail = ($lines | Where-Object { $_ -match '^\s*(\d+) fail' } | Select-Object -Last 1) -replace '\D', ''
    $failed = $lines | Where-Object { $_ -match '^\(fail\)' } | ForEach-Object { $_.Substring(0, [Math]::Min(110, $_.Length)) }
    $status = if (-not $done) { 'HUNG' } elseif ($fail -and $fail -ne '0') { 'FAIL' } else { 'ok' }
  } while ($status -eq 'HUNG' -and $attempt -lt 2)
  $report += "{0,-6} {1,-46} pass={2,-4} fail={3,-3} attempts={4}" -f $status, $file, $pass, $fail, $attempt
  foreach ($f in $failed) { $report += "         $f" }
}
$report | Set-Content "$env:TEMP\jevrun-report.txt"
$report
```
