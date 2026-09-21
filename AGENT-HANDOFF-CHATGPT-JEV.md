# AGENT HANDOFF — ChatGPT Jev (Codex Web GPT fork + Jev judgment layer)

**Handoff written:** 2026-09-20; updated 2026-09-21
**Updated by:** GitHub Copilot after required-Jev uncertainty recovery, browser pause-state regressions, and isolated verification of the new installer. Earlier release and parity evidence is historical.
**For:** any incoming AI agent picking up this project
**Status:** UNCERTAINTY-RECOVERY BUILD PACKAGE-SMOKE VERIFIED; NOT INSTALLED. The earlier MCP fix is now verified in `C:\Program Files\ChatGPT Jev`, but its agent did not perform that installation. Source remains `D:\Projects\chatgpt-jev`, branch `main`, HEAD `ef063ddcecaf3e1e715742e4ac5166eb4c97880f`, plus uncommitted saved-chat and recovery work. The owner approved building and updating that target in this session. The agent remains non-elevated and cannot update Program Files; the owner must run the installer as administrator. No live-app restart, route takeover, commit, or push occurred. Authenticated end-to-end stability is unverified. Read section 0.3 and `AGENTS.md` before continuing.

---

## 0. TL;DR — WHERE THINGS STAND

| Item | State |
|---|---|
| Source repo | `d:\Projects\chatgpt-jev`, branch `main`, HEAD `ef063dd` plus uncommitted saved-chat, MCP recovery, and required-review pause/retry changes |
| Base | upstream `miuuyy/codex-chatgpt-web` tag **v5.0.8** = commit `00aab23` (MIT). `origin` still points at upstream — **never push** |
| Rebrand | ✅ commit `9705851` — product "ChatGPT Jev", own appId/GUID/home dir/port/pipe/connector names; auto-updates disabled |
| Jev policy | Required at suitable semantic decisions; explicit failure instead of silent heuristic substitution. Item 7 remains unnecessary because exact liveness stays in code. |
| Config/CLI/UI | Legacy `jevEnabled:false` normalizes to true with a warning; `--no-jev` is rejected; launcher row is required status, not a toggle. |
| Windows installer | `launcher/artifacts/chatgpt-jev-5.0.8-win-x64.exe`, 153,495,130 bytes, built 2026-09-21T03:14:58.880Z; unsigned; new uncertainty-recovery build; hashes in section 0.3 |
| Last verified installed fork | Runtime `5.0.8` at `C:\Program Files\ChatGPT Jev`; CLI SHA-256 `7f425ef3eea5ba9288ea7b8818f06925ab316d1534978a2c8c2caa79db02abfb` matches the earlier MCP recovery build, NOT the new uncertainty-recovery build. The old LocalAppData install path is absent. |
| Codex Web GPT untouched | ✅ verified byte-count/newest-file unchanged: 6081 files / 554,415,894 bytes / newest 2026-09-19 19:39:19; GUID `d1a6026a-6210-588e-9a2b-da3936f94e02` |
| Current verification | 151 focused tests pass, core typecheck and `git diff --check` pass; Windows artifact produced after launcher typecheck/build. Live production Jev consumers passed. No full-suite or authenticated coding-session claim. |
| Packaged smoke | Fresh `EXTRACTED_PACKAGED_LAUNCHER_SMOKE_OK`: actual installer extracted with existing 7-Zip, packaged runtime validated, app launched with isolated launcher/core/Codex profiles, durable runtime validated. No installation or authenticated ChatGPT test. |
| Parity proof | ✅ installed Codex Web GPT == fresh build of untouched v5.0.8: runtime 5997/5997, Electron shell 24/24, renderer 5/5 SHA-256 identical (§9) |
| Setup in real profile | ⬜ NOT RUN (would take Codex's `openai_base_url` from the running Codex Web GPT — owner must choose, §10) |

**Two most important facts:**
1. The owner's installed "Codex Web GPT" **is** the open-source upstream product; the fork was cloned from that exact release. The current fork source and verified installed build require Jev at semantic judgment sites. Missing, failed, or uncertain required decisions pause or fail explicitly; exact facts, authorization, and schemas remain deterministic.
2. **Do not intermix the two projects.** Never edit anything under `%LOCALAPPDATA%\Programs\Codex Web GPT` or `~/.codex-chatgpt-web`. Never kill `bun.exe` processes whose path is under `~\.codex-chatgpt-web\versions\...\runtime\` — they are the running Codex Web GPT app.

---

## 0.1 SAVED CHATS AND LONG-HORIZON RECOVERY (CURRENT)

- The reported smoke error was caused by Jev rejecting the ordinary paragraph `CODEX WEB GPT READY` as widget chrome. The widget filter now supplies HTML tag/interactive-markup evidence and distinguishes authored literal replies from actual UI status. Every text-bearing block still requires a confident Jev decision; no fallback or smoke-phrase workaround was added.
- New chats use `https://chatgpt.com/`, never `?temporary-chat=true`. Only the owned home or strict `/c/<UUID>` paths are accepted for normal operation. This preserves normal ChatGPT history but does not enable account-level Memory, change training/privacy settings, or recover old Temporary Chats. Connector selection no longer changes account personalization.
- Automatic tool-capable keyed threads can restore a saved conversation after launcher restart. Existing keys include provider configuration, native thread, model, reasoning, and compaction epoch. The private `saved-conversations.json` beside the launcher descriptor keeps at most 512 records and rejects oversized/corrupt input. It contains only key/profile/connector identity, canonical conversation URL, hashed account user ID, final user/assistant UUIDs, timestamp, and readiness. No prompt, token, raw account ID, or connector authorization is persisted.
- Restoration verifies the current authenticated account and the exact completed message checkpoint. The same validation applies to ready in-memory tabs. Changed or unverified accounts stop explicitly. A missing/changed/unfinished conversation may rebuild from full canonical Codex history only after same-account proof; retained-only work instead fails closed. Reopened chats reselect the connector and use fresh per-turn native broker authorization.
- Before a verified lease is returned, its record becomes unfinished while retaining the account binding. A crash cannot cause suffix-only replay. Failed tab allocation leaves the checkpoint resumable. A dead-helper replacement still checks the original account. Concurrent identical starts await one verified result; different owners are rejected. Checkpoint writes finish before tabs become reusable, and completion cannot replace an account binding. A checkpoint-save failure warns without discarding an already completed result.
- Zero Risk uses ordinary saved chats but remains human-controlled. It does not perform hidden DOM/session inspection or automatic restart-index restoration. Browser-only/Luna paths retain their existing canonical-context/checkpoint behavior rather than gaining tool-mode restart restoration. Account settings may still determine what ChatGPT retains remotely.
- Live Jev: classifier repair and saved-per-thread architecture selected with probability 1; strict account boundary and pending-start coalescing selected with probability 1; two review repairs selected with probability 0.92. Fresh production-filter checks: exact smoke reply kept at 0.95, ordinary prose kept at 0.96, actual loading status rejected at 0.21. Earlier inference timeout failed closed; a malformed PowerShell invocation produced no verdict. Neither is counted as a pass.
- The owner requested mandatory Jev for suitable coding judgments across projects and long-horizon workflows. This is saved in `~/.copilot/copilot-instructions.md` alongside existing Ponytail guidance. It is a mandatory instruction policy, not a new universal cross-agent enforcement hook. Native tools, exact checks, permissions, and authorization remain authoritative.

Previous saved-chat artifact SHA-256 (superseded): `9F48624B487A5DD3C3DE8B9F2593453030E19176131747613BF0EB1C85E8E61C`.
The previous manual-install restriction was superseded only for this session by explicit approval to build and update `C:\Program Files\ChatGPT Jev`, restarting only ChatGPT Jev. Installation could not proceed without elevation. Do not infer future installation, commit, push, or route-change authorization from this history.

## 0.2 MCP REVIEW RECOVERY AND ACTUAL INSTALL TARGET (PRIOR PHASE)

- Owner correction: `we had to implement these chanegs in the chatgpt jev project =  C:\Program Files\ChatGPT Jev`. Six running ChatGPT Jev process paths confirmed that target. The source repo is the build input, not a second product. Original Codex Web GPT was not touched.
- The failed-turn logs show two native `read_thread` calls completed, then a local browser abort about one second after the second result. The diagnostic snapshot still showed a stop button and no nonempty error overlay. The original MCP exception was not logged, so its exact triggering review verdict cannot be proven from those records.
- Reproduced defect: `mcp-server.ts` released the entire turn binding on every exception, including a required Jev review failure before native execution or after a confirmed result. Binding retirement aborts the browser and becomes the screenshot's generic submitted-turn failure.
- The fix tracks `not_started`, `pending`, and `completed`. A non-cancelled `JevDecisionError` outside pending native execution now returns an explicit `jev_decision_required` tool error, `execution_state`, and `retryable:false`, without revoking the session. Unreviewed data is withheld; completed work is not automatically rerun. The affected decision remains paused. Cancellation, overall deadlines, and unresolved native work retain retirement behavior, including cancellation whose reason is itself a `JevDecisionError`.
- Four regression cases were observed red, then green. Fresh checks: MCP suite 7/7, selected reconnect/cancellation/native-deadline harness 6/6 (80 unrelated cases filtered), tool judgments 15/15, core and launcher typechecks, renderer build, Windows packaging. No new dependency. The prior unrelated worker failures were not rerun.
- Live shared Jev chose cause inspection, phase-aware recovery, and cancellation precedence with probability 1 in separate answered calls. Automated tests used explicit offline fixtures. The read-only reviewer lacked terminal/Jev capability and did not provide an independent approval.
- Actual installer SHA-256: `0489a3b930ceb18b050805c956314a9d323147e91f05806d915afe3f4b9364e2`. Packaged CLI SHA-256: `7f425ef3eea5ba9288ea7b8818f06925ab316d1534978a2c8c2caa79db02abfb`. Installer is `NotSigned`, 153,493,531 bytes, at `launcher/artifacts/chatgpt-jev-5.0.8-win-x64.exe`.
- Package verification extracted the actual NSIS payload, validated all runtime hashes, ran `--launcher-smoke-test` with disposable profiles, and validated the resulting durable runtime. It did not run the installer, use the real browser account, change a route, or stop the running app. Initial verification commands failed before extraction due to terminal operator rewriting and an unhoisted archive dependency; the corrected native 7-Zip check passed.
- At the end of this phase installation required the owner to run the installer as administrator. A later fingerprint verified this phase's CLI hash in Program Files. The agent did not perform that installation. The new artifact below still requires administrator installation; never trigger UAC through tools or infer future authorization from this history.

## 0.3 REQUIRED-REVIEW UNCERTAINTY RECOVERY (LATEST)

- Latest report: `stream disconnected before completion: Jev is required at choice: the answer is uncertain; clarify the input and retry. No heuristic fallback was used.` The earlier MCP fix was already installed. Helper logs also showed uncertain booleans during browser observation/compaction, plus an effort timeout. The historical generic choice error lost its call-site identity; the exact failing choice site cannot be proven.
- Reproduced causes: the shared wrapper cached raw answers before consumer confidence validation; a failed required observation killed an accepted browser turn; stall checks measured total age instead of inactivity. `judge.ts` now accepts a consumer validator, evicts invalid cached answers, and retries recoverable inference at most three times before returning a site-specific error. Only successfully validated new answers are cached at opted-in sites. Thresholds are unchanged. UI, widgets, native-tool review, compaction, and effort consumers opt in; unrelated consumers retain their existing behavior.
- Browser recovery keeps the same accepted turn with visible pause/resume commentary, heartbeats, fresh observations, and 5/10/20/30-second capped backoff. It never resubmits the prompt, replays native work, or releases output awaiting review. Actual text/status/native activity resets the stall window. A confident `completed` stall outcome still requires the ordinary completion tracker/fence.
- Review regressions were reproduced red then repaired: pending-stall output emission, stale current/cached stopped-label flags, successful review crossing the owner deadline, temporary missing snapshots clearing pending review, and a second review failure overwriting an unresolved stall decision. `pendingStallReview` survives absence and other gate failures until a successful stall verdict before output. Cancellation, deadlines, closed tabs, account boundaries, explicit upstream errors, and missing-key failures remain authoritative.
- Scope limit: unresolved browser reviews stay visibly paused until accepted or cancelled/timed out. Compaction and native-tool review use bounded retries and can still report an explicit unresolved failure; completed native work is never rerun. Other required judgment sites were not rewritten. This is not proof of uninterrupted operation under every provider/browser failure.
- Focused checks: judge 12, UI judgments 22, widgets 7, tool judgments 17, compaction judgments 5, effort 3, MCP observation 7, browser recovery 14, response DOM 3, helper client 7, retained compaction 36, process writer 1, selected adapter harness 6, selected worker contracts 11: **151 passed**. Core typecheck passed after final code changes; editor diagnostics were clear. One selected pre-existing multipart test needed its mock's missing `allInnerTexts` method; no production workaround or test skip was added. The full suite and authenticated Electron/coding flow were not run.
- Live shared Jev design decisions selected validated recovery, same-turn pause, and explicit completion at probability 1. Independent review found concrete blockers, then validated the missing-snapshot blocker at 0.97 after an earlier uncertain combined request. Final actual consumer checks: active turn `still_generating` 1, completed turn `completed` 0.88, authored paragraph 0.96. A broad release judgment remained uncertain after three attempts and was not treated as approval. A clarified **local build and isolated smoke only** decision returned `build_and_smoke` 0.92. Offline tests are not live inference.
- Windows packaging produced the new artifact after its terminal completion output was lost. The actual NSIS payload was extracted and all 7,440 runtime files validated. Packaged CLI/helper hashes matched the new build outputs. `EXTRACTED_PACKAGED_LAUNCHER_SMOKE_OK` passed with disposable launcher/core/Codex homes and no gateway key, followed by validation of the isolated durable runtime. The first check incorrectly searched for a minified variable name and failed before launch; corrected stable-message/hash checks passed. A live Node consumer probe also failed before inference on extensionless imports; the Bun probe above succeeded.
- **New installer SHA-256:** `a0aad6bf1aac8d137a71b6b318bf7fd06703078f8eb4813b94ae4df6a6c7c392`.
- **New CLI SHA-256:** `f2cbd825d9b5a5ba4fcac156443961ae187f29b6ab87c79b12038da196c365e0`.
- **New helper SHA-256:** `989bd8c79e06626ef6dfabc140fce8b91753507e9d26d2f64df778eb1b6f146a`.
- **Runtime bundle ID:** `31f96d1df9a311e20eb30947d6ec00de7654cdb68abde7ed8fc5c4337da5f65f`.
- Final installation check: `Elevated:false`, installer `NotSigned`, installed CLI still `7f425ef3...`. Close only ChatGPT Jev and have the owner run the new installer as administrator, retaining `C:\Program Files\ChatGPT Jev`. Verify the new CLI hash after installation; reproduce the coding flow only with fresh authorization. No original-app files, real account profiles, Codex routes, or running production processes were changed by package smoke.

---

## 1. OWNER'S DECISIONS (verbatim intent — binding)

1. "PLEASE USING **JEV** MAXIMALLY … SCAN THE ENTIRE PROJECT AND GIVE ME A LIST OF ALL OPTIMIZATIONS" → audit produced 20 items; owner chose **"Full — all 20 items in priority order"**.
2. "YES RUN EVERYWHERE WILL FULL POWER AND 100% RESULTS" → Jev is used in **all** modes, **including Zero Risk mode**.
3. "OPTION 1 BUT **DONT MERGE IT WITH THE CURRENT PROJECT** -- CREATE A TOTALLY DIFFERENT PROJECT … **NAME IT CHATGPT JEV** … **DONT INTERMIX BOTH PROJECTS**" → separate folder, separate product identity, separate install dir, separate state dir, separate port, separate connector names.
4. Original decision: "Local clone only (no GitHub account needed)". Subsequently the owner authorized publication to `https://github.com/jerryboganda/chatgptjev`; remote `github` hosts `chatgpt-jev` at `782db0b` and `main` at `ef063dd`. `origin` remains read-only upstream. That completed publication does not authorize new commits/pushes.
5. Install **side-by-side**, leaving the installed Codex Web GPT untouched and running.
6. Priority order used for implementation: 1+2 → 3+4 → 8+9+10 → 15 → 6+7 → rest.
7. Latest request: `please remove all of the original developers restrictions --- use " jev " ai model for everything literally you do ---- DONT BYPASS IT OR FORGET TO USE IT OK ---- USE IT FOR ALL POSSIBLE TASKS OK ?????????`; selected scope: **"Both: app and coding workflow."**
8. Approved interpretation: require Jev for suitable semantic decisions, not code generation, exact computation, validation, or tool execution. Missing, failed, uncertain, or timed-out required decisions must pause/error visibly. Authentication, native authorization, account protections, secrets, schemas, route ownership, and original-app isolation stay intact. Exact-input caching and explicit offline test providers are allowed. This is not authorization to remove security controls or take over the real Codex route.
9. Approved saved-chat design: "Yes, implement this design" for saved per-thread chats and durable conversation links while leaving account Memory settings unchanged, fixing smoke classification, preserving isolation, and building an installer.
10. Latest requests: `make everything maximum " Agentic & Long Horizon Coding Workflows Supportive"` and `apply jev by default / force for all coding related tasks especially ok ?`.

Security rules carried through: the Jev key `AI_GATEWAY_API_KEY` is in the owner's **User** environment. Never print it, never put it in files, never pass it to the Electron renderer (only the daemon process reads it).

---

## 2. PROJECT FACTS

### 2.1 Two installed apps (both v5.0.8)
| | Codex Web GPT (owner's original, DO NOT TOUCH) | ChatGPT Jev (this fork) |
|---|---|---|
| Install dir | `%LOCALAPPDATA%\Programs\Codex Web GPT` | `C:\Program Files\ChatGPT Jev` (verified 2026-09-21; old LocalAppData location absent) |
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

## 3. HISTORICAL RELEASE CHRONOLOGY (commit log `00aab23..3f1130f`, all 2026-09-20)

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

`682c2d6` added this handoff after the initial release. `782db0b` committed the required-Jev policy, was published to `github/chatgpt-jev`, and was packaged and installed with owner authorization. `ef063dd` committed the Windows test-portability fixes and was published to `github/main`; its installer was generated for manual installation. Saved-chat and MCP recovery work remains uncommitted but is now verified in the installed build. The latest uncertainty-recovery work is uncommitted and packaged only. Do not commit or create branches without the owner's request.

Historical initial-release diff vs upstream: 138 files, +4836/−936, **0 upstream files deleted**. Rebrand step alone: 104 files +857/−816 (string renames). Jev step: 59 files +3980/−121 (12 new judgment modules + 12 new test files + wiring).

---

## 4. CURRENT SEMANTIC GATES

Jev judges meaning; exact facts and native permissions remain in code. A required semantic judgment may not silently fall back to the old heuristic. The existing legacy deterministic classifier remains for exact/compatibility paths, not as an unavailable-Jev substitute.

| # | Area | Current behavior and ownership |
|---|---|---|
| 1 | Shared wrapper | `src/lib/judge.ts` validates consumed answers before caching at opted-in sites, with bounded fresh recovery attempts and explicit required-decision errors. |
| 2 | Adapter failures | `src/lib/errors.ts`, `bridge.ts`, and `server.ts` require message-only semantic classification, preserve exact structured error fields, and never recursively classify Jev infrastructure errors. Browser helper IPC preserves the same metadata, including after submission. |
| 3-6, 12 | Browser meaning | `ui-judgments.ts` requires unknown dialog/status/login, answer-promotion, and stalled-turn judgments. After submission, recoverable observation failures visibly pause the same browser turn; unresolved gates block output. Authentication, cancellation, deadlines, and exact DOM/protocol facts remain authoritative. |
| 7 | Bridge liveness | No extra Jev hook: heartbeats and deadlines are deterministic, not semantic decisions. |
| 8-10 | Native tools and output | `tool-judgments.ts` reviews native JSON/freeform payloads through shared `mcp-server.ts` invocation. Required approval must be representable by the native schema or execution stops. Native Codex still authorizes execution. Text output uses overlapping 512-character chunks; serialized structured output includes property names and numeric values. Known credential patterns are redacted locally before inference. |
| 11 | Account protections | Jev classifies account-limit meaning; existing concurrency/cooldown protections remain. |
| 13 | Effort suggestion | `effort-judgments.ts` is awaited when applicable. Its suggestion remains advisory and never changes the user's selected model/effort by itself. |
| 14 | Structured output | `output-validation.ts` keeps exact whole-answer JSON/schema validation deterministic. Extracted candidates, including a sole candidate, require semantic selection with an explicit `none` option; failure triage is required. |
| 15 | Compaction quality | `index.ts` and `compaction-judgments.ts` gate retained, fresh, and ordinary browser-only summaries before release. A generated replacement summary is also judged; it is not a heuristic bypass. |
| 16 | History selection | `history-judgments.ts` ranks every unprotected candidate in batches of 40. Missing rankings do not default to oldest-first. |
| 17 | Widgets | `widget-judgments.ts` reviews all text blocks in batches of six, keys cached verdicts by full input, and permits an empty result when every candidate is rejected. |
| 18 | Doctor | `doctor-judgments.ts` and `doctor.ts` report required-Jev failures as errors. A failed route explanation becomes a check in valid Doctor JSON rather than destroying the report. |
| 19 | Crash loops | `crash-judgments.ts` and `runtime-supervisor.cjs` invoke required triage; unavailable judgments are reported visibly with sanitized messages, not replaced with a guessed cause. |
| 20 | Route explanation | `route-judgments.ts` explains conflicts without changing route ownership. Inference-only HTTP(S) URLs retain origin/path but remove userinfo, query, and fragment; malformed URLs become `unreadable`. |

The shared MCP deadline covers semantic review, native execution, and all output-review batches; the remaining turn lifetime bounds that deadline. Caller cancellation propagates into the judge and output masking. No unfinished review releases a native result.

Limits: semantic privacy checks are not universal secret detection. Non-text media and metadata are not reviewed by the text gate, and secrets embedded in URL paths may remain in route evidence. Compaction evidence is bounded (summary 6000 characters, transcript tail 6000, individual records 1200, latest request 2000), so acceptance is not a proof over the entire conversation. Account protection and authorization must never depend only on a model verdict.

Tests added (all under `tests/`): `judge`, `adapter-failure-judge`, `ui-judgments`, `tool-judgments`, `compaction-judgments`, `effort-judgments`, `output-judgments`, `history-judgments`, `widget-judgments`, `doctor-judgments`, `crash-judgments`, `route-judgments` (`*.test.ts`). Launcher tests extended: `runtime-supervisor`, `runtime-host`, `packaging-contract`, etc.

---

## 5. THE JEV WRAPPER CONTRACT (`src/lib/judge.ts`)

- `JEV_MODEL="typesafe-ai/jev"`, `JEV_TIMEOUT_MS=5000` per attempt, one SDK retry within that attempt's hard deadline. Call sites supplying `validate` allow at most `JEV_MAX_RECOVERY_ATTEMPTS=3` attempts; other sites retain one. Callers may set an explicit per-attempt budget. `Promise.race` bounds providers that ignore abort; caller cancellation is checked before cache use and after inference/validation. The owning operation's deadline remains separate and authoritative.
- `JevDecisionError`: HTTP 503, `server_error`, code `jev_decision_required`, `retryable:false`. No answers are replaced by `undefined` on unavailable, disabled, failed, or timed-out inference. Consumed choice/boolean answers reject missing, non-finite, or uncertain values. Explicit caller cancellation retains its original reason.
- Choice thresholds: probability 0.7, margin 0.3. Boolean thresholds: yes at or above 0.7, no at or below 0.3. Scores map finite, fractional zero-based positions to the nearest level.
- Exact-input LRU: 512 entries keyed by SHA-256 of site, state, and questions. A supplied validator must pass before cache insertion/return; rejected cached entries are evicted. Validate only consumed answer branches. Cache hits and recovering attempts are logged separately from accepted new answers. `onJudgeEvent` logs only probabilities/ids and sanitized failure information, never judged content; the browser helper now forwards those events to diagnostics too.
- `setJudgeEnabled(false)` rejects. `setJudgeEnabled(true)` cannot enable the default live provider under `NODE_ENV=test`. Tests explicitly install and restore offline providers through `configureJudgeForTests`; integration helpers live in `tests/fixtures/jev.ts` and reject use outside tests or unknown questions.
- AI SDK 7 questions use `instructions` and, for choices, a `criteria` object mapping choice IDs to descriptions. Do not use `question`/`choices`. State must be JSON-compatible; use explicit `null` or `"absent"`, not `undefined`.
- Import the shared module consistently from this repository. Use Bun for live production-consumer probes: Node strip-only mode rejects constructor parameter properties, and Node's transform-types mode still cannot resolve extensionless TypeScript consumer imports. Never print the key or raw provider error payloads.

---

## 6. REQUIRED POLICY: CONFIG, CLI, LAUNCHER

- `AppConfig.jevEnabled?: boolean` remains readable for compatibility. A legacy false value normalizes to true with a visible warning; reading configuration does not rewrite the profile on disk. The runtime cannot disable required decisions.
- Production and DEV setup reject `--no-jev`, and `SetupOptions.jevEnabled:false` is rejected before profile changes. `--jev` remains a compatibility flag. Loading config cannot enable live inference under `NODE_ENV=test`.
- Launcher `jevStatus()` reports `{configured, enabled:true, keyPresent}`. `setJev(false)` rejects; true is a compatibility no-op returning status, with no setup, restart, or route mutation. Existing IPC/preload names remain compatible.
- The Settings row "AI judgments (Jev)" displays "Required" or "Required. AI_GATEWAY_API_KEY is missing." with no toggle. All five locale copies were updated. The renderer receives only presence/status, never the key.
- Doctor reports unavailable required inference as an error. A valid diagnostic report is still returned when a route-owner judgment fails.

---

## 7. BUILD & INSTALL PIPELINE

These commands describe separate release actions. Required-Jev commit `782db0b` was packaged and installed successfully. The later `ef063dd` and current saved-chat installers were generated for manual installation. In particular, `smoke:package` silently reinstalls the fork; it is not a read-only test. Confirm installation authorization before running it and preserve the original app and real Codex route.

From `d:\Projects\chatgpt-jev\launcher` with Bun on PATH:
1. `bun run package:win` → `bun run build` (tsc + vite) → `bun run build:runtime` (`scripts/prepare-runtime.cjs` → root `scripts/build-runtime-bundle.ts`) → `scripts/package.cjs --win` (electron-builder NSIS, per-user). Output: `launcher/artifacts/chatgpt-jev-5.0.8-win-x64.exe`.
2. `bun run smoke:package` → silent `/S /currentuser` install + `ChatGPT Jev.exe --launcher-smoke-test` → expects `PACKAGED_LAUNCHER_SMOKE_OK`.
3. Verify both HKCU uninstall keys exist (`d1a6026a…` Codex Web GPT, `a10be615…` ChatGPT Jev) and Codex Web GPT file count/bytes unchanged.

Build fixes that were required (keep them):
- `0d310c9`: `@ai-sdk/provider-utils@5.0.45` ships no LICENSE → `LICENSES/ai-sdk-provider-utils-5.0.45-Apache-2.0.txt` + `bundledLicenseOverrides` entry in `scripts/generate-third-party-notices.ts` (mirrors the tiktoken override). 111 runtime pkgs standalone / 119 with launcher.
- `3f1130f`: electron-builder's `builder-util` `walk` unconditionally drops `.gitkeep`/`.DS_Store` from `extraResources`; `undici` ships `lib/llhttp/.gitkeep` → packaged launcher died at start with "Runtime bundle file is missing" (sha256 manifest check). Fix: `runtimeManifestFiles()` in `scripts/build-runtime-bundle.ts` `rmSync`s and skips those names. Manifest now 7440 files.

Historical installed-build checks: `"%LOCALAPPDATA%\Programs\ChatGPT Jev\resources\runtime\bin\chatgpt-jev.cmd" --version` → `5.0.8`; `doctor` with isolated `CHATGPT_JEV_HOME`/`CODEX_HOME` → "Configuration is missing … Run chatgpt-jev setup first" + "Jev judgments are configured" (exit 1 expected; no route touched). These results do not verify the current source.

---

## 8. VERIFICATION EVIDENCE

### 8.0 Saved-chat follow-up (historical; latest checks in 0.3)

- `node --test launcher/tests/browser-host.test.cjs launcher/tests/control-server.test.cjs`: **130 pass, 0 fail, 0 skipped**, including 18 saved-conversation tests. Checkpoint/account/privacy/index tests, still-open validation, dead-helper replacement, pending-start coalescing, lease timing, completed-result safety, and failed-allocation recovery are covered. Review findings were reproduced red, repaired, and verified green.
- Individually capped Bun suites: widget **7/7**, ChatGPT session **24/24**, browser login **4/4**, compaction browser recovery **4/4**, launcher host client **17/17**, retained compaction **36/36**, CLI **15/15**. Connector-focused worker slice **31/31**.
- Full worker suite: **122 pass, 8 fail**. A disposable `git archive ef063dd` with the same dependencies produced **120 pass, the same 8 failures**. Seven existing mocks cannot satisfy required dialog DOM inspection (accepted-send/missing-assistant/rate-limit/previous-response/multipart stopped-thinking paths); the mixed-density Bigger Context test exceeds its existing 30-second deadline. No production workaround, timeout increase, or skipped test was added. The temporary baseline export was removed without moving HEAD.
- Core and launcher typechecks pass. Windows package build passes (436 renderer modules); runtime manifest validation passes. Installer path, timestamp, size, hash, and unsigned status are recorded above. No dependency was added.
- Independent read-only review found dead-helper verification bypass and premature checkpoint invalidation. Both were confirmed locally, triaged by live Jev, fixed, and regression-tested. The reviewer could not execute tools or perform its own live Jev call; parent verification is the recorded evidence, not a claimed independent executable pass.
- Not verified: authenticated ChatGPT/Electron smoke and saved-chat restart end to end; new installer execution/installation. This source build does not change the currently installed app until the owner installs it. No old Temporary Chat recovery, automatic account Memory enablement, or unlimited persisted history is promised.

### 8.1 Required-Jev source update (historical)

Windows follow-up: `bun test tests/retained-compaction.test.ts --timeout 5000` in an externally capped child passes **36/36** (182 assertions, 6.42 seconds); `node --test launcher/tests/runtime-host.test.cjs` passes **47/47**; core `typecheck` passes. Neither test file filters or skips cases. The changes affect tests only, not production behavior. The remaining policy evidence below was collected before this follow-up unless explicitly updated.

- Core and launcher typechecks pass. Launcher renderer build passes (436 modules); no dependencies were added.
- Twelve judgment suites: **84 pass, 0 fail**, each run in its own externally capped Bun process.
- `chatgpt-web-harness`: **85 pass, 0 fail, 1 filtered** with `^(?!.*revoking a turn rejects pending invocations)`. The excluded named-pipe case has a previously recorded upstream Windows/Bun hang; it is not a current pass.
- Further focused checks: Zero Risk adapter 11/11; server compaction 19/19; server lifecycle 38/38; bridge collaboration 4/4; bridge platform 2/2; runtime layout/config 19/19; Zero Risk MCP lifecycle 6/6; helper IPC 7/7; MCP observation/deadline 3/3; retained-summary paths 6/6; browser required-Jev call-site contract 1/1; CLI rejection slice 1/1.
- Launcher supervisor: prior **61 pass**. Runtime host: fresh **47 pass, 0 fail, 0 skipped**. The rollback fixture failed before executing production code because unprivileged Windows cannot create a file symlink. It now uses a real directory junction on Windows and retains the file symlink elsewhere; restored target contents, link identity, and modes remain asserted. Privileged Windows file-symlink behavior was not tested.
- Retained-compaction suite: fresh **36 pass, 0 fail**. Two pending named-pipe response assertions hung inside Bun 1.4.0's `.resolves.toMatchObject` even after response data and socket closure arrived. Replacing three expressions with `expect(await promise).toMatchObject` preserves every value assertion and unblocks the complete file. Temporary broker traces were removed; production transport is unchanged. This does not establish the cause of every historical Bun hang.
- Live shared-wrapper smoke: a real `typesafe-ai/jev` answer selected `explicitLimits` with probability 1; the identical call logged `cached`; removing the key produced `jev_decision_required`/503 without a fallback. Earlier live consultations informed the required policy and review repairs. An initial smoke request used incorrect SDK field names and failed explicitly; it was corrected, not counted as a successful judgment.
- Browser QA used a mocked Electron API in a fresh Playwright Chromium profile. Required and key-missing rows passed at **1365x940** and **390x844**: no toggle/key input, no text overflow, no uncaught page errors, screenshots inspected. The temporary Vite preview has an existing meta-CSP warning and a favicon 404. This is not authenticated ChatGPT or packaged Electron validation.
- Seven independent-review issues were repaired and covered by focused checks: swallowed browser judgment errors; structured numeric/key privacy; ordinary compaction bypass; cumulative MCP deadline; URL credential evidence; helper IPC metadata; Doctor failure reporting. Error/cancellation paths and explicit offline fixtures were validated alongside success paths.
- Required-Jev commit `782db0b` was subsequently published, packaged, installed, and passed packaged smoke. No new commit, push, installer, installation, real authenticated ChatGPT turn, original-app modification, or route takeover occurred during the test-only follow-up. Live Jev selected the junction and explicit-await probes with probability 1 and accepted the final scoped diff with probability 0.99; automated tests used offline fixtures.

### 8.2 Initial release (historical, not the current source)

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

The required-Jev source update was installed at `782db0b`; Windows test fixes were committed/published as `ef063dd`. The current saved-chat changes are uncommitted and packaged for manual installation, not installed. An authenticated end-to-end turn and restart restoration remain unverified. The eight worker failures were freshly reproduced on the committed baseline; other historical suite gaps were not rerun unless listed in section 8.0.

1. **`chatgpt-jev setup` has not been run in the owner's real profile.** Doing so with `--replace-codex-route` takes Codex's `openai_base_url`/`model_provider` away from the running Codex Web GPT (only one owner). Owner must decide which app owns the route. `route status` / `doctor` will name the owner (item 20). To try Jev without touching Codex: run the launcher/daemon with an isolated `CHATGPT_JEV_HOME` and `CODEX_HOME`.
2. Item 7 skipped (redundant) — re-open only if the owner wants a Jev hook on the bridge stall budget despite heartbeat liveness.
3. Docs/README/CHANGELOG still say codex-chatgpt-web; rebrand them only if asked.
4. No macOS/Linux packaging attempted (`package:mac`/`package:linux` untested for the fork).
5. `origin` = `https://github.com/miuuyy/codex-chatgpt-web.git` (upstream, read-only for us). The owner's publication remote is `github` = `https://github.com/jerryboganda/chatgptjev.git`. Do not push to `origin`.

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
# Use the Node spawnSync runner below; a timeout is an unverified result, not a pass.

# Separate release actions, not part of ordinary verification:
bun run --cwd launcher package:win                 # installer → launcher/artifacts/
bun run --cwd launcher smoke:package               # silent reinstall + PACKAGED_LAUNCHER_SMOKE_OK

# Track and terminate only child processes created by the current check.
# Do not kill all Bun processes or commit without the owner's request.
```

Gotchas learned (all verified this session):
- `powershell -File runner.ps1 -Files a,b` passes ONE string; call the script with `& … -Files @('a','b')`.
- `Start-Process -ArgumentList` entries containing spaces need embedded double quotes.
- Launcher spec reporter prints non-ASCII glyphs → redirect `*> file` then filter; core uses `^\(fail\)|^\d+ pass`.
- Bun 1.4.0 on Windows can freeze in `.resolves` matchers on pending named-pipe promises. Prefer awaiting the promise before asserting its value; this fixed the retained-compaction file. Other historical hangs remain unclassified. Keep externally capped Bun test processes.
- `git stash pop` fails ("already exists") when an untracked file replaced a tracked one — check `git stash list`, drop manually.
- Windows 8.3 short paths (`DRFAIS~1`) break `.Substring(path.Length)` relative-path math — resolve with `(Get-Item $dir).FullName` first.
- `Join-String` does not exist in Windows PowerShell 5.1 — use `-join`.

---

## 12. MEMORY / RECORDS

- Copilot user memory: `/memories/codex-web-gpt.md` (both apps, parity proof), `/memories/typesafe-jev.md` (Jev integration lessons), `/memories/electron-builder-gotchas.md`.
- `AGENTS.md` is the repository entry point for the required-Jev coding workflow. The earlier `/memories/session/chatgpt-jev-build.md` is not present in this session; use this handoff instead.
- MemPalace wing `codex_web_gpt`: rooms `milestones` (installer + side-by-side), `bugs` (.gitkeep/electron-builder, Bun wedge), `decisions` (parity proof + diff scope), plus diary entry.
- Current fork work uses MemPalace wing `chatgpt-jev`; keep it separate from original-app release history.
- Repomix packs from the audit (may be gone from `%TEMP%`): compressed `f509588c9777923b`, targeted `4719b2872083a6f1`.

---

## APPENDIX A - CAPPED CORE CHECKS

```powershell
Set-Location 'd:\Projects\chatgpt-jev'
node -e 'const { spawnSync } = require(''node:child_process''); for (const file of [''judge'', ''tool-judgments'']) { const result = spawnSync(process.env.USERPROFILE + ''/.bun/bin/bun.exe'', [''test'', ''tests/'' + file + ''.test.ts''], { cwd: process.cwd(), stdio: ''inherit'', timeout: 30000 }); if (result.error) console.error(result.error.message); if (result.status !== 0) process.exitCode = 1; }'
```
