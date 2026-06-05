# Karpathy Whole-Repo Audit - 2026-06-02

Status: in progress. This is the first evidence-backed pass for `C:\Users\Asus\LaserForge-2.0`; it is not a claim that every line has been manually cleared yet.

## Repository Identity

- Worktree: `C:\Users\Asus\LaserForge-2.0`
- Remote: `https://github.com/cisgz3a-hub/LaserForge-2.0.git`
- Branch: `codex/main-working`
- Commit: `2326809 fix: bundle trace worker for large images`
- Current production-code delta after this audit turn: trace-worker client regression fix in `src/ui/trace/use-trace-worker-client.ts` plus its failing-first test in `src/ui/trace/use-trace-worker-client.test.ts`; root ESLint scoping and core base64-global lint fixes in `eslint.config.mjs`; branch-reduction refactors in `src/core/job/planner.ts` and `src/core/raster/emit-raster.ts`; pure-core raster luma decode fix plus regression coverage in `src/core/job/compile-job.ts` and `src/core/job/compile-job.test.ts`; WCO-aware custom-origin Start/Frame preflight fix in `src/core/invariants/predicates.ts`, `src/core/preflight/preflight.ts`, `src/io/gcode/emit-gcode.ts`, `src/ui/laser/start-job-readiness.ts`, and `src/ui/laser/JobControls.tsx`.
- `main`, `origin/main`, `origin/codex/main-working`, and `origin/HEAD` all point at `2326809`.
- `git status --short` is no longer clean because this audit turn intentionally fixed KF-009 and created/updated this audit report.

## Local Contract Used

The local audit contract came from root `CLAUDE.md`, `PROJECT.md`, `DECISIONS.md`, `WORKFLOW.md`, and `AUDIT.md`. No `AGENTS.md` exists inside this checkout.

The relevant "Karpathy" rules applied in this pass:

- Verify behavior with concrete evidence; do not trust generated code or prior claims.
- Keep changes on a tight leash; during audit, report findings instead of patching production code.
- LightBurn remains the behavioral reference unless an ADR says otherwise.
- For laser-control paths, tests are not enough; safety claims need realistic trigger paths.
- Hard caps are enforced by lint: file length, function length, complexity, boundary imports, and type-aware promises.
- Bug fixes need a failing test first.
- Do not write TODO comments without opening a corresponding issue.

## Current Gate Evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| `corepack.cmd pnpm run typecheck` | Pass | `tsc --noEmit` exited 0 |
| `corepack.cmd pnpm test` | Pass | 106 test files, 826 tests passed |
| `corepack.cmd pnpm run build:web` | Pass | Vite built `dist/web`; emitted `assets/trace-worker-BX-W35Gh.js` |
| `corepack.cmd pnpm run format:check` | Pass | Prettier reported all matched files use configured style |
| `corepack.cmd pnpm run guard:repo` | Pass | Repository guard confirmed `C:\Users\Asus\LaserForge-2.0` |
| `corepack.cmd pnpm run lint:electron` | Pass | Electron ESLint exited 0 |
| `corepack.cmd pnpm run build:electron-main` | Pass | Electron TypeScript build exited 0 after unsandboxed rerun |
| `corepack.cmd pnpm run license-check` | Pass | Production licenses allowed |
| `corepack.cmd pnpm audit --prod` | Pass | No known production vulnerabilities |
| `corepack.cmd pnpm test src/ui/trace/use-trace-worker-client.test.ts` | Pass | Added regression for request-scoped trace worker errors after first watching it fail |
| `corepack.cmd pnpm lint` | Pass | ESLint exited 0; remaining boundaries legacy selector message is a warning |
| `corepack.cmd pnpm audit` | Fail | 1 critical dev vulnerability in `vitest <4.1.0` |

Notes:

- The first sandboxed `pnpm test` and Electron build attempts failed for environment reasons. Vitest was denied parent-directory read access by the sandbox; Electron build was denied writes to generated `dist-electron` files. Both passed when rerun with the same command outside those sandbox restrictions.
- Web build warnings remain: `src/core/scene/index.ts` and `src/ui/trace/image-loader.ts` are both statically and dynamically imported, so those dynamic imports do not split their modules into separate chunks. The trace worker itself is split and emitted.

## Source Inventory

- Tracked code files inspected by inventory script under `src`, `electron`, and `scripts`: 291
- Approximate code lines in that scope: 32,829
- Test files in that scope: 105
- Production/source files in that scope: 186
- Machine-readable finding list currently contains 37 findings.
- No raw `src/**/*.ts` or `src/**/*.tsx` file exceeded 600 physical lines in this pass.
- Exact duplicate-file hash scan over tracked `src`, `electron`, and `scripts` files found no duplicate source files.
- Old-repo mixup sweep: no production import or deploy guard points at `LaserForge` / LaserForge 1. The remaining LaserForge 1 references are trace-algorithm provenance comments. Local deploy scripts run `guard:repo`, which checks folder name, Git remote, and the LaserForge 2.0 app shell before deploying.

## Findings

### KF-001 - Explicit Disconnect can bypass running-job stop/reset

- Severity: High
- Confidence: High
- File: `src/ui/state/laser-store.ts`
- Function/module: `connectionActions.disconnect`
- Trigger path: User has an active streamer, then clicks the UI `Disconnect` button in `src/ui/laser/ConnectionBar.tsx`; `src/ui/laser/LaserWindow.tsx` wires this directly to `disconnect()`.
- Failure mode: `disconnect()` tears down polling and closes the serial connection without sending `RT_SOFT_RESET`. `stopJob()` does send `RT_SOFT_RESET`, but explicit disconnect does not route through it.
- Consequence: If GRBL already has RX/planner-buffered commands, closing the port stops new host streaming but does not prove physical motion or laser activity stopped. The UI then clears local streamer state, which can make the app look idle while the controller may still execute buffered work.
- Evidence:
  - `src/ui/state/laser-store.ts:303` starts `disconnect: async () => {`.
  - `src/ui/state/laser-store.ts:305-306` calls `teardown()` and `conn.close()`.
  - `src/ui/state/laser-store.ts:311` clears `streamer`.
  - `src/ui/state/laser-store.ts:403-404` shows `stopJob` is the path that sends `RT_SOFT_RESET`.
  - `src/ui/laser/LaserWindow.tsx:69` wires `onDisconnect={() => void disconnect()}`.
- Concrete fix:
  - Add a failing test in `src/ui/state/laser-store.test.ts` proving `disconnect()` while `streamer.status` is `streaming` or `paused` cannot close without a stop/reset.
  - Make `disconnect()` either call the same reset path as `stopJob()` before closing, or refuse the explicit disconnect with clear operator copy telling the user to press Stop or use physical E-stop/power cutoff.
  - Keep idle disconnect behavior unchanged.

### KF-002 - Root ESLint cannot pass because a JS guard script is outside the TS project

- Severity: Medium
- Confidence: High
- Status: Fixed in current working tree
- File: `eslint.config.mjs`, `tsconfig.json`, `scripts/assert-correct-repo.mjs`
- Function/module: Root lint configuration
- Trigger path: Run `corepack.cmd pnpm lint`.
- Failure mode: ESLint applies type-aware parser options using `project: './tsconfig.json'` to `scripts/assert-correct-repo.mjs`, but `tsconfig.json` only includes `src/**/*`, config TS files, `vite.config.ts`, and `vitest.config.ts`.
- Consequence: CI/lint is red before source quality rules can be trusted. The repo guard script is important, but the lint configuration currently makes it a blocker.
- Evidence:
  - `corepack.cmd pnpm lint` reports parsing error for `scripts\assert-correct-repo.mjs`.
  - `eslint.config.mjs:94-96` configures the TS project parser.
  - `tsconfig.json:25` excludes `scripts/**/*.mjs` by omission.
- Concrete fix:
  - Applied: type-aware TS lint config is scoped to `src/**/*.ts` / `src/**/*.tsx`, and `scripts/**/*.mjs` has an explicit Node-globals lint scope.
  - Verified: `corepack.cmd pnpm lint` exits 0.

### KF-003 - `buildBlocks` violates the repo complexity cap

- Severity: Medium
- Confidence: High
- Status: Fixed in current working tree
- File: `src/core/job/planner.ts`
- Function/module: `buildBlocks`
- Trigger path: Run `corepack.cmd pnpm lint`.
- Failure mode: `buildBlocks` has complexity 14 while the configured maximum is 12.
- Consequence: This is job-estimation logic for motion planning. Excess branching makes behavioral review harder in a laser-output boundary and violates the repo's own Karpathy cap.
- Evidence:
  - `corepack.cmd pnpm lint` reports `src/core/job/planner.ts:85:1`.
  - `src/core/job/planner.ts:85` defines `function buildBlocks(...)`.
- Concrete fix:
  - Applied: split group velocity, fill group block append, cut group block append, and cut-polyline block append helpers without changing emitted block order.
  - Verified: `corepack.cmd pnpm test src/core/job/planner.test.ts src/core/job/estimate-duration.test.ts` passes, and `corepack.cmd pnpm lint` exits 0.

### KF-004 - `emitRow` violates the repo complexity cap in raster G-code emission

- Severity: Medium
- Confidence: High
- Status: Fixed in current working tree
- File: `src/core/raster/emit-raster.ts`
- Function/module: `emitRow`
- Trigger path: Run `corepack.cmd pnpm lint`.
- Failure mode: `emitRow` has complexity 14 while the configured maximum is 12.
- Consequence: Raster output is a safety-critical G-code boundary. High branch density makes it easier to miss laser-on travel, reverse-scan errors, or bad modal power/feed transitions.
- Evidence:
  - `corepack.cmd pnpm lint` reports `src/core/raster/emit-raster.ts:151:1`.
  - `src/core/raster/emit-raster.ts:151` defines `function emitRow(...)`.
- Concrete fix:
  - Applied: extracted direction dispatch plus forward/reverse row-run helpers while preserving the same active-span and overscan coordinates.
  - Verified: `corepack.cmd pnpm test src/core/raster/emit-raster.test.ts src/core/raster/emit-raster.property.test.ts` passes, and `corepack.cmd pnpm lint` exits 0.

### KF-005 - Dev dependency audit is red for Vitest UI / browser-mode advisory

- Severity: Medium
- Confidence: High
- File: `package.json`, `pnpm-lock.yaml`
- Function/module: Development dependency graph
- Trigger path: Run `corepack.cmd pnpm audit`.
- Failure mode: `vitest@3.2.4` is vulnerable to GHSA-5xrq-8626-4rwp / CVE-2026-47429. The advisory is critical for Vitest UI or Browser Mode exposure on Windows. `pnpm audit --prod` is clean, so this is not a production dependency finding.
- Consequence: A developer who runs or exposes Vitest UI / Browser Mode on Windows can create a file read/write/execute risk depending on server exposure and mode.
- Evidence:
  - `package.json:52` pins `@vitest/coverage-v8` at `^3.2.4`.
  - `package.json:70` pins `vitest` at `^3.2.4`.
  - `corepack.cmd pnpm audit` reports vulnerable versions `<4.1.0`, patched versions `>=4.1.0`.
  - GitHub Advisory Database lists the advisory as critical and patched in `4.1.0`.
- Concrete fix:
  - Upgrade `vitest` and `@vitest/coverage-v8` together to `>=4.1.0`.
  - Run the full suite and coverage after upgrade.
  - If the upgrade is deferred, document that Vitest UI / Browser Mode must not be exposed and should not be used on this Windows dev machine until upgraded.

### KF-006 - Co-located test enforcement claim is not implemented

- Severity: Medium
- Confidence: High
- File: `CLAUDE.md`, `eslint.config.mjs`
- Function/module: Test policy / CI enforcement
- Trigger path: Compare the documented rule to lint configuration and source inventory.
- Failure mode: `CLAUDE.md` says a file with no test is rejected by CI lint through a `require-test-coverage` custom rule, but no such rule exists in the current ESLint config or repo search results.
- Consequence: The repo's audit contract says test coverage is enforced at file granularity, but the actual gate does not enforce that. This can let new untested production modules land while reviewers believe CI blocks them.
- Evidence:
  - `CLAUDE.md:169` documents `require-test-coverage`.
  - `eslint.config.mjs` has no `require-test-coverage` rule.
  - Source inventory found many production files without direct sibling tests, including UI components, barrels, platform files, and the trace worker.
- Concrete fix:
  - Either implement the custom lint/script gate with explicit exemptions, or revise the documented policy to match the actual test strategy.
  - For a hardware-control repo, prefer implementing the gate for core/output/serial/raster/trace modules first.

### KF-007 - Rolling audit status is stale

- Severity: Low
- Confidence: High
- File: `AUDIT.md`
- Function/module: Audit record
- Trigger path: Compare current gate results to the rolling audit status.
- Failure mode: `AUDIT.md` still records older clean counts and zero-audit status while current gates show 820 tests and a dev dependency advisory. It also does not record this dated audit's fixed-in-working-tree findings.
- Consequence: Maintainers can make release decisions from stale audit evidence.
- Evidence:
  - Current `corepack.cmd pnpm test` result is 106 files / 826 tests.
  - Current `corepack.cmd pnpm lint` exits 0 with a boundaries legacy-selector warning.
  - Current `corepack.cmd pnpm audit` result is 1 critical dev advisory.
- Concrete fix:
  - Keep this report as the current dated audit record.
  - Refresh `AUDIT.md` only after false-positive rejection and chosen fixes are complete.

### KF-008 - Production TODO in `compileJob` conflicts with local rules and appears stale

- Severity: Low
- Confidence: Medium
- Status: Fixed in current working tree
- File: `src/core/job/compile-job.ts`
- Function/module: Raster image luma decode path
- Trigger path: Source review for TODOs in production code.
- Failure mode: A production TODO says the path cannot stay pure if it needs to decode a `dataUrl`, but the implementation now uses `lumaBase64` and `decodeBase64Luma`.
- Consequence: The comment is either stale or an unresolved issue without a linked issue reference. Both violate the local "no TODO without issue" rule and make the pure-core boundary harder to audit.
- Evidence:
  - `src/core/job/compile-job.ts:77-80` contains the TODO.
  - `src/core/job/compile-job.ts:123` decodes with `atob(base64)`.
  - `CLAUDE.md:311` says not to write `// TODO` without opening a corresponding issue.
- Concrete fix:
  - Applied: removed the stale TODO and clarified that raster luma is stored separately as base64 and decoded locally.
  - Verified: `corepack.cmd pnpm test src/core/job/compile-job.test.ts`, `corepack.cmd pnpm run typecheck`, and `corepack.cmd pnpm lint` pass.

### KF-009 - One trace request error permanently disables the worker for the session

- Severity: Medium
- Confidence: High
- Status: Fixed in current working tree after red/green regression test
- File: `src/ui/trace/use-trace-worker-client.ts`, `src/ui/trace/trace-worker.ts`
- Function/module: `handleWorkerMessage`, `retireWorker`, worker error protocol
- Trigger path: A large image traces through the worker. The worker catches any exception from `traceImageToColoredPaths` and sends `{ kind: 'error' }`. The main-thread client receives that response.
- Failure mode before fix: `handleWorkerMessage` treated every `{ kind: 'error' }` as a fatal worker/runtime failure and called `retireWorker()`, setting `workerFailed = true`. Later calls could not create/use a worker and large images exceeded the inline fallback cap, producing `Trace worker is unavailable for this large image. Reload the app and try again.`
- Consequence before fix: One request-specific trace failure could break all subsequent large-image tracing until reload, even if the worker bundle and browser worker support were fine.
- Evidence:
  - `src/ui/trace/trace-worker.ts:44-59` catches any trace exception and returns `kind: 'error'`.
  - Red test: `corepack.cmd pnpm test src/ui/trace/use-trace-worker-client.test.ts` failed with `expected ... 'decode failed' but got 'Trace worker is unavailable...'`.
  - `src/ui/trace/use-trace-worker-client.test.ts:94` now proves a mocked worker can return one request error and still satisfy the next large-image request.
  - `src/ui/trace/use-trace-worker-client.ts:94-97` now rejects normal `kind: 'error'` responses per request without retiring the worker.
  - `src/ui/trace/use-trace-worker-client.ts:132-135` now preserves the unavailable-worker message only for true fatal worker failure on large images.
- Concrete fix applied:
  - Split fatal worker infrastructure failure from per-request trace failure. `worker.onerror` still retires the worker; a normal `kind: 'error'` response rejects only that request.
  - Added a mocked-worker regression test proving one request error does not permanently disable later large-image worker requests.
  - Kept the bounded inline fallback for environments with no Worker support.

### KF-010 - Large-image worker path lacks an automated browser smoke test

- Severity: Medium
- Confidence: High
- File: `src/ui/trace/use-trace-worker-client.test.ts`, `vite.config.ts`
- Function/module: Trace worker test strategy
- Trigger path: Change worker construction, CSP, Vite worker output, or deploy headers.
- Failure mode: Unit tests cover inline fallback and a source-text regex for the Vite worker call shape, but they do not launch the production-built worker in a browser and trace an image larger than `MAX_INLINE_TRACE_PIXELS`.
- Consequence: The exact class of bug that produces `Trace worker is unavailable for this large image` can pass unit tests. The web build currently emits `assets/trace-worker-BX-W35Gh.js`, but no automated test proves the built app can instantiate and use it under deployed CSP/headers.
- Evidence:
  - `src/ui/trace/use-trace-worker-client.test.ts:56-68` tests inline fallback only.
  - `src/ui/trace/use-trace-worker-client.test.ts:48-52` protects the syntactic worker constructor shape by regex.
  - `corepack.cmd pnpm run build:web` emitted `dist/web/assets/trace-worker-BX-W35Gh.js`.
- Concrete fix:
  - Add a browser-level smoke test against `vite preview` or a static server serving `dist/web`.
  - Feed a synthetic image larger than the inline cap and assert the trace completes without the unavailable-worker error.
  - Include the production `_headers`/CSP path in at least one deploy-like verification.

### KF-011 - `startJob` can drop fast early acknowledgements before streamer state is installed

- Severity: Medium
- Confidence: High
- File: `src/ui/state/laser-store.ts`, `src/ui/state/laser-line-handler.ts`
- Function/module: `jobActions.startJob`, `handleLine` / `advanceStream`
- Trigger path: Start a job on a controller or test adapter that emits one or more `ok` responses while `startJob` is awaiting the initial `safeWrite`.
- Failure mode: `startJob` writes `stepped.toSend` before it stores `stepped.state` in Zustand. During that await window, `handleLine` calls `advanceStream`, but `advanceStream` returns immediately because `get().streamer` is still `null`.
- Consequence: Early acknowledgements can be lost. The store can then believe bytes are still in flight after GRBL has already acknowledged them, causing stuck progress, missing follow-up sends, or incorrect buffer accounting.
- Evidence:
  - `src/ui/state/laser-store.ts:371-376` creates/steps the streamer, awaits `safeWrite`, then sets `streamer`.
  - `src/ui/state/laser-line-handler.ts:160-164` returns if `get().streamer` is `null`.
  - `src/ui/state/laser-store.test.ts` covers initial write failure but has no fast-ack-before-state-installed regression.
- Concrete fix:
  - Add a failing test where the fake connection emits `ok` during the initial `write` promise before it resolves.
  - Install a provisional streamer state before the write can produce acknowledgements, then roll back or mark failed if the initial write rejects.
  - Preserve the existing guarantee that a failed initial write does not leave an active streamer.

### KF-012 - Ack-driven follow-up writes can make streamer state outrun actual serial writes

- Severity: Medium
- Confidence: High
- File: `src/ui/state/laser-line-handler.ts`
- Function/module: `advanceStream`
- Trigger path: A GRBL `ok`/`error` frees buffer space; `advanceStream` steps the streamer and attempts to write the next chunk, but the serial write rejects.
- Failure mode: The streamer is updated before the async `safeWrite(stepped.toSend)` succeeds. The rejection is caught and discarded after `safeWrite` logs it, so the store keeps lines in `inFlight` even if the bytes were not accepted by the serial writer.
- Consequence: Progress and RX-buffer accounting can become false after a mid-stream write failure. The likely user-visible result is a stuck or misleading job state; in a hardware-control app, false state around what has actually reached the controller is safety-relevant.
- Evidence:
  - `src/ui/state/laser-line-handler.ts:164-168` sets `streamer: stepped.state` before `void safeWrite(...).catch(() => undefined)`.
  - `src/ui/state/laser-store.test.ts` covers `pauseJob` and `stopJob` write failures, but not ack-driven follow-up write failure.
- Concrete fix:
  - Add a failing `laser-line-handler` or `laser-store` test where a follow-up write rejects after an ack.
  - Either await/write before committing the new in-flight state, or add an explicit terminal/error streamer state that honestly represents "host failed to send next chunk".
  - Do not silently swallow the error after only logging; surface it in UI state and stop further streaming.

### KF-013 - Center-origin machines can start without bed-bounds proof

- Severity: High
- Confidence: High
- File: `src/core/preflight/preflight.ts`, `src/ui/laser/DeviceSettings.tsx`, `src/core/job/frame-preflight.ts`
- Function/module: `runPreflight`, `DeviceSettings` origin selector, `framePreflight`
- Trigger path: User selects `Origin = Center` in Device settings, then starts or exports a job.
- Failure mode: `runPreflight` skips bounds checking entirely when `project.device.origin === 'center'`. The UI exposes `center` as a selectable origin. Frame preflight still assumes a `0..bedWidth` / `0..bedHeight` coordinate range, so center-origin handling is inconsistent: Start/export has no bounds proof, while Frame can reject valid negative center-origin coordinates.
- Consequence: For center-origin machines, LaserForge can allow a job to start/export without proving every emitted coordinate lies within the valid center-origin bed rectangle `[-bedWidth/2, +bedWidth/2] x [-bedHeight/2, +bedHeight/2]`. On real hardware this can drive off-bed if geometry is misplaced or oversized.
- Evidence:
  - `src/ui/laser/DeviceSettings.tsx:57-62` includes `{ value: 'center', label: 'Center' }`.
  - `src/core/preflight/preflight.ts:158-162` returns without bounds checks for `origin === 'center'`.
  - `src/core/devices/origin-transform.ts:40-43` emits negative/positive center-origin coordinates.
  - `src/core/job/frame-preflight.ts:31-40` checks only against `0..bedWidth` / `0..bedHeight`.
- Concrete fix:
  - Add tests for center-origin in `src/core/preflight/preflight.test.ts` and `src/core/job/frame-preflight.test.ts`.
  - Teach bounds predicates to accept an origin-specific rectangle, including center-origin negative limits.
  - Use the same origin-aware bounds contract for Start/export and Frame.

### KF-014 - Trace preview can be overwritten by stale async trace results

- Severity: Medium
- Confidence: High
- File: `src/ui/trace/use-trace-preview.ts`
- Function/module: `useTracePreview`, `runTrace`
- Trigger path: User changes preset/adjustments while a previous preview trace is still running; the older trace finishes after the newer trace.
- Failure mode: The hook increments `tokenRef` and checks it before starting work, but `runTrace` does not receive the token and does not check freshness before calling `setState`. A slower older trace can therefore set `ready` after a newer options trace has already started or completed.
- Consequence: Preview can show paths for old options while the Trace/commit button uses current options. This breaks the repo's own preview-equals-output rule and can make tracing appear inconsistent.
- Evidence:
  - `src/ui/trace/use-trace-preview.ts:43-49` describes a latest-call-wins token.
  - `src/ui/trace/use-trace-preview.ts:76-78` calls `runTrace(img, optionsRef.current, setState)` without passing `myToken`.
  - `src/ui/trace/use-trace-preview.ts:102-103` checks token only before starting delayed trace.
  - `src/ui/trace/use-trace-preview.ts:118-132` sets state from async trace completion with no token check.
- Concrete fix:
  - Add a failing hook/unit test where an older trace promise resolves after a newer one.
  - Pass the captured token into `runTrace`, or pass an `isCurrent` callback, and check before every final `setState`.
  - Apply the same guard to error states so stale failures cannot overwrite a valid newer preview.

### KF-015 - `.lf2` load accepts invalid field values after only top-level shape checks

- Severity: Medium
- Confidence: High
- File: `src/io/project/deserialize-project.ts`
- Function/module: `deserializeProject`, `normalizeProject`
- Trigger path: Open a hand-edited, corrupted, or malicious `.lf2` whose top-level `device`, `workspace`, `scene.objects`, and `scene.layers` shapes exist, but nested fields contain invalid values such as an unknown device origin, nonpositive bed dimensions, nonnumeric layer speed, invalid power-scale fields, or JSON numeric overflow like `1e309` in `linesPerMm` / `fillOverscanMm`.
- Failure mode: The loader validates only the top-level object/array shape, then casts the normalized raw object to `Project`. Invalid nested values can survive into compile, preflight, output, UI, or export paths. In the output/raster continuation pass, `1e309` was confirmed to parse as `Infinity`; `normalizeLayer` accepts those layer numbers because it checks `typeof number` without `Number.isFinite`.
- Consequence: Bad project files can crash later paths or produce invalid G-code/export behavior before the user gets a clear "could not open project" error. A non-finite fill overscan can reach `fmt()` and produce `XInfinity`/`X-Infinity` text, while a non-finite image resolution can reach raster resampling and request an impossible `Uint8Array` size. In a hardware-control app, project-file trust is an input boundary, not a harmless convenience.
- Evidence:
  - `src/io/project/deserialize-project.ts:3-5` documents that field-level validation is deferred.
  - `src/io/project/deserialize-project.ts:172-179` validates only top-level `device`, `workspace`, `scene.objects`, and `scene.layers`.
  - `src/io/project/deserialize-project.ts:92-129` normalizes some additive fields but does not validate enum/range constraints for all `DeviceProfile`, `Layer`, `SceneObject`, and transform fields.
  - `src/io/project/deserialize-project.ts:139-157` accepts `hatchSpacingMm`, `fillOverscanMm`, and `linesPerMm` using `typeof number` / sign checks without finite checks or UI-range caps.
  - Audit reproduction in Node/V8: `JSON.parse('{"x":1e309}').x` returns `Infinity`, and `Infinity.toFixed(3)` returns `Infinity`.
  - `src/core/job/compile-job.ts:64` forwards `Math.max(0, layer.fillOverscanMm)` into fill groups; `src/core/job/fill-overscan.ts:23-30` expands that runway into lead-in/lead-out coordinates; `src/core/output/grbl-strategy.ts:22-23` formats coordinates with `toFixed`.
  - `src/core/job/compile-job.ts:89-91` forwards `layer.linesPerMm` into raster pixel dimensions; `src/core/raster/luma-resample.ts:16-17` multiplies by `linesPerMm`; `src/core/raster/luma-resample.ts:37` allocates `new Uint8Array(width * height)`.
  - `src/core/invariants/predicates.ts:28` only parses decimal coordinate tokens, so `XInfinity` is not treated as an out-of-bounds coordinate by the current bounds predicate.
  - `src/core/devices/origin-transform.ts:26-45` assumes `device.origin` is a valid discriminated union member.
- Concrete fix:
  - Add failing project-load tests for invalid origin, invalid bed dimensions, invalid layer mode, invalid speed/power/pass fields, malformed object transforms, and valid JSON numeric overflow such as `linesPerMm: 1e309` and `fillOverscanMm: 1e309`.
  - Implement a schema validator at the `.lf2` boundary that either rejects invalid nested fields or clamps only where the local contract explicitly says clamping is safe.
  - Normalize imported layer numeric fields to the same finite ranges the UI enforces: hatch angle `0..180`, hatch spacing `0.05..10`, fill overscan `0..25`, and lines/mm `1..50`.
  - Add an invariant test that emitted G-code cannot contain `Infinity` or `NaN`, and make `findOutOfBoundsCoords` flag non-finite motion words if they ever appear.
  - Keep migrations separate from validation: migrate known old schemas first, then validate the migrated result.

### KF-016 - Fill-only SVG geometry is imported as black stroked geometry

- Severity: Medium
- Confidence: High
- File: `src/io/svg/parse-svg.ts`
- Function/module: `normalizeColor`, `walkGeometry`
- Trigger path: Import an SVG element with drawable geometry but no `stroke` attribute, for example `<rect fill="red" ...>` or common logo paths that are fill-only.
- Failure mode: The file comment says elements without a stroke are skipped, but `normalizeColor(null)` returns `#000000`, so fill-only geometry becomes a black polyline layer.
- Consequence: A fill-only SVG can unexpectedly become black line/fill output. The source artwork and LaserForge output no longer match, and the user can cut/engrave outlines that were never intended as strokes.
- Evidence:
  - `src/io/svg/parse-svg.ts:8-10` says elements without a stroke are skipped.
  - `src/io/svg/parse-svg.ts:82-84` says `none`/absent stroke returns no-stroke.
  - `src/io/svg/parse-svg.ts:84-85` actually returns `COLOR_FALLBACK` for `input === null`.
  - `src/io/svg/parse-svg.ts:129-130` only skips when normalized color is the empty string.
- Concrete fix:
  - Add a failing import test for fill-only `rect`/`path` with no stroke.
  - Change absent direct/inherited stroke to `''` unless the product intentionally supports fill import.
  - If fill import is intended, implement it explicitly with layer mode semantics instead of silently treating it as black stroke geometry.

### KF-017 - SVG transforms and inherited/style stroke colors are ignored

- Severity: Medium
- Confidence: High
- File: `src/io/svg/parse-svg.ts`, `src/io/svg/shape-to-polylines.ts`
- Function/module: SVG import pipeline
- Trigger path: Import an SVG that uses `transform` on a `<g>` or geometry element, or uses `style="stroke:#..."` / parent-group stroke inheritance.
- Failure mode: `elementToSubPaths` converts raw element attributes to points in object-local coordinates, but neither it nor `walkGeometry` applies `transform` attributes. Color attribution reads only `el.getAttribute('stroke')` on the element itself.
- Consequence: Common exported SVGs from design tools can import at the wrong position, scale, or color. In a laser tool, that is output/preview mismatch and can affect bed placement and layer power/speed assignment.
- Evidence:
  - `src/io/svg/parse-svg.ts:119-134` walks every element but does not accumulate or apply parent/element transforms.
  - `src/io/svg/shape-to-polylines.ts:35-122` reads numeric geometry attributes directly and does not apply transforms.
  - `src/io/svg/parse-svg.ts:129` reads only the direct `stroke` attribute.
  - Existing SVG parser tests do not cover transform attributes, style stroke, or inherited group stroke.
- Concrete fix:
  - Add failing tests for `transform="translate(...)"`, grouped `transform="scale(...)"`, `style="stroke:#ff0000"`, and parent `<g stroke="#...">`.
  - Implement a small SVG transform parser for matrix/translate/scale/rotate/skew as needed, accumulating parent transforms during traversal.
  - Resolve stroke from direct attribute, style attribute, and inherited ancestor attributes before falling back or skipping.

### KF-018 - Preview/output rendering lacks the large-trace budget used by normal workspace drawing

- Severity: Medium
- Confidence: High
- File: `src/ui/workspace/draw-preview.ts`
- Function/module: `drawPreview`, `drawCut`, `drawObjectsFaint`
- Trigger path: User traces or imports a large vector design, then switches to Preview/Output mode or scrubs the preview.
- Failure mode: Normal workspace drawing uses `buildDisplayPolylines` / `createDisplayPolylineCache` to keep oversized traces under a global segment budget, but preview rendering walks every sliced toolpath step and strokes each cut step separately. The faint original-geometry path also strokes per source polyline. There is no total-scene budget equivalent in preview mode.
- Consequence: The app can become responsive in normal edit mode after the large-trace fix, then freeze again when the user opens Output/Preview because Canvas2D receives thousands of per-step strokes and path operations.
- Evidence:
  - `src/ui/workspace/draw-scene.ts:204-207` applies `displayPolylinesFor(...)` before normal vector drawing.
  - `src/ui/workspace/draw-preview.ts:74` loops every `sliced.whole` toolpath step.
  - `src/ui/workspace/draw-preview.ts:83-84` dispatches every burn step to `drawCut`.
  - `src/ui/workspace/draw-preview.ts:118-143` only strides within one polyline, not across the full preview toolpath.
  - `src/ui/workspace/draw-preview.ts:23-60` draws faint imported SVG geometry with a per-polyline `beginPath`/`stroke` loop.
  - `src/ui/workspace/draw-scene-large.test.ts` covers `preview: false` only.
- Concrete fix:
  - Add a failing preview-mode performance/counting test for a large traced/imported vector scene.
  - Build a display-budgeted preview toolpath or batched preview renderer that samples globally across all burn segments and batches by color where possible.
  - Keep the existing preview scrubber semantics by slicing first, then applying a bounded display representation to the visible segment set.

### KF-019 - Raster draw/preview caches retain large deleted images for the whole session

- Severity: Medium
- Confidence: High
- File: `src/ui/workspace/draw-raster.ts`, `src/ui/workspace/draw-raster-preview.ts`
- Function/module: Raster bitmap and preview canvas caches
- Trigger path: User repeatedly imports, traces, deletes, converts, or changes settings for large bitmap images during one app session.
- Failure mode: Raster decode, trace-source tint, and raster-preview canvases are stored in module-level `Map`s keyed by `dataUrl` or settings string. There is no eviction, size cap, scene-liveness pruning, or reset hook when images are deleted or replaced.
- Consequence: Large image data URLs and offscreen canvases can remain strongly referenced after the scene no longer contains them. Repeated trace/import workflows can accumulate memory and make the app progressively slower even after visible objects are removed.
- Evidence:
  - `src/ui/workspace/draw-raster.ts:20` declares module-level `rasterImageCache`.
  - `src/ui/workspace/draw-raster.ts:24` declares module-level `tintedTraceSourceCache`.
  - `src/ui/workspace/draw-raster.ts:49` stores image cache entries without eviction.
  - `src/ui/workspace/draw-raster.ts:76` stores tinted canvases without eviction.
  - `src/ui/workspace/draw-raster-preview.ts:36` declares module-level `previewCanvasCache`.
  - `src/ui/workspace/draw-raster-preview.ts:109` stores preview canvases without eviction.
- Concrete fix:
  - Add tests around cache pruning/exported cache helpers rather than relying on browser memory behavior.
  - Replace unbounded maps with a small byte-aware LRU or scene-scoped cache keyed by live object IDs/data URLs.
  - Clear stale raster/preview cache entries when project scene objects change, when a project is opened, and after trace-source backing images are deleted.

### KF-020 - GitHub manual production deploy bypasses the repo guard and CI gate

- Severity: Medium
- Confidence: High
- File: `.github/workflows/deploy.yml`, `package.json`, `scripts/assert-correct-repo.mjs`
- Function/module: Cloudflare Pages deployment workflow
- Trigger path: A maintainer manually runs the `Deploy to Cloudflare Pages` workflow from the GitHub Actions UI on a non-main ref, stale ref, or otherwise unverified checkout.
- Failure mode: The workflow allows `workflow_dispatch`, and the job condition explicitly lets manual dispatches pass without inspecting a successful CI run. The workflow then installs dependencies, runs `pnpm build:web`, and deploys to the production Cloudflare branch. Unlike local `deploy:web`, it does not run `pnpm guard:repo`.
- Consequence: The protection that prevents old-repo / wrong-checkout deploys is only present in local scripts. The remote production deploy path can publish a manually selected ref without lint, tests, license audit, dependency audit, or the repo identity guard.
- Evidence:
  - `.github/workflows/deploy.yml:18` enables `workflow_dispatch`.
  - `.github/workflows/deploy.yml:39` lets manual dispatch bypass the `workflow_run.conclusion == 'success'` gate.
  - `.github/workflows/deploy.yml:66` runs only `pnpm build:web` before deploy.
  - `.github/workflows/deploy.yml:77` deploys `dist/web` to Cloudflare Pages production branch `master`.
  - `package.json:34` local `deploy:web` runs `pnpm guard:repo && pnpm build:web && wrangler ...`.
  - `scripts/assert-correct-repo.mjs:8-30` checks folder name, origin, and LaserForge 2.0 app shell, but the GitHub workflow never invokes it.
- Concrete fix:
  - Add `pnpm guard:repo` to the GitHub deploy workflow, normalizing the remote URL if GitHub Actions omits `.git`.
  - For manual dispatch, require `github.ref_name == 'main'` and run the same gate set as CI before publishing, or make manual dispatch re-run the CI workflow and deploy only after success.
  - Add a workflow-level assertion that the deployed commit SHA equals the current `main` SHA before calling Wrangler.

### KF-021 - Electron serial/filesystem permissions are not origin-scoped and navigation is not locked down

- Severity: High
- Confidence: High
- File: `electron/main.ts`
- Function/module: `installPermissionHandlers`, `loadRenderer`, main-window navigation policy
- Trigger path: The Electron renderer navigates away from `app://app` / the configured dev origin, or opens a new window, then remote or unexpected content requests `serial` or File System Access permissions.
- Failure mode: Permission handlers allow permissions by permission name only. They ignore `requestingOrigin`, `details.requestingUrl`, `webContents.getURL()`, and main-frame status. The main process also does not install `will-navigate` or `setWindowOpenHandler` allowlists to keep the app on its known origins.
- Consequence: If navigation or new-window creation is triggered through a future link, XSS, bad imported content path, or dev URL misuse, unexpected content in the default session can reach the serial/file picker permission path. For a laser controller app, serial permission must be scoped to the trusted app origin, not only to a permission string.
- Evidence:
  - `electron/main.ts:136-138` allows `serial` and any permission beginning with `fileSystem`.
  - `electron/main.ts:200-207` installs permission check/request handlers without checking origin or frame details.
  - `electron/main.ts:203-205` allows any serial device permission by device type alone.
  - `electron/main.ts:224-228` loads either arbitrary `LASERFORGE_DEV_URL` or `app://app/index.html`.
  - Repository search found no `setWindowOpenHandler` or `will-navigate` policy in `electron/main.ts`.
  - Electron's security guide recommends origin validation for permission requests and limiting navigation/window creation to known scopes.
- Concrete fix:
  - Add an `isTrustedRendererOrigin(...)` helper that allows only `app://app` in production and a narrowly parsed localhost Vite origin in dev.
  - Use `requestingOrigin`, `details.requestingUrl`, `details.isMainFrame`, and `webContents.getURL()` in permission check/request/device handlers.
  - Deny unexpected `will-navigate` and `window.open` requests with tests that prove external HTTPS pages cannot request serial or filesystem access.

### KF-022 - Packaged Electron build ships main-process source maps

- Severity: Low
- Confidence: High
- File: `electron/tsconfig.json`, `electron-builder.yml`
- Function/module: Desktop packaging
- Trigger path: Run `pnpm build:electron-main` and then package the desktop app with `electron-builder`.
- Failure mode: Electron TypeScript emits `.js.map` files and `electron-builder.yml` includes all of `dist-electron/**/*`, so the packaged app includes main-process source maps even though the web build intentionally disables production source maps for proprietary source exposure.
- Consequence: The Windows installer can expose main-process TypeScript source structure, comments, local paths, and security implementation detail. This is lower direct safety risk than renderer source maps, but it contradicts the repo's proprietary-source posture.
- Evidence:
  - `electron/tsconfig.json:16` sets `"sourceMap": true`.
  - `electron-builder.yml:11-14` packages `dist-electron/**/*`.
  - Current `dist-electron` contains `main.js.map` and `serial-port-choice.js.map`.
  - `dist-electron/main.js:267` contains `//# sourceMappingURL=main.js.map`.
- Concrete fix:
  - Disable Electron production source maps or exclude `dist-electron/**/*.map` from packaged files.
  - If maps are needed for crash analysis, generate/upload hidden maps outside the distributed installer.

### KF-023 - Clean-room ADR conflicts with LF1-port trace provenance in production code

- Severity: Medium
- Confidence: High
- File: `DECISIONS.md`, `src/core/trace/*`, `src/ui/trace/*`
- Function/module: Trace pipeline provenance and old-repo separation
- Trigger path: Audit for old LaserForge 1 code mixing or "double code pushed" after the repo mixup.
- Failure mode: ADR-002 says LaserForge 2.0 is a fully clean rewrite with "No code carries over from LF1." Current production trace modules and UI comments repeatedly describe the image trace path as an "LF1 port", "ported from LaserForge 1", or "LF1 parity" implementation.
- Consequence: Maintainers cannot tell from the repo whether the trace code is a clean-room reimplementation, a behavior-parity implementation, or a copied/ported LF1 subsystem. That directly undermines the audit trail for the exact area that caused the current tracing regressions.
- Evidence:
  - `DECISIONS.md:50-58` records ADR-002 as a fully clean rewrite / no port from LF1.
  - `src/ui/trace/trace-worker.ts:3` says "Step 5 of the LF1 image-trace port".
  - `src/core/trace/trace-to-paths.ts:1-10` describes a direct LF1 tracedata path.
  - `src/core/trace/raster-prep.ts:1-15` says preprocessing levers were ported from LaserForge 1.
  - `src/core/trace/dither-trace.ts:1-18` says the trace dither pass was ported from LaserForge 1.
  - `src/ui/trace/ImportImageDialog.tsx:165` labels the commit path "LF1-port".
- Concrete fix:
  - Run a provenance audit against the old LF1 trace files and record whether each current trace module is copied, derived, or behavior-parity only.
  - If any code was copied/ported, update ADR-002 honestly and isolate the ported subsystem with tests and rationale.
  - If no code was copied, rewrite misleading comments to say "behavioral parity with LF1 settings" and preserve tests proving the intended trace behavior.

### KF-024 - Raster/image jobs are omitted from duration estimates

- Severity: Medium
- Confidence: High
- File: `src/core/job/planner.ts`, `src/core/job/estimate-duration.ts`, `src/ui/laser/live-job-estimate.ts`
- Function/module: `estimateWithPlanner`, `estimateJobDuration`, `estimateLiveJob`
- Trigger path: User imports a bitmap image on an Image-mode output layer and looks at the Start-job estimate, or any caller asks `estimateJobDuration` for a raster-only job.
- Failure mode: `estimateWithPlanner` skips raster groups and says they are "accounted for separately", but `estimateJobDuration` only delegates to `estimateWithPlanner`. For a raster-only job, the estimate totals zero seconds. `estimateLiveJob` then reports `empty`.
- Consequence: Image engraving can show no time estimate even though it will emit real raster G-code and may run for a long time. That misleads operators about job size and burn duration.
- Evidence:
  - `src/core/job/planner.ts:88-94` skips `group.kind === 'raster'`.
  - `src/core/job/estimate-duration.ts:37-38` delegates directly to `estimateWithPlanner`.
  - `src/ui/laser/live-job-estimate.ts:29-32` maps `totalSeconds === 0` to `{ kind: 'empty' }`.
  - `src/core/job/estimate-duration.test.ts` has no raster duration test.
  - `src/ui/laser/live-job-estimate.test.ts` has no image/raster estimate test.
- Concrete fix:
  - Add failing tests for raster-only and mixed vector+raster jobs.
  - Implement a raster duration estimator that accounts for active row sweeps, overscan, feed, passes, skipped blank rows, and row-to-row travel, or synthesize raster motion blocks for the planner.
  - Update live estimate UI copy so image-only jobs never appear empty when they will emit G-code.

### KF-025 - Live estimate budget ignores generated fill hatch segment count

- Severity: Medium
- Confidence: High
- File: `src/ui/laser/live-job-estimate.ts`
- Function/module: `estimateLiveJob`, `countCompiledCutSegments`
- Trigger path: User sets a large shape to Fill mode with dense hatching, then edits layer settings or scene geometry while the Laser panel is visible.
- Failure mode: The raw-vector budget checks only input vector segment count, then `compileJob` can expand a simple closed shape into thousands of fill hatch segments. The compiled budget check counts only `cut` groups and ignores `fill` groups, so dense fill hatches can still run through optimization/estimation on the React render path.
- Consequence: A simple-looking fill job can freeze or slow the UI despite the live-estimate budget intended to protect large traces.
- Evidence:
  - `src/ui/laser/live-job-estimate.ts:18-26` compiles before the compiled segment budget is checked.
  - `src/ui/laser/live-job-estimate.ts:43-53` raw segment counting ignores the hatches that fill mode will generate.
  - `src/ui/laser/live-job-estimate.ts:58-64` `countCompiledCutSegments` adds only `group.kind === 'cut'`.
  - `src/core/job/compile-job.ts:216-218` replaces fill-mode polylines with `memoizedFillHatching(...)` before pushing segments.
  - `src/ui/laser/live-job-estimate.test.ts` covers huge traced line vectors, but not dense fill hatch output.
- Concrete fix:
  - Add a failing live-estimate test for a simple large fill object with dense hatch spacing that produces more than `LIVE_ESTIMATE_COMPILED_SEGMENT_BUDGET` fill segments.
  - Count fill segments in the compiled budget, and consider a pre-compile fill-cost guard based on bbox height / hatch spacing.
  - Keep live estimate allowed for normal fill jobs, but return `too-large` before invoking expensive planner work for dense hatching.

### KF-026 - File-size hard cap is weakened by enforcement and already exceeded physically

- Severity: Medium
- Confidence: High
- File: `CLAUDE.md`, `eslint.config.mjs`, `src/core/trace/dither-trace.ts`, `src/core/trace/trace-image.ts`, `src/ui/state/laser-store.ts`
- Function/module: File-size rule enforcement
- Trigger path: Whole-repo audit for "Karpathy" tight-leash / small-file discipline.
- Failure mode: The repo manual says the file hard limit is 400 lines with "No exceptions", but ESLint enforces `max-lines` with `skipBlankLines: true` and `skipComments: true`. That allows physically oversized files to pass as long as enough lines are comments or blanks. Current production files exceed the written physical cap.
- Consequence: Large, multi-concern files can keep growing while lint stays green. That weakens reviewability and directly conflicts with the repo's small-diff/small-file discipline.
- Evidence:
  - `CLAUDE.md:41` says file hard limit is 400 lines, lint error at hard, no exceptions.
  - `eslint.config.mjs:112` sets `max-lines` with `skipBlankLines: true` and `skipComments: true`.
  - Line-count sweep: `src/core/trace/dither-trace.ts physical=519`, `src/core/trace/trace-image.ts physical=487`, `src/ui/state/laser-store.ts physical=462`.
  - Earlier `corepack.cmd pnpm lint` reported only the now-fixed parser/complexity errors, not these file-size breaches.
- Concrete fix:
  - Decide whether the rule is physical-line hard cap or non-comment-line hard cap, then make `CLAUDE.md` and ESLint agree.
  - If physical, remove `skipBlankLines` / `skipComments` or add a separate physical-line check.
  - Split the oversized production files around real responsibilities: trace dither mode catalog/algorithms, trace loader/options/presets, and laser store connection/stream/job actions.

### KF-027 - Pure-core raster decode depends on host global `atob`

- Severity: Medium
- Confidence: High
- Status: Fixed in current working tree
- File: `src/core/job/compile-job.ts`, `eslint.config.mjs`
- Function/module: `decodeBase64Luma`, pure-core lint rules
- Trigger path: Compile an image-mode raster job from a `.lf2` raster image whose `lumaBase64` field is present.
- Failure mode: `decodeBase64Luma` calls host global `atob` inside `src/core`. The local pure-core contract bans platform/global dependencies and says enforcement comes from ESLint, but the pure-core restricted-globals list does not include `atob` or `btoa`.
- Consequence: Raster job output depends on a runtime global outside the pure-core API. In a runtime without `atob`, the catch path silently turns the raster luma white/S0, so a raster image can compile to laser-off output instead of the saved image data.
- Evidence:
  - `CLAUDE.md:151-162` defines pure core as no platform/global dependencies and says ESLint enforces it.
  - `src/core/job/compile-job.ts:120-130` implements `decodeBase64Luma` using `atob(base64)`.
  - `eslint.config.mjs:188-198` restricts `window`, `document`, `navigator`, `localStorage`, `sessionStorage`, and `fetch`, but not `atob` / `btoa`.
  - The current watchlist note for this item was promoted after the whole-core global sweep found no other production core `atob`/`btoa` uses.
- Concrete fix:
  - Applied: replaced `atob` with a pure local base64 decoder, added a regression that removes `globalThis.atob`, and banned `atob` / `btoa` from core lint.
  - Verified: the regression first failed with all-S0 output, then passed after the decoder fix; `corepack.cmd pnpm test src/core/job/compile-job.test.ts`, `corepack.cmd pnpm run typecheck`, and `corepack.cmd pnpm lint` pass.

### KF-028 - Lazy import promise caches rejected trace/font chunks for the whole session

- Severity: Medium
- Confidence: High
- File: `src/core/trace/trace-image.ts`, `src/core/trace/trace-to-paths.ts`, `src/core/text/text-to-polylines.ts`
- Function/module: `loadTracer`, `loadOpentype`
- Trigger path: First dynamic import of `imagetracerjs` or `opentype.js` rejects because the worker/browser cannot fetch or evaluate the chunk.
- Failure mode: Each loader stores the first dynamic import promise in a module-level `let`. If that promise rejects, the rejected promise remains cached forever; subsequent calls reuse the same rejection instead of retrying. This also conflicts with `CLAUDE.md`'s "No module-level mutable variables" rule unless an ADR explicitly carves out deterministic loader caches.
- Consequence: A transient chunk-load failure can make Trace or Add Text fail for the rest of the app session until reload. In the trace worker path, the worker now survives per-request errors, but the worker's core trace loader can still return the same cached rejection on every later request.
- Evidence:
  - `CLAUDE.md:142-145` says mutable state is allowed only in Zustand slices and forbids module-level mutable variables.
  - `src/core/trace/trace-image.ts:38-47` caches `tracerPromise` without clearing it on rejection.
  - `src/core/trace/trace-to-paths.ts:117-126` repeats the same cache pattern for the tracedata path.
  - `src/core/text/text-to-polylines.ts:45-55` caches `opentypePromise` the same way.
  - The module-level sweep also found deterministic caches such as `src/core/trace/dither-trace.ts:420`, which need either ADR exceptions or a lint-compatible pattern.
- Concrete fix:
  - Wrap lazy imports in a helper that clears the module cache on rejection and retries on the next call.
  - Add failing tests for rejected-first-then-resolved dynamic imports in trace and text loaders.
  - Either enforce the no-module-mutable rule or document explicit, narrow ADR exceptions for deterministic library/lookup caches.

### KF-029 - File open/save action failures can escape as generic unhandled rejections

- Severity: Medium
- Confidence: High
- File: `src/ui/app/file-actions.ts`, `src/ui/common/Toolbar.tsx`, `src/ui/app/shortcuts.ts`
- Function/module: `handleOpenProject`, `handleSaveProject`, `handleSaveGcode`, `handleImportSvg`
- Trigger path: File picker, file read, or save picker throws for a non-cancel error such as permission loss, file handle revocation, filesystem failure, or browser API failure.
- Failure mode: Some file actions catch only the final write/parse stage, not the picker/read stage. Toolbar and shortcut callers invoke the async actions with `void`, so a rejected promise reaches `useGlobalErrorHandlers` as a generic unhandled rejection rather than the file action's contextual "Could not open/save/import" toast.
- Consequence: Operators can get poor recovery copy or miss the action-specific failure. For `.lf2` open, `file.text()` can reject before `deserializeProject` runs, so the app never reaches the documented "Could not open" path for that file.
- Evidence:
  - `src/platform/types.ts:67-71` defines async picker/file operations that can reject.
  - `src/platform/web/web-adapter.ts:29-43` rethrows non-`AbortError` open-picker failures.
  - `src/ui/app/file-actions.ts:124-148` awaits `pickFilesForOpen` and `file.text()` outside any catch in `handleOpenProject`.
  - `src/ui/app/file-actions.ts:96-105` awaits `pickFileForSave` outside the write catch in `handleSaveProject`; `src/ui/app/file-actions.ts:63-73` does the same for G-code save.
  - `src/ui/common/Toolbar.tsx:97-131` and `src/ui/app/shortcuts.ts:97-135` call these actions with `void`.
  - `src/ui/app/use-global-error-handlers.ts:24-29` converts the resulting failure to generic `Unhandled rejection: ...` copy.
- Concrete fix:
  - Wrap picker/read phases in the same contextual error handling as parse/write phases.
  - Add file-action unit tests with mock `PlatformAdapter` implementations whose picker/read/write functions reject, proving the user gets `Could not open/save/import...` and no unhandled rejection.
  - Keep cancel behavior unchanged (`[]` / `null` should remain silent).

### KF-030 - Unknown text font keys can drift from rendered geometry after edit/save

- Severity: Low
- Confidence: High
- File: `src/ui/text/AddTextDialog.tsx`, `src/ui/text/FontPicker.tsx`, `src/core/text/font-registry.ts`
- Function/module: `commitText`, `asKnownFontKey`, `FontPicker`
- Trigger path: Open or edit a `.lf2` text object whose `fontKey` is not in the current `FONT_REGISTRY`, such as a project saved by a future build with a newly bundled font.
- Failure mode: The renderer loads `DEFAULT_FONT_KEY` for unknown keys, but the saved `TextObject` keeps the original unknown `fontKey`. The picker visually falls back to the first registry entry while no list option is actually selected for the raw value.
- Consequence: Text geometry can be regenerated with Roboto/default paths while project metadata still claims a different unknown font. A later build that recognizes that key could interpret the same saved object differently, and the operator receives no toast that the font was substituted.
- Evidence:
  - `src/core/text/font-registry.ts:20-22` intentionally lets `.lf2` carry future-unknown `TextObject.fontKey` strings.
  - `src/core/text/font-registry.ts:58-60` says callers decide how to fall back, typically with a toast.
  - `src/ui/text/AddTextDialog.tsx:151` loads `loadFont(asKnownFontKey(v.fontKey))`.
  - `src/ui/text/AddTextDialog.tsx:165` saves `fontKey: v.fontKey` unchanged.
  - `src/ui/text/AddTextDialog.tsx:276-278` maps unknown keys to `DEFAULT_FONT_KEY`.
  - `src/ui/text/FontPicker.tsx:31` displays the first registry font when `props.value` is unknown.
  - `src/ui/text/FontPicker.tsx:55-56` still marks options selected by the raw unknown value, so none are selected.
- Concrete fix:
  - Add a dialog/store regression test for editing a text object with an unknown `fontKey`.
  - Either normalize the saved key to `DEFAULT_FONT_KEY` when fallback geometry is generated and show a substitution toast, or preserve the unknown key but refuse silent regeneration until the user explicitly selects a bundled font.
  - Make the picker expose an explicit "Missing font" state instead of visually selecting Roboto while retaining an unknown raw value.

### KF-031 - Active custom origin can bypass physical-bed proof when WCO is unknown

- Severity: High
- Confidence: High
- File: `src/ui/state/laser-store.ts`, `src/ui/laser/start-job-readiness.ts`, `src/ui/laser/JobControls.tsx`
- Function/module: Custom work-origin bounds gating
- Trigger path: Operator clicks `Set origin here` before LaserForge has an `MPos`/WCO sample, later receives an Idle status/settings, then starts or frames from the active custom origin.
- Failure mode: `workOriginActive` can be true while `wcoCache` remains null. `prepareStartJob` switches to user-origin G-code, but `findOriginBoundsIssue` returns null when `wcoCache` is null. `Frame` similarly applies user-origin job placement, but validates un-offset work bounds when the physical offset is unknown.
- Consequence: The app accepts a user-origin job/frame without proving where that user origin sits in machine coordinates. On a diode gantry without soft limits, that can drive a frame or burn path off-bed even though the on-screen job bounds look valid relative to the workpiece.
- Evidence:
  - `src/ui/state/laser-store.ts:425-429` sets `workOriginActive: true` after `G92` and only sets `wcoCache` when `inferCurrentMachinePosition(get())` is non-null.
  - `src/ui/laser/start-job-readiness.ts:71` treats `workOriginActive === true` as enough to use user-origin output.
  - `src/ui/laser/start-job-readiness.ts:79` skips origin bounds validation when `machine.wcoCache` is null/undefined.
  - `src/ui/laser/JobControls.tsx:246-248` uses un-offset bounds for Frame when `workOriginActive` is true but `wcoCache` is null.
  - `src/ui/laser/JobControls.tsx:258` then sends `frame(bounds, feed)`.
- Concrete fix:
  - Add Start and Frame regressions for `workOriginActive: true` with `wcoCache: null`.
  - Block Start/Frame with clear copy until a physical origin is known from `MPos`/WCO, or require Reset Origin before continuing.
  - Consider making `setOriginHere` refuse until a current machine position exists, instead of creating an active-but-unlocated origin.

### KF-032 - Autofocus is a long-running machine operation without a busy/stop lifecycle

- Severity: High
- Confidence: High
- File: `src/ui/state/autofocus-action.ts`, `src/ui/state/laser-store.ts`, `src/ui/laser/JobControls.tsx`, `src/ui/laser/JogPad.tsx`
- Function/module: Autofocus operation lifecycle
- Trigger path: Operator starts a vendor autofocus command that moves/probes for several seconds, times out, or emits delayed/stale status while the Laser panel remains connected.
- Failure mode: Autofocus is not represented in `LaserState` as an active operation. The Laser UI disables Home/Frame/Start/Set Origin mostly from connection state and streamer status, not from an autofocus lease. The timeout path resolves `{ kind: 'timeout' }` and shows a warning; it does not send stop/reset and does not put the machine into an explicit recovery state.
- Consequence: Home, jog, frame, set-origin, disconnect, or possibly Start can be attempted while autofocus is still in flight. That relies on firmware rejection or timely status updates instead of an app-level operation mutex around a hardware-moving command.
- Evidence:
  - `src/ui/state/laser-store.ts:334` delegates directly to `runAutofocus(...)` without setting a busy field.
  - `src/ui/state/autofocus-action.ts:66` resolves timeout as `{ kind: 'timeout' }`.
  - `src/ui/state/autofocus-action.ts:110-111` writes the autofocus command and a status query directly to the same serial connection.
  - `src/ui/laser/JobControls.tsx:108` defines `busy` as `props.disabled || props.streaming`; autofocus is not included.
  - `src/ui/laser/JobControls.tsx:119`, `src/ui/laser/JobControls.tsx:140`, and `src/ui/laser/JobControls.tsx:146` leave Home, Frame, and Start controlled by connection/streamer state only.
  - `src/ui/laser/LaserWindow.tsx:75` disables `JogPad` only when the connection is not connected.
- Concrete fix:
  - Add an `operation`/`machineBusy` state or lease for autofocus and other single-line machine operations.
  - Disable Home/Jog/Frame/Start/Set Origin/Disconnect while autofocus is active, except for a deliberate Stop/E-stop recovery path.
  - Add timeout tests proving the UI enters recovery copy and does not silently return to normal controls while the command may still be active.
  - Decide whether autofocus timeout should send `RT_SOFT_RESET` before resolving or require physical E-stop/power cutoff copy, then encode that policy explicitly.

### KF-033 - Web Serial cable-yank path does not release reader/writer locks

- Severity: Medium
- Confidence: Medium
- File: `src/platform/web/web-serial.ts`
- Function/module: Web Serial cable-yank resource lifecycle
- Trigger path: USB serial cable is disconnected while a Web Serial connection owns reader/writer locks, then the operator reconnects and tries to select/open the same paired port again.
- Failure mode: The disconnect-event path calls `fireClose`, which marks the connection closed and notifies subscribers. It does not call `closeStreams`, release the reader/writer locks, close the port, or remove the event listener. Those cleanup steps only run on explicit `close()`.
- Consequence: The old `SerialPort` object can retain locked resources after cable-yank, making the next stale-port sweep best-effort and potentially leaving reconnect to fail with stale open/locked-port errors.
- Evidence:
  - `src/platform/web/web-serial.ts:101-104` defines `fireClose` as closed flag plus subscriber notification only.
  - `src/platform/web/web-serial.ts:106-108` wires the hardware `disconnect` event and read-loop end to that same `fireClose`.
  - `src/platform/web/web-serial.ts:123-146` performs stream cleanup only in explicit `close()`.
  - `src/platform/web/web-serial.ts:182-205` shows `closeStreams` is the only path that calls `reader.releaseLock()` and `writer.releaseLock()`.
  - `src/platform/web/web-serial.ts:45-53` swallows failed stale-port close attempts before the next picker.
- Concrete fix:
  - Add a mock Web Serial test for disconnect-event cleanup.
  - Release reader/writer locks in the disconnect/read-loop-finally path without calling `port.forget()`.
  - Keep explicit user disconnect as the only permission-revocation path; cable-yank should preserve pairing but not leak locked streams.

### KF-034 - User-origin Start preflight treats work-coordinate overscan as machine-space

- Severity: High
- Confidence: High
- Status: Fixed in current working tree
- File: `src/io/gcode/emit-gcode.ts`, `src/core/preflight/preflight.ts`, `src/ui/laser/start-job-readiness.ts`, `src/ui/laser/JobControls.tsx`, `src/core/job/fill-overscan.ts`, `src/core/raster/emit-raster.ts`
- Function/module: Custom-origin Start/Burn physical bounds preflight
- Trigger path: Operator sets a custom origin with a known WCO, places a fill/image job safely on the bed, and starts from that origin. Fill/raster overscan emits laser-off runway outside the burn bounds, for example work-coordinate `X-5` while the physical machine position is still inside the bed after applying WCO.
- Failure mode: `prepareStartJob` emits user-origin G-code, then blocks on `emitGcode`'s `runPreflight(project, gcode)` result before the Start path applies the known WCO. `runPreflight` assumes raw G-code X/Y are machine coordinates, so negative user-origin work-coordinate overscan is reported as out-of-bed even when the physical path is valid.
- Consequence: Frame can pass while Burn/Start falsely reports out-of-bed for the same physical setup. The operator is trained to distrust the safety gate or move/reset a correct origin. A fix must still reject true physical overscan that would leave the machine bed.
- Evidence:
  - `src/ui/laser/start-job-readiness.ts` uses user-origin placement for `emitGcode(project, { jobOrigin: USER_ORIGIN_JOB_PLACEMENT })`, then immediately blocks if `result.preflight.ok` is false.
  - `src/io/gcode/emit-gcode.ts` always calls `runPreflight(project, gcode)` without an origin/WCO context.
  - `src/core/preflight/preflight.ts` delegates to `findOutOfBoundsCoords(gcode, { width, height })`.
  - `src/core/invariants/predicates.ts` documents that the bounds check expects machine coordinates.
  - `src/ui/laser/JobControls.tsx` Frame computes user-origin job bounds, offsets them by `wcoCache` when known for physical validation, and then sends the un-offset work bounds to the controller frame path.
  - `src/core/job/fill-overscan.ts` and `src/core/raster/emit-raster.ts` intentionally emit laser-off overscan outside the engraved burn bounds.
  - Existing `src/core/preflight/preflight.test.ts` correctly blocks absolute-machine overscan outside the bed; existing `src/ui/laser/start-job-readiness.test.ts` proves user-origin Start output but does not cover negative work-coordinate overscan with a safe WCO.
- Concrete fix:
  - Applied: added failing Start regressions for WCO-safe overscan, WCO-unsafe overscan, and active custom origin with unknown WCO.
  - Applied: made `findOutOfBoundsCoords`, `runPreflight`, and `emitGcode` accept a physical motion offset so user-origin work coordinates are checked in machine space.
  - Applied: `prepareStartJob` now blocks custom-origin Start when WCO is unknown, validates burn bounds before line-level G-code bounds, and runs user-origin G-code preflight with the known WCO offset.
  - Applied: Frame now uses the same custom-origin predicate as Start and refuses to frame while the physical origin is unknown.
  - Verified: focused origin/preflight safety tests pass with 4 files and 43 tests; typecheck passes.
- LightBurn reference:
  - LightBurn's Coordinates and Job Origin docs describe User Origin as output relative to a custom-defined origin set before starting a job, with Job Origin controlling orientation around that origin: https://docs.lightburnsoftware.com/2.1/Reference/CoordinatesOrigin/
  - LightBurn's Overscanning docs describe overscan as extra laser-off movement before and after scan lines, and report an out-of-bounds condition when there is not enough physical room at the edge of the selected start mode/origin: https://docs.lightburnsoftware.com/2.0/Explainers/Overscanning/

### KF-035 - Fill hatch spacing scales with object transform instead of staying physical

- Severity: Medium
- Confidence: High
- File: `src/core/job/compile-job.ts`, `src/core/job/fill-hatching.ts`, `src/core/scene/transform.ts`
- Function/module: `appendPathSegments`, `memoizedFillHatching`, `fillHatching`, `applyTransform`
- Trigger path: Import or create a closed vector shape, scale it in X/Y, switch its layer to Fill, set `hatchSpacingMm`, then save/start G-code or preview output.
- Failure mode: `compileJob` generates hatch polylines in object-local coordinates before applying the object transform. `applyTransform` then scales those hatch lines by `transform.scaleX` / `transform.scaleY`. The layer says hatch spacing is in millimeters, but the physical emitted spacing becomes `hatchSpacingMm * transform scale` along the transformed hatch-normal direction.
- Consequence: The layer UI can claim 1.0 mm spacing while a 2x-scaled object burns at 2.0 mm row spacing, or a 0.5x-scaled object burns at 0.5 mm spacing. That changes burn density, visual fill quality, job time, and material heating without an honest layer setting. It also makes fill output depend on whether geometry was imported at natural size or auto-fit via an object transform.
- Evidence:
  - `src/core/scene/layer.ts:30` defines `hatchSpacingMm` as a layer field; `src/ui/layers/LayerRow.tsx:217-218` exposes it directly to the user as a layer parameter.
  - `src/core/job/fill-hatching.ts:4-5` describes hatch spacing as millimeters; `src/core/job/fill-hatching.ts:49-53` uses `input.hatchSpacingMm` directly as the scanline spacing.
  - `src/core/job/compile-job.ts:225-227` explicitly says fill hatching is generated before applying the object's transform; `src/core/job/compile-job.ts:240-243` calls `memoizedFillHatching(...)` first and then applies `applyTransform`.
  - `src/core/scene/transform.ts:11-12` applies `scaleX` and `scaleY` to every generated hatch endpoint.
  - LightBurn's Fill Mode / layer settings documentation treats line interval as the distance between fill lines, not as object-local artwork units: https://docs.lightburnsoftware.com/legacy/Reference/CutsLayers/FillMode/
- Concrete fix:
  - Add a failing `compileJob` regression for a filled square with `hatchSpacingMm = 1` and `transform.scaleY = 2`, asserting emitted machine-space hatch rows stay 1 mm apart.
  - Decide the implementation with one coordinate-space rule: either hatch after applying object transform in scene space, or compensate the requested hatch spacing by the transform's normal-direction scale for uniform/non-uniform scale and rotation.
  - Add a non-uniform-scale test because `scaleX != scaleY` plus hatch angle makes the effective spacing depend on the hatch-normal vector, not just one axis.
  - Keep preview and emitted output tied to the same corrected compile path.

### KF-036 - Hidden SVG geometry is imported as laser output

- Severity: Medium
- Confidence: High
- File: `src/io/svg/parse-svg.ts`, `src/io/svg/shape-to-polylines.ts`
- Function/module: `walkGeometry`, `normalizeColor`, `elementToSubPaths`
- Trigger path: Import an SVG that contains hidden construction lines, alternate layers, crop guides, or template geometry using `display="none"`, `visibility="hidden"`, `opacity="0"`, `stroke-opacity="0"`, or equivalent style declarations, while those elements still have a stroke color.
- Failure mode: `walkGeometry` iterates every descendant geometry element and calls `elementToSubPaths` without checking effective visibility or opacity. Color attribution reads only the raw `stroke` attribute; there is no gate for `display`, `visibility`, `opacity`, `stroke-opacity`, or inline CSS style equivalents.
- Consequence: Artwork that is intentionally invisible in the source SVG can become visible LaserForge geometry, receive a layer, and be saved/started as real G-code. Hidden guide lines or alternate design layers can therefore be cut/engraved unexpectedly.
- Evidence:
  - `src/io/svg/parse-svg.ts:117-129` walks every descendant, converts geometry, and uses only `el.getAttribute('stroke')` for color.
  - `src/io/svg/shape-to-polylines.ts:16-31` converts supported geometry tags purely from geometry attributes; it has no visibility/style filter.
  - `rg` found no production SVG import checks for `display`, `visibility`, `opacity`, or `stroke-opacity`.
  - `src/io/svg/parse-svg.test.ts` covers color grouping, viewBox bounds, no-stroke/text/image cases, and sanitizer counts, but not hidden or transparent geometry.
- Concrete fix:
  - Add failing SVG import tests for `display="none"`, `visibility="hidden"`, `opacity="0"`, `stroke-opacity="0"`, and inline `style="display:none"` / `style="stroke-opacity:0"`.
  - Resolve effective presentation attributes while walking ancestors, not only direct element attributes.
  - Skip geometry whose effective display is none, visibility is hidden/collapse, or effective stroke opacity/overall opacity is zero.
  - Combine this with the KF-017 style/inheritance fix so stroke color, visibility, and transform resolution share one SVG presentation-state walker.

### KF-037 - Image-heavy projects can silently lose autosave recovery

- Severity: Medium
- Confidence: High
- File: `src/ui/state/autosave.ts`, `src/ui/app/use-autosave.ts`, `src/core/scene/scene-object.ts`, `src/ui/common/Toolbar.tsx`
- Function/module: `writeAutosave`, `startAutosaveLoop`, `useAutosave`, image import serialization
- Trigger path: Import one or more large images, continue editing until the project is dirty, then rely on autosave/recovery after a browser crash, forced close, tab discard, or machine restart.
- Failure mode: Raster objects embed original image bytes as `dataUrl` in the project model. Autosave serializes the full project into one `localStorage` value on the interval and before unload. `localStorage.setItem` quota failures are caught and ignored, and `writeAutosave` returns `void`, so the UI has no way to warn that recovery has stopped working.
- Consequence: The user can believe their image-heavy job is protected by autosave while no recoverable autosave slot exists. A crash or forced close can lose imported images, traced vectors, layer settings, and origin/safety state since the last explicit save.
- Evidence:
  - `src/core/scene/scene-object.ts:113` documents that `dataUrl` carries PNG bytes embedded in the `.lf2` project; `src/core/scene/scene-object.ts:128` stores it as a string on raster objects.
  - `src/ui/common/Toolbar.tsx:249-263` imports images by reading the file as a data URL and storing both `dataUrl` and sampled `lumaBase64` in the object.
  - `src/ui/state/autosave.ts:9` explicitly notes the `localStorage` path and approximate 5 MB cap.
  - `src/ui/state/autosave.ts:38-48` writes the full serialized autosave record with `localStorage.setItem(...)` and swallows all write errors.
  - `src/ui/app/use-autosave.ts:39-49` relies on the same write path for both the periodic loop and the synchronous `beforeunload` save.
  - `src/ui/state/autosave.test.ts` covers round-trip, corrupt JSON, schema mismatch, clear, loop timing, and synchronous write behavior, but has no quota-failure test or user-visible degradation path.
- Concrete fix:
  - Add a failing autosave test that makes `localStorage.setItem` throw `QuotaExceededError` and asserts the app records a visible recoverability warning instead of silently succeeding.
  - Change `writeAutosave` to return a structured result such as `{ ok: true } | { ok: false; reason: 'quota' | 'unavailable' | 'unknown' }`.
  - Surface a non-dismissed-until-fixed warning in the app shell when autosave fails, with copy that tells the operator to save the `.lf2` file manually.
  - Move image-heavy autosave storage to IndexedDB or another larger browser/Electron storage lane, or split the autosave record so the metadata path can still recover when image bytes exceed quota.
  - Add a regression with a realistic embedded image payload size so this does not regress back to localStorage-only silent failure.

## Watchlist, Not Yet Promoted to Findings

- `src/ui/trace/image-loader.ts` has a misleading chunking comment in `extractLumaBase64`; it does not currently use chunked conversion. This looks like performance/comment debt, not yet a correctness finding.
- Several UI and platform files lack direct sibling tests, but `AUDIT.md` already accepts a UI coverage gap. The actionable finding is the mismatch between the documented CI rule and actual enforcement.
- Electron's top comment says `LASERFORGE_DEV_URL` uses Vite HMR with loosened CSP, but `dev:desktop` currently builds the web bundle and loads `app://app/index.html`; this looks like stale dev-mode documentation unless someone is manually setting `LASERFORGE_DEV_URL`.
- Raster preview scrubber does not animate raster rows, but `WORKFLOW.md` and `DECISIONS.md` explicitly document that raster simulation renders complete while the vector scrubber animates vector toolpaths only. Not a finding unless that product decision changes.

## Continuation Pass - Serial/Web Serial

2026-06-02 continuation audit resumed from the first Next Audit Pass item: stop, pause, resume, disconnect, cable-yank, polling, and buffered writes.

- Reconfirmed LF2 repo identity with `corepack pnpm guard:repo`.
- Read current serial/control paths: `src/platform/web/web-serial.ts`, `src/core/controllers/grbl/streamer.ts`, `src/ui/state/laser-store.ts`, `src/ui/state/laser-line-handler.ts`, `src/platform/types.ts`, `src/ui/laser/LaserWindow.tsx`, and related tests.
- Existing fixes verified by inspection: streamer has a distinct `disconnected` terminal status; idle status polling backs off via `IDLE_POLL_DIVISOR`; `resumeJob` and `stopJob` use functional state updates.
- Open findings still cover the actionable serial risks found in this pass:
  - KF-001: explicit Disconnect can bypass running-job stop/reset.
  - KF-011: `startJob` can drop fast early acknowledgements before streamer state is installed.
  - KF-012: ack-driven follow-up writes can make streamer state outrun actual serial writes.
  - KF-032: autofocus lacks a busy/stop lifecycle.
  - KF-033: Web Serial cable-yank path does not release reader/writer locks.
- False-positive / duplicate rejection: draft findings for "early Start ack loss" and "ack-driven continuation write rejection" were rejected as duplicates of KF-011 and KF-012 before final scoring. No new serial finding was added in this continuation pass.

## Continuation Pass - Output/Raster Emission

2026-06-02 continuation audit then covered the second Next Audit Pass item: GRBL modal state, `S0`, laser-off travel, raster scan direction, overscan, bounds, and imported layer numbers feeding output.

- Read current output/raster paths: `src/core/output/grbl-strategy.ts`, `src/core/raster/emit-raster.ts`, `src/core/raster/luma-resample.ts`, `src/core/job/compile-job.ts`, `src/core/job/fill-overscan.ts`, `src/core/invariants/predicates.ts`, `src/io/gcode/emit-gcode.ts`, `src/io/project/deserialize-project.ts`, and related tests.
- Existing output protections verified by inspection: G-code preamble arms `M3 S0`; every vector rapid carries `S0`; fill overscan enters and exits with laser-off moves; raster groups wrap with `M5` / `M4 S0` / `M5`; mixed raster-to-vector output re-arms `M3 S0`; current tests cover laser-off travel, bounded happy-path output, raster `S0` exits, mixed modal transitions, deterministic output, and safe-white fallback for missing/corrupt raster luma.
- New evidence was found for existing KF-015: imported `.lf2` layer numbers can bypass UI clamps. Valid JSON numeric overflow such as `1e309` becomes JavaScript `Infinity`; `normalizeLayer` accepts it; fill overscan can format to `XInfinity`, and image `linesPerMm` can request impossible raster dimensions.
- False-positive / duplicate rejection: this was not promoted as a new finding because it is a concrete trigger under KF-015, not a separate root cause.
- No additional output/raster finding was added in this pass beyond strengthening KF-015.

## Continuation Pass - Image Import and Trace Pipeline

2026-06-02 continuation audit then covered image import, selected-image tracing, trace worker bootstrap, large-image fallback, luma preservation, preview/commit consistency, and trace-related cache/state behavior.

- Read current image/trace paths: `src/ui/common/Toolbar.tsx`, `src/ui/common/image-import.ts`, `src/ui/trace/image-loader.ts`, `src/ui/trace/ImportImageDialog.tsx`, `src/ui/trace/use-trace-preview.ts`, `src/ui/trace/use-trace-worker-client.ts`, `src/ui/trace/trace-worker.ts`, `src/core/trace/trace-image.ts`, `src/core/trace/trace-to-paths.ts`, `src/ui/state/import-actions.ts`, `src/ui/state/scene-mutations.ts`, `src/ui/workspace/draw-raster.ts`, `src/ui/workspace/draw-raster-preview.ts`, and related tests.
- Existing trace/import protections verified by inspection: Import Image stores a raster first; Trace runs only on a selected raster; data URLs are reconstructed without `fetch(data:)`; transparent PNGs are composited onto white before tracing/luma extraction; preview and commit use the same trace wrapper and decode cap; trace overlays fold the source bitmap's mm-per-pixel scale into the traced vector transform; the source raster is tagged `trace-source`; image import geometry has direct tests for natural-size physical bounds plus sampled luma dimensions; trace worker request errors no longer retire the worker.
- Open findings still cover the actionable image/trace risks found in this pass:
  - KF-010: large-image worker path lacks an automated browser smoke test against the built worker/CSP/deploy headers.
  - KF-014: preview trace completion can still overwrite a newer trace because `runTrace` does not receive/check the freshness token before final `setState`.
  - KF-018: Output/Preview rendering still lacks the same whole-scene large-trace budget used by normal workspace drawing.
  - KF-019: raster/preview caches retain large deleted images for the session.
  - KF-023: trace provenance comments still conflict with the clean-room ADR.
  - KF-028: rejected dynamic imports in trace/font lazy loaders are still cached for the session.
- False-positive / duplicate rejection: a draft concern about natural image size versus sampled luma metadata was rejected because `rasterImportGeometry` intentionally uses natural dimensions for physical size and sampled dimensions for stored luma, and `src/ui/common/image-import.test.ts` covers that contract. A draft concern about trace-dialog seed replacement was rejected as not having a realistic operator trigger in the current modal/toolbar flow.
- No new image/trace finding was added in this pass.

## Continuation Pass - Job Compiler and Planner

2026-06-02 continuation audit then covered scene-to-job transforms, layer intent, origin transforms, pass ordering, duration estimates, toolpath generation, fill hatching, and path optimization.

- Read current job/compiler paths: `src/core/job/compile-job.ts`, `src/core/job/fill-hatching.ts`, `src/core/job/fill-overscan.ts`, `src/core/job/job-origin.ts`, `src/core/job/job-bounds.ts`, `src/core/job/toolpath.ts`, `src/core/job/planner.ts`, `src/core/job/estimate-duration.ts`, `src/core/job/optimize-paths.ts`, `src/ui/laser/live-job-estimate.ts`, `src/ui/laser/start-job-readiness.ts`, `src/ui/laser/job-intent-warnings.ts`, and related tests.
- Existing protections verified by inspection: layer order is preserved; optimizer only reorders within cut groups; optimizer preserves group metadata and has determinism/idempotence tests; raster bounds contribute to job bounds; Set Origin preflight now applies physical WCO offset; trace-vector intent warnings are surfaced before Start.
- Existing findings still cover two job-estimate risks found in this pass:
  - KF-024: raster/image groups are still skipped by planner duration, while `estimateJobDuration` has no separate raster path.
  - KF-025: live estimate still checks raw vector segment count before compile and then counts only compiled `cut` groups, not generated `fill` hatch segments.
- New finding added:
  - KF-035: fill hatch spacing is generated in object-local coordinates before transform, so object scale changes the physical row spacing despite `hatchSpacingMm` being a layer millimeter setting.
- False-positive / duplicate rejection: a draft "raster skipped by toolpath" note was rejected as already covered by KF-024/KF-018 product gaps; the current vector scrubber explicitly skips raster rows and the duration finding captures the misleading estimate consequence.

## Continuation Pass - Project/SVG Import-Export Boundary

2026-06-02 continuation audit then covered project serialization/deserialization, migrations, open/save G-code actions, SVG sanitization, SVG parsing, drag/drop import, re-import behavior, and import toast/error surfaces.

- Read current project/SVG paths: `src/io/project/serialize-project.ts`, `src/io/project/deserialize-project.ts`, `src/io/project/migrations.ts`, `src/io/svg/sanitize.ts`, `src/io/svg/parse-svg.ts`, `src/io/svg/shape-to-polylines.ts`, `src/ui/app/file-actions.ts`, `src/ui/app/use-import-drag-drop.ts`, `src/ui/app/import-toasts.ts`, `src/ui/state/scene-mutations.ts`, and related tests.
- Existing protections verified by inspection: `.lf2` malformed JSON and top-level shape failures return structured invalid results; future schema versions are blocked; additive fields are backfilled; serializer is deterministic with LF endings; SVG sanitizer strips scripts, foreignObject, external links, and non-image data URIs; sanitizer counts reset between calls; import errors are surfaced through toasts in SVG import paths.
- Existing findings still cover project/SVG risks found in this pass:
  - KF-015: `.lf2` nested field validation remains shallow.
  - KF-016: fill-only SVG geometry is imported as black stroke geometry.
  - KF-017: SVG transforms and inherited/style stroke colors are ignored.
  - KF-029: file action failures can still escape as generic unhandled rejections in some picker/read phases.
  - KF-030: unknown text font keys can drift from rendered geometry after edit/save.
- New finding added:
  - KF-036: hidden/transparent SVG geometry can be imported as real laser output.
- False-positive / duplicate rejection: malformed SVG `viewBox` bounds were not promoted separately because the practical trigger overlaps with broader import validation and downstream preflight catches emitted out-of-bed coordinates; the sharper actionable SVG presentation gap is KF-036.

## Continuation Pass - Electron Boundary

2026-06-02 continuation audit then covered the Electron main process, custom `app://` protocol handler, CSP header injection, Web Serial/File System permissions, serial port picker, build packaging, and Electron tests.

- Read current Electron paths: `electron/main.ts`, `electron/serial-port-choice.ts`, `electron/csp-policy.test.ts`, `electron/tsconfig.json`, `electron-builder.yml`, `package.json`, and platform adapter types.
- Existing protections verified by inspection: `contextIsolation` is true; `nodeIntegration` is false; sandbox and webSecurity are enabled; renderer loads from a custom `app://` origin in packaged mode; the protocol handler normalizes requests and rejects paths outside `dist/web`; CSP is injected through `onHeadersReceived`; serial port selection uses an explicit dialog; Electron CSP has a test for the worker source policy.
- Existing findings still cover Electron risks found in this pass:
  - KF-021: Electron serial/filesystem permission grants are not scoped to an expected renderer origin, and navigation/window-open locking is still not enforced.
  - KF-022: `electron/tsconfig.json` emits source maps and `electron-builder.yml` includes `dist-electron/**/*`, so packaged builds can ship main-process source maps.
- False-positive / duplicate rejection: the missing `electron/preload.ts` file was not a finding because the current app deliberately exposes no preload API; renderer code uses browser Web Serial/File System APIs gated by Electron permission handlers.
- No new Electron finding was added in this pass.

## Continuation Pass - UI State and Rendering Performance

2026-06-02 continuation audit then covered workspace drawing, sampled display caches, preview toolpath building, raster preview caches, autosave, global error handling, and recovery UI surfaces.

- Read current UI/recovery paths: `src/ui/workspace/Workspace.tsx`, `src/ui/workspace/display-polylines.ts`, `src/ui/workspace/draw-scene.ts`, `src/ui/workspace/draw-vector-strokes.ts`, `src/ui/workspace/draw-preview.ts`, `src/ui/workspace/draw-raster.ts`, `src/ui/workspace/draw-raster-preview.ts`, `src/ui/app/use-autosave.ts`, `src/ui/state/autosave.ts`, `src/ui/app/use-global-error-handlers.ts`, `src/ui/common/ErrorBoundary.tsx`, and related tests.
- Existing protections verified by inspection: normal edit drawing owns a persistent `DisplayPolylineCache`; that cache is a `WeakMap` keyed by the immutable polyline array, so replaced/deleted vector arrays are not strongly retained by this path; large trace drawing and large preview drawing have sampling tests; preview toolpath construction is memoized by project object identity while preview mode is active; raster preview uses compile-path luma and layer settings so preview remains aligned with emitted raster intent.
- Existing findings still cover UI/rendering risks found in this pass:
  - KF-014: stale async trace preview results can still overwrite newer dialog state.
  - KF-018: preview/output still lack a whole-scene generated-work budget for many-object or generated-fill/raster cases.
  - KF-019: raster/offscreen preview caches are strong `Map`s keyed by image data/settings and can retain deleted large images for the session.
  - KF-029: some file-action failure surfaces still depend on broad global handlers instead of contextual operator recovery copy.
- New finding added:
  - KF-037: image-heavy projects can silently lose autosave recovery because image bytes are embedded into a localStorage-only autosave slot and quota errors are swallowed.
- False-positive / duplicate rejection: a draft concern that the normal workspace display cache retains deleted trace vectors was rejected because the cache uses a `WeakMap` keyed by the source polyline array. A draft concern that every oversized preview path always visits every point was narrowed because single-polyline preview sampling now has direct test coverage; the remaining risk is broader whole-scene/generated-work budgeting under KF-018.

## Next Audit Pass

After fixes, rerun focused verification and start a second pass over the patched findings. Current highest-priority fix order:

1. KF-001 / KF-033: disconnect and cable-yank safety/resource recovery.
2. KF-035: fill hatch spacing under object transforms.
3. KF-036 and KF-017 together: SVG presentation-state import correctness.
4. KF-037: autosave quota/recovery warning for image-heavy projects.
5. KF-015: finite/ranged validation for imported `.lf2` nested numeric fields.
