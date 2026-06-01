# LaserForge 2.0 Whole-Repository Audit - 2026-06-01

Auditor: Codex

Mode: audit only. No production code, tests, generated build output, or production docs were changed in this pass.

Repository: `C:\Users\Asus\LaserForge-2.0`

Branch: `codex/main-working`

HEAD: `d66ce7f docs: record image-flow, raster-preview, convert-to-bitmap decisions`

Scope note: this audit covers the current dirty worktree. `git status --short` had 100 lines at audit start, including pre-existing modified and untracked source/test files. Treat this report as a current-working-branch risk assessment, not a clean `main` release certification.

## Executive Summary

LaserForge 2.0 has a strong core: strict TypeScript, a large Vitest suite, property/snapshot tests for G-code invariants, a tight runtime dependency set, clean dependency advisories, and explicit product/architecture documents. The current branch also has important regressions in the exact area where a laser app cannot be vague: command delivery and machine-state truth.

The highest-priority issues are:

1. Serial write failures are swallowed, so Pause, Stop, Start, stream advance, and Set Origin can look successful when the controller never received the command.
2. Start is gated on "connected", project preflight, and controller settings, but not on the live GRBL state being Idle.
3. The Electron desktop build auto-selects the first serial port instead of requiring explicit user choice.
4. Electron main-process code is not covered by CI lint/build gates.
5. The branch is currently red on lint and format checks.

This is not a dependency-security crisis: production and full `pnpm audit` both report no known vulnerabilities, and production license policy passes. The risk is mostly operational safety, release discipline, and desktop coverage.

## Method

Local repo instructions were loaded before external prompts:

- `CLAUDE.md`
- `PROJECT.md`
- `WORKFLOW.md`
- `DECISIONS.md`
- `README.md`
- `AUDIT.md`
- prior `audit/reports/`

External prompt/checklist sources were summarized in `audit/external/online-audit-prompt-sources-2026-06-01.md`. The useful parts were: whole-repo architecture mapping, concrete file/line evidence, false-positive rejection, manual secure-code review, desktop security categories, and Electron-specific hardening.

The old audit paths from `AGENTS.md` (`docs/AUDIT.md`, `.cursor/rules/laserforge.md`) do not exist in this checkout. Root-level `AUDIT.md` and `CLAUDE.md` were used as the new repo's local equivalents.

## Verification Snapshot

| Check | Result | Evidence |
|---|---:|---|
| Unit/property/snapshot tests | PASS | `npm.cmd test`: 99 files, 784 tests passed |
| Web build/typecheck | PASS | `npm.cmd run build` |
| Electron main build | PASS | `npm.cmd run build:electron-main` after write approval |
| Production dependency advisories | PASS | `corepack pnpm audit --prod`: no known vulnerabilities |
| Full dependency advisories | PASS | `corepack pnpm audit`: no known vulnerabilities |
| Production license policy | PASS | `npm.cmd run license-check` |
| ESLint | FAIL | 27 errors |
| Prettier check | FAIL | 207 files reported |
| npm audit | N/A | repo uses pnpm lockfile; npm audit refused without npm lock |

Build warning to track: Vite reports that `src/core/scene/index.ts` and `src/ui/trace/image-loader.ts` are both dynamically and statically imported, so those dynamic imports will not move those modules into separate chunks.

## Findings

### LF-AUDIT-001 - Serial write failures are treated as successful command delivery

Severity: High

Category: laser-safety-state

Files:

- `src/ui/state/laser-store.ts:165`
- `src/ui/state/laser-store.ts:325`
- `src/ui/state/laser-store.ts:331`
- `src/ui/state/laser-store.ts:356`
- `src/ui/state/laser-line-handler.ts:163`

Component: `safeWrite`, `startJob`, `pauseJob`, `resumeJob`, `stopJob`, stream advancement, and origin actions through the same write bottleneck.

Trigger path: connected controller -> serial write rejects or port becomes unwritable -> user presses Start, Pause, Resume, Stop, Set Origin, Frame, Home, or the streamer advances on `ok`.

Failure mode: `safeWrite` catches `conn.write(...)` failures, logs to console, and resolves. Callers then update state as if the command was delivered. `pauseJob` is fire-and-forget, `stopJob` cancels local state after the swallowed write, `startJob` can set a streamer before actual command delivery is proven, and stream advance writes the next chunk without a failure channel.

Consequence: the UI can claim a safety/control action succeeded while the controller never received it. This matters most for Pause and Stop. A laser app should never silently convert "stop command failed to send" into "job stopped".

Confidence: High. The failure path is visible in code and does not require timing speculation.

Concrete fix:

- Change `safeWrite` to return a `Result` or throw.
- For Stop/Pause, surface a blocking error if delivery fails, keep the state honest, and tell the operator to use hardware power/physical emergency stop if software Stop could not be delivered.
- Do not mark a job streaming until the first chunk is successfully written.
- Add rejecting-write tests for Start, Pause, Resume, Stop, Set Origin, and stream advance.

### LF-AUDIT-002 - Start job does not require the machine to be Idle

Severity: High

Category: start-gate

Files:

- `src/ui/laser/LaserWindow.tsx:27`
- `src/ui/laser/LaserWindow.tsx:30`
- `src/ui/laser/LaserWindow.tsx:63`
- `src/ui/laser/JobControls.tsx:141`
- `src/ui/laser/JobControls.tsx:142`
- `src/ui/laser/start-job-readiness.ts:18`

Component: `prepareStartJob`, `LaserWindow`, `JobControls`.

Trigger path: controller is connected but latest GRBL status is `Run`, `Hold`, `Jog`, `Home`, `Alarm`, or unknown/null -> user presses Start job.

Failure mode: Start is disabled only when connection is not `connected` or a local streamer is active. `prepareStartJob` checks project preflight and controller `$30/$31/$32` settings, but it does not take `statusReport` or `alarmCode`.

Consequence: job commands can be sent to a non-idle or locked controller. GRBL will often reject them, but because write failure/error handling is weak, the app can drift into a local state that is not the machine state.

Confidence: High. The tests for `prepareStartJob` cover project/controller settings only; no live machine-state cases exist.

Concrete fix:

- Add machine readiness to `prepareStartJob` or a sibling gate: latest status must be `Idle`, no alarm active, no local streamer active, and status must not be unknown after connect/handshake.
- Block Start with explicit messages for Alarm, Run, Hold, Jog/Home/Focus, and unknown status.
- Add tests for every blocked state.

### LF-AUDIT-003 - Electron desktop auto-picks the first serial port

Severity: High

Category: desktop-serial-permission

Files:

- `electron/main.ts:165`
- `electron/main.ts:196`
- `electron/main.ts:212`
- `electron/main.ts:213`

Component: Electron `select-serial-port` handler.

Trigger path: desktop build -> multiple serial devices attached -> user clicks Connect.

Failure mode: Electron approves serial device permission and selects `portList[0]` automatically.

Consequence: the app can connect to the wrong serial device. On a machine-control app, silently choosing a controller is not acceptable; jog/frame/start commands could target the wrong device.

Confidence: High. The current code explicitly says auto-pick first port.

Concrete fix:

- Replace auto-pick with a renderer-visible port chooser.
- If multiple ports exist and no explicit user choice is available, cancel the selection and show a blocking message.
- Only persist a remembered port after the user confirms it.

### LF-AUDIT-004 - Electron main process is outside CI lint/build coverage

Severity: Medium

Category: ci-coverage

Files:

- `eslint.config.mjs:75`
- `.github/workflows/ci.yml:48`
- `.github/workflows/ci.yml:61`
- `package.json:28`
- `package.json:30`

Component: CI and Electron main-process quality gates.

Trigger path: developer changes `electron/main.ts` or desktop-only behavior -> opens PR.

Failure mode: root ESLint ignores `electron/**`, CI runs web build only, and CI does not run `pnpm build:electron-main` or `pnpm build:desktop`. Running `eslint electron/main.ts --no-ignore` fails because the parser project does not include the Electron file.

Consequence: desktop regressions can merge behind a green web CI lane even though the product explicitly ships web and Windows desktop from one codebase.

Confidence: High.

Concrete fix:

- Add a lint target/config for Electron using `electron/tsconfig.json`.
- Add `pnpm build:electron-main` to CI.
- Consider `pnpm build:desktop` in release or nightly CI if packaging time is too high for every PR.

### LF-AUDIT-005 - Current branch fails lint and format gates

Severity: Medium

Category: ci-hygiene

Files:

- `src/core/controllers/grbl/parse-settings.ts:77`
- `src/core/trace/centerline-distance.ts:36`
- `src/core/trace/potrace-bitmap.ts:51`
- `src/core/trace/potrace-curve.ts:216`
- `src/core/trace/potrace-polygon.ts:140`
- `src/ui/laser/DeviceSettings.tsx:129`

Component: repository guardrails.

Trigger path: run CI-equivalent checks on the current worktree.

Failure mode: `npm.cmd run lint` fails with 27 errors. `npm.cmd run format:check` reports 207 files needing formatting.

Consequence: the branch cannot pass documented CI. The lint failures are not cosmetic: they are the repo's own complexity, max-lines, and no-non-null-assertion rules, concentrated in the new trace algorithms and one UI helper.

Confidence: High.

Concrete fix:

- Split Potrace/centerline helpers into smaller pure functions.
- Replace non-null assertions with explicit guards.
- Split `DeviceSettings.BasicRows`.
- Run Prettier as a separate mechanical formatting commit.

### LF-AUDIT-006 - README/AUDIT status metrics are stale

Severity: Low

Category: documentation-drift

Files:

- `README.md:47`
- `AUDIT.md:25`
- `AUDIT.md:26`
- `AUDIT.md:39`

Component: release/status documentation.

Trigger path: maintainer reads repo status after recent trace/raster/power work.

Failure mode: README reports 644 tests across 68 files; root AUDIT reports 427/427 tests, 49 test files, and CI green. Current evidence is 99 test files, 784 tests, lint red, and format red.

Consequence: status docs no longer support release decisions.

Confidence: High.

Concrete fix: after choosing fixes, refresh README/AUDIT from actual command output and distinguish clean-main status from current dirty-worktree audit status.

## False-Positive Rejections

- `dangerouslySetInnerHTML` in `src/ui/trace/TracePreview.tsx` was inspected. It renders generated trace SVG, not arbitrary external HTML. Keep it documented, but it is not a standalone finding in this pass.
- `fetch(...)` hits in app code are for data URL image decoding, bundled font assets, or Electron `net.fetch(file://...)` under the custom protocol. No telemetry or external service call path was found.
- Secret scan hits were documentation references to expected Cloudflare secret names and package-lock words containing `token`, not hardcoded credentials.
- Electron CSP includes `style-src 'unsafe-inline'`, but the code documents this as needed for React inline styles while keeping scripts self-only. This is a defense-in-depth compromise, not a current finding.

## Positive Control Evidence

- Test suite is broad and fast enough to run in normal development: 99 files / 784 tests passed.
- Production and full dependency advisory audits are clean under pnpm.
- Production license policy passes.
- Core G-code safety invariants are covered by unit/property tests, including laser-off travel and power scaling.
- Recent trace responsiveness work has focused tests for bounded display geometry and preview memoization.

## Recommended Fix Order

1. Fix serial write error propagation and Stop/Pause state honesty.
2. Add live machine-state Start gating.
3. Replace Electron serial auto-pick with explicit user selection.
4. Add Electron main build/lint coverage to CI.
5. Repair current lint/format gates.
6. Refresh README/AUDIT metrics after the above are clean.

## Not Verified

- No live browser or hardware burn was performed in this audit pass.
- No desktop packaged `.exe` build was produced.
- No LightBurn visual side-by-side was performed for trace/fill/raster fidelity.
- No remote GitHub Actions run was checked; CI findings are based on workflow inspection and local commands.
