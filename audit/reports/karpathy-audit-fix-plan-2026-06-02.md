# Karpathy Audit Fix Plan - 2026-06-02

Status: planning artifact. No production code is changed by this document.

## Target

Fix every current audit finding in the LaserForge 2.0 worktree using the repo's Karpathy rules:

- Evidence first: reproduce or write a failing test before implementation.
- Small diffs: one fix lane per reviewable patch unless two findings share the same root cause.
- LightBurn parity: for operator-facing behavior, state the LightBurn behavior and test LaserForge against it.
- Safety honesty: software cannot claim physical safety beyond what the controller/hardware can actually guarantee.
- Verification before claims: focused tests first, then typecheck/lint/full tests/build, then browser or hardware checks where relevant.

Authoritative current finding sets:

- `audit/findings/karpathy-whole-repo-audit-2026-06-02.json` - 37 findings.
- `audit/findings/lightburn-parity-findings-2026-06-02.json` - 1 finding.
- `audit/findings/karpathy-audit-fix-ledger-2026-06-02.json` - executable per-finding stage ledger covering current and older findings.

Older finding sets are not ignored. They are mapped in Stage 0 and either closed with proof or folded into a current fix lane.

## Execution Rules

1. Start every lane by adding failing tests or a failing verification script.
2. Fix the smallest root cause that makes the failing test pass.
3. Do not mix unrelated refactors with behavior changes.
4. Keep generated docs/snapshots current only after the behavior is correct.
5. Run the focused test set for the lane before moving on.
6. Run the broader gates after each stage, not only at the end.
7. For visual/output features, use rendered or emitted artifacts, not only green unit tests.
8. For serial/laser features, hardware proof must be low-power, supervised, and explicitly reported as hardware verification, not inferred from mocks.

## Stage 0 - Finding Lock And Closure Proof

Purpose: make the queue precise before touching production behavior.

Steps:

1. Parse the current 2026-06-02 Karpathy and LightBurn parity JSON files.
2. Parse older June 1 finding files.
3. Build one coverage ledger with:
   - open current findings,
   - fixed-in-working-tree current findings,
   - older findings superseded by current findings,
   - older findings already fixed with evidence,
   - older findings still needing explicit proof.
4. Reverify already-fixed current findings:
   - KF-002, KF-003, KF-004, KF-008, KF-009, KF-027, KF-034.
5. Reverify older Set Origin findings:
   - LF2-SO-H1: expected fixed.
   - LF2-SO-M1: expected covered by KF-031/KF-034; close only if unknown-WCO and known-WCO paths are both proven.
6. Reverify older whole-repo findings:
   - LF-AUDIT-001 maps to KF-011/KF-012 and safety command write delivery.
   - LF-AUDIT-002 maps to start readiness and machine state blockers.
   - LF-AUDIT-003 may already be fixed by the Electron serial picker; prove or reopen.
   - LF-AUDIT-004 may already be fixed by `lint:electron` / `build:electron-main`; prove or reopen.
   - LF-AUDIT-005 may be fixed by current lint/format status; prove or reopen.
   - LF-AUDIT-006 maps to KF-007 documentation drift.

Verification:

- A script prints every finding ID and its assigned lane.
- No current open finding is unassigned.
- No older finding is left unmapped.

## Stage 1 - Laser Safety And Machine Truth

This stage comes first because these paths can affect real hardware state.

### 1A - Serial write truth, streamer races, and active disconnect

Findings:

- KF-001
- KF-011
- KF-012
- LF-AUDIT-001
- related parts of LF-AUDIT-002

Failing tests first:

- Starting a job while the port emits an immediate `ok` must not drop the ack.
- If the initial job write rejects, LaserForge must not enter a fake streaming state.
- If a follow-up ack-driven write rejects, the streamer must enter an explicit failed/connection-lost state instead of pretending bytes are in flight.
- Clicking Disconnect while streaming/paused must not take the idle `skipStop` path.
- Stop/Pause/Resume/Set Origin delivery failure must surface a command-delivery failure instead of success.

Fix shape:

- Make serial write helpers return a structured result or throw through a controlled boundary.
- Store streamer state before any ack can be lost, but do not claim lines are delivered until write success is known.
- Add a terminal streamer state for write failure or connection loss.
- Route active-job Disconnect through Stop/soft-reset or refuse with clear copy that says physical E-stop/power is required if unsafe.

Verification:

- Focused serial/store tests.
- `corepack pnpm test src/core/controllers/grbl/streamer.test.ts src/ui/state/laser-store.test.ts src/ui/state/laser-line-handler.test.ts`
- Later hardware check: supervised low-power job, app Disconnect while running, then supervised USB-pull test.

### 1B - Machine readiness and custom-origin proof

Findings:

- KF-013
- KF-031
- KF-034 closure proof
- LF2-SO-H1
- LF2-SO-M1
- remaining LF-AUDIT-002 proof

Failing tests first:

- Center-origin device bounds must be checked against the correct negative/positive machine-space rectangle.
- Frame must use the same origin-aware physical bounds model as Start.
- Custom-origin Start/Frame with `wcoCache=null` must block.
- Known-WCO custom-origin overscan must pass only when physical machine-space emitted coordinates are inside the bed.

Fix shape:

- Normalize all bounds checks around a single coordinate-space helper.
- Define valid machine-space ranges per device origin, including center origin.
- Keep active custom-origin Start/Frame blocked until physical WCO/MPos proof exists.

Verification:

- `start-job-readiness`, `frame-preflight`, `preflight`, `job-origin`, and `emit-gcode` tests.
- One generated G-code fixture for center-origin and one for custom-origin overscan.

### 1C - Autofocus operation lifecycle

Findings:

- KF-032

Failing tests first:

- Starting autofocus creates an `autofocusBusy` lease.
- Jog, Home, Frame, Start, Set Origin, Disconnect, and a second Autofocus are disabled or refused while busy.
- Timeout produces explicit recovery state/copy.
- Late `ok` or `error` after timeout cannot unlock the wrong operation.

Fix shape:

- Add an operation lease to LaserState.
- Wrap autofocus command with lifecycle transitions.
- Decide timeout behavior: soft reset where possible, or explicit "use physical stop/power if unsafe" recovery copy.

Verification:

- Focused autofocus and JobControls/JogPad tests.
- Manual dry-run on disconnected mock; hardware only after low-power supervision.

### 1D - Web Serial cable-yank cleanup

Findings:

- KF-033

Failing tests first:

- Mock Web Serial disconnect event while reader/writer locks are held.
- Assert reader/writer locks are released.
- Assert explicit user Disconnect still calls `forget()` but cable-yank does not.

Fix shape:

- Share cleanup logic between read-loop-finally, disconnect event, and explicit close.
- Keep permission revocation only on explicit user disconnect.

Verification:

- Web Serial adapter tests.
- Browser smoke reconnect test if practical.

### 1E - Electron permission, navigation, and serial port trust

Findings:

- KF-021
- LF-AUDIT-003 closure proof
- LF-AUDIT-004 closure proof

Failing tests first:

- Permission requests from unexpected origin/frame are denied.
- Navigation away from trusted app origin is blocked.
- `window.open` is denied unless explicitly allowlisted.
- Multiple serial ports require explicit chooser behavior, or prove current chooser already does this.

Fix shape:

- Add trusted-origin/main-frame checks to permission handlers.
- Add `will-navigate` and `setWindowOpenHandler` policies.
- Keep serial chooser explicit and tested.
- Ensure Electron lint/build is in CI or document the current gate.

Verification:

- Electron main tests.
- `corepack pnpm run lint:electron`
- `corepack pnpm run build:electron-main`

## Stage 2 - LightBurn Output Fidelity And Preview Performance

### 2A - Layer-wide physical Fill hatching

Findings:

- LBP-001
- KF-035

Failing tests first:

- Two separate same-layer overlapping filled objects do not double-hatch the overlap.
- Nested separate same-layer objects behave like a same-layer hole/interaction.
- Different layers still double-engrave when overlapped.
- Scaled objects keep physical `hatchSpacingMm` after transform.
- Non-uniform scale plus hatch angle keeps correct physical spacing.

Fix shape:

- Apply object transforms first.
- Aggregate vector polylines by output layer in scene/machine space.
- Run fill hatching once per layer over aggregate geometry.
- Emit fill overscan after hatching in physical coordinates.

Verification:

- Compile-job tests.
- Fill-hatching tests.
- G-code output snapshots where output shape changes.
- Visual/perceptual preview check against source geometry.

### 2B - Raster/fill duration and live-estimate truth

Findings:

- KF-024
- KF-025

Failing tests first:

- Raster-only job estimate is nonzero.
- Mixed cut+raster job estimate includes raster sweeps.
- Dense fill estimate budget counts generated fill groups before expensive planner work.

Fix shape:

- Add raster motion-block synthesis or a raster sweep estimator.
- Include fill groups in compiled segment counts.
- Add pre-compile fill-cost guard based on rough area/spacing estimate.

Verification:

- Planner and live-estimate tests.
- UI check that dense fill/raster estimates do not freeze the panel.

### 2C - Preview/output rendering budget

Findings:

- KF-018

Failing tests first:

- Large preview with many generated toolpath steps stays under a bounded Canvas2D operation budget.
- Preview scrubber does not visit every point on each redraw for many-object scenes.

Fix shape:

- Batch preview paths.
- Add a global scene budget for preview/toolpath rendering.
- Keep emitted G-code unaffected.

Verification:

- Workspace preview operation-count tests.
- Browser screenshot/performance smoke on a synthetic large trace.

### 2D - Large-image worker browser proof

Findings:

- KF-010

Failing tests first:

- Built web app instantiates the trace worker and traces a synthetic image above `MAX_INLINE_TRACE_PIXELS`.

Fix shape:

- Add a browser smoke test against `dist/web` or a production-like Vite build.
- Assert the error `Trace worker is unavailable for this large image` does not appear.

Verification:

- `corepack pnpm run build:web`
- Browser automation test on the built app.

### 2E - Trace preview freshness

Findings:

- KF-014

Failing tests first:

- Start a slow trace preview with options A.
- Start a newer trace preview with options B.
- Resolve A after B and prove A cannot overwrite the ready/error state.

Fix shape:

- Carry the freshness token into the async trace completion path.
- Check the token before setting ready or error state.
- Keep commit using the same current options as the visible preview.

Verification:

- `use-trace-preview` hook/unit test.
- Browser side-effect-free trace dialog smoke on a throwaway image if practical.

## Stage 3 - Import, Project, And File Boundary Correctness

### 3A - Project schema validation and finite numeric safety

Findings:

- KF-015

Failing tests first:

- `.lf2` with `1e309` for `linesPerMm`, `fillOverscanMm`, `hatchSpacingMm`, speed, power, transforms, bounds, or device dimensions is rejected or clamped.
- Emitted G-code never contains `Infinity`, `NaN`, or non-finite coordinates.
- Raster allocation cannot be driven by imported infinite/absurd dimensions.

Fix shape:

- Validate after migrations and before returning `Project`.
- Use finite/range clamps matching UI limits for layer numeric fields.
- Reject impossible nested object/device geometry.

Verification:

- Project deserialize tests.
- Output invariant tests.
- Fuzz malformed project fixtures.

### 3B - SVG presentation-state import walker

Findings:

- KF-016
- KF-017
- KF-036

Failing tests first:

- Fill-only shape behavior is explicit: skipped or imported as fill according to chosen policy.
- `transform` on groups/elements is applied.
- `style="stroke:#..."` and inherited group stroke colors resolve correctly.
- `display:none`, `visibility:hidden`, `opacity:0`, `stroke-opacity:0`, and style equivalents are skipped.

Fix shape:

- Build a small SVG presentation-state walker.
- Accumulate transforms through ancestors.
- Resolve direct attributes, inline style, inherited stroke, visibility, and opacity in one pass.
- Keep sanitizer security boundaries unchanged.

Verification:

- SVG parser tests.
- Pipeline snapshot update only after behavior is reviewed.
- Visual import smoke with a fixture containing hidden guides and group transforms.

### 3C - File action error surfaces

Findings:

- KF-029

Failing tests first:

- File picker rejection with non-cancel error shows contextual "Could not open/import/save" copy.
- User cancel remains silent.
- Shortcut callers do not create generic unhandled rejection toasts.

Fix shape:

- Catch picker/read/save phases inside file actions.
- Return structured results to callers.
- Keep global unhandled rejection handler for truly unexpected failures.

Verification:

- File action tests with mocked PlatformAdapter.

### 3D - Unknown font edit safety

Findings:

- KF-030

Failing tests first:

- Editing text with an unknown `fontKey` cannot silently regenerate geometry with default font while preserving unknown metadata.

Fix shape:

- Either block edit until user chooses a bundled font, or normalize saved font key with a visible substitution toast.

Verification:

- AddTextDialog / text store tests.
- Project round-trip test for unknown font keys.

### 3E - Trace provenance cleanup

Findings:

- KF-023

Steps:

1. Locate LF1 trace source files if available.
2. Compare current trace files for copied code vs behavior-parity reimplementation.
3. If copied/ported code exists, update ADR-002 and provenance docs honestly.
4. If not copied, replace misleading "LF1 port" comments with "behavioral parity" wording.

Verification:

- Provenance report in `audit/reports`.
- Comment-only production edits if and only if evidence supports them.

## Stage 4 - App Resilience, Caching, And Recovery

### 4A - Raster/preview cache lifecycle

Findings:

- KF-019

Failing tests first:

- Deleted image data URLs are pruned from preview/decode caches.
- Cache size stays below configured byte/item cap after repeated import/delete.

Fix shape:

- Replace unbounded module-level maps with byte-aware LRU or project-scoped cache.
- Clear stale entries when project image references change.

Verification:

- Workspace cache unit tests.
- Browser memory/perf smoke on repeated image import/delete.

### 4B - Image-heavy autosave reliability

Findings:

- KF-037

Failing tests first:

- `localStorage.setItem` throwing `QuotaExceededError` creates a visible autosave warning.
- Manual save clears or downgrades the warning.
- Image-heavy autosave uses a larger storage lane or degrades honestly.

Fix shape:

- Make `writeAutosave` return structured success/failure.
- Surface operator copy: "Autosave could not store this image-heavy project; save the .lf2 manually."
- Move image payloads to IndexedDB or split metadata from image blobs.

Verification:

- Autosave tests.
- Browser quota simulation if practical.

### 4C - Lazy import retry after transient chunk failure

Findings:

- KF-028

Failing tests first:

- First `imagetracerjs` dynamic import rejects, second succeeds.
- First `opentype.js` dynamic import rejects, second succeeds.

Fix shape:

- Clear cached promise on rejection.
- Preserve caching only for successful module loads.

Verification:

- Trace and text loader tests.

## Stage 5 - Build, Deploy, Policy, And Documentation

### 5A - Dev dependency vulnerability

Findings:

- KF-005

Steps:

1. Upgrade `vitest` and `@vitest/coverage-v8` together.
2. Resolve API/config changes without broad test rewrites.
3. Rerun full tests.

Verification:

- `corepack pnpm install`
- `corepack pnpm audit`
- `corepack pnpm test`

### 5B - Deploy workflow gate

Findings:

- KF-020

Steps:

1. Add `guard:repo` to deploy workflow.
2. Require manual deploys to target the production branch.
3. Run or depend on the same CI gates before Cloudflare deploy.

Verification:

- Workflow lint/read-through.
- If GitHub Actions is available, dry-run or inspect workflow with `gh`.

### 5C - Electron source maps

Findings:

- KF-022

Steps:

1. Disable Electron production sourcemaps or exclude `dist-electron/**/*.map`.
2. Keep dev maps if useful and not packaged.

Verification:

- `corepack pnpm run build:electron-main`
- Inspect packaged file list or builder config.

### 5D - Test policy and file-size enforcement

Findings:

- KF-006
- KF-026

Steps:

1. Decide whether the rule is "every source file has direct sibling tests" or a narrower enforced gate.
2. Implement the gate with explicit exceptions, or revise `CLAUDE.md` to match reality.
3. Make physical-line enforcement match the written rule, or change the written rule to match lint's nonblank/comment behavior.
4. Split oversized files around real responsibilities.

Verification:

- Lint fails on an intentionally untested temporary sample during local proof, then sample removed.
- `corepack pnpm run lint`

### 5E - Rolling audit/status docs

Findings:

- KF-007
- LF-AUDIT-006

Steps:

1. Refresh `AUDIT.md` only after fixes and false-positive rejection.
2. Update README/status metrics from actual command output.
3. Preserve dates and distinguish current dirty worktree from clean release state.

Verification:

- Full current gate output cited in docs.
- No stale test count or CI-green claim.

## Final Verification Ladder

After each lane:

1. Focused tests for the changed files.
2. `corepack pnpm run typecheck`
3. `corepack pnpm run lint`
4. `corepack pnpm test` when the lane touches core/output/serial/project state.
5. `git diff --check`

After each stage:

1. `corepack pnpm test`
2. `corepack pnpm run build:web`
3. `corepack pnpm run lint:electron`
4. `corepack pnpm run build:electron-main`
5. `corepack pnpm audit`

Before release/deploy:

1. Browser smoke for import image, trace large image, preview, save G-code.
2. Render/perceptual comparison for Fill, Image, Trace, SVG import fixtures.
3. Low-power supervised hardware test for Stop, Disconnect, cable-yank warning, Frame, Start, Pause/Resume.
4. Cloudflare production deploy only from the verified LF2 repo and production branch.

## Coverage Index

Current Karpathy findings:

- Fixed/proof lanes: KF-002, KF-003, KF-004, KF-008, KF-009, KF-027, KF-034.
- Stage 1: KF-001, KF-011, KF-012, KF-013, KF-021, KF-031, KF-032, KF-033.
- Stage 2: KF-010, KF-014, KF-018, KF-024, KF-025, KF-035, LBP-001.
- Stage 3: KF-015, KF-016, KF-017, KF-023, KF-029, KF-030, KF-036.
- Stage 4: KF-019, KF-028, KF-037.
- Stage 5: KF-005, KF-006, KF-007, KF-020, KF-022, KF-026.

Older June 1 findings:

- LF-AUDIT-001: Stage 1A.
- LF-AUDIT-002: Stage 1A and Stage 1B.
- LF-AUDIT-003: Stage 1E closure proof.
- LF-AUDIT-004: Stage 1E closure proof.
- LF-AUDIT-005: Stage 0 closure proof.
- LF-AUDIT-006: Stage 5E.
- LF2-SO-H1: Stage 0 / Stage 1B closure proof.
- LF2-SO-M1: Stage 0 / Stage 1B closure proof.
