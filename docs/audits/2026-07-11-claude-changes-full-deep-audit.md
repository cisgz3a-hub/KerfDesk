# KerfDesk Claude-changes full deep audit — 2026-07-11 (re-audited)

## Re-audit update — live branch `71683218`

### Snapshot control

This second pass audited `claude/multi-sector-audit-3447b9` at exact commit `7168321886472fb8b0f39abad6efc55d0a3db2a3`, directly in Claude's clean worktree `admiring-hamilton-666624`.

Repository evidence at the start and end of the pass showed:

- the implementation worktree was clean;
- local HEAD matched `origin/claude/multi-sector-audit-3447b9`;
- the branch was 88 commits ahead of the local `main` reference;
- the delta from the previous audited snapshot `1e9a7d02` contained 23 commits, 65 changed files, 1,096 insertions, and 801 deletions;
- the audit documents under the main checkout's `docs/audits/` directory remained untracked and were not committed by this audit.

The user's warning that “nothing is committed” was therefore applied as a scope/safety rule: do not assume the audit artifact is part of the implementation branch, do not commit anything, and audit the exact live state. It was not used to override the Git evidence about Claude's implementation branch.

### Updated verdict

**No P0 was found. The branch remains not merge-ready. None of the prior machine-safety P1 findings were fixed by the 23-commit interval.**

The new interval contains several real, good fixes, but it mostly addresses other audit tickets. Tool-change readiness, fatal lifecycle coverage, recovery frontier/lifetime, initial/arc no-go scanning, camera overlay truth, rotary consumer parity, Ruida path preflight, and unsigned automatic updates remain open exactly as described in the detailed sections below.

The most important change in status is therefore not a downgrade or a new critical: it is confirmation that the earlier P1 register still applies to the latest live branch.

### Changes in this interval that are sound

- Electron navigation no longer dereferences a possibly absent `event.url`; both `will-navigate` and `will-redirect` are guarded.
- The private-camera egress policy now accepts IPv6 ULA and link-local literals while continuing to reject public and malformed addresses.
- Electron no longer mounts the web service-worker update prompt.
- Realtime override controls and the store write path are capability-gated, preventing GRBL override bytes from entering Marlin, Smoothieware, or Ruida line buffers.
- Post-job settle now uses the active driver's marker; Marlin uses `M400` instead of GRBL's dwell literal.
- The migrated vector geometry cluster now uses a canonical `Result<T, E>` instead of throw/catch control flow.
- Geometry/raster import paths were routed through explicit barrels, and several genuinely orphaned modules were deleted.
- The laser profile-versus-controller bed/travel advisory is useful, although its feed analysis is incomplete as documented below.
- Shortcut help now includes copy, cut, paste, group, `Ctrl+U`, and Convert to Bitmap.

### Stop-ship status after the re-audit

| Prior P1 finding | Status at `71683218` |
|---|---|
| Tool change enters a user-actionable state before pre-M0 motion drains | **Open, unchanged** |
| Tool identity and post-boundary Z-zero proof | **Open, unchanged** |
| Alarm/reboot/error lifecycle omissions for `tool-change` | **Open, unchanged** |
| Checkpoint resumes from acknowledged rather than physically executed motion | **Open, unchanged** |
| Checkpoint cleared at ack-`done` before stable physical Idle | **Open, unchanged** |
| Initial no-go-zone entry move skipped | **Open, unchanged** |
| G2/G3 no-go-zone sweeps reduced to endpoint chords | **Open, unchanged** |
| Raw/rectified camera overlay mismatch and trace-only resolution fix | **Open/partial, unchanged** |
| Rotary Frame/ETA/placement/verification versus emitted motion | **Open, unchanged** |
| Ruida path-aware no-go/full preflight/rotary-wrap parity | **Open, unchanged** |
| Unsigned automatic desktop update trust | **Open accepted risk, unchanged** |

The Marlin settle-marker change is valuable but does not fix checkpoint lifetime: `useJobCheckpoint` still deletes the record when the streamer reaches `done`, before the new driver-specific settle and fresh-Idle wait execute.

### New or newly clarified findings

#### R2-P2-01 — Laser machine-limit feed warning loses the limiting axis and effective job speed

`src/ui/laser/laser-machine-limit-warnings.ts:52-68` compares base layer speed with one `ControllerSettingsSnapshot.maxFeed` value. That value is deliberately the **greater** of GRBL `$110` and `$111` (`src/core/controllers/grbl/parse-settings.ts:124-127`).

On an asymmetric machine with X=5,000 mm/min and Y=1,000 mm/min, a 3,000 mm/min Y-heavy layer receives no warning even though the controller clamps it. The detector also ignores:

- per-object `operationOverride.speed`;
- enabled sub-layer speeds;
- the current output/selection scope;
- whether an `output: true` layer is referenced by any emitted object.

This is an advisory/ETA-trust defect rather than a direct over-speed hazard because firmware clamps motion. Preserve per-axis rates and inspect the effective prepared machine job, or use a conservative slow-axis advisory with precise wording. Add asymmetric-axis, object-override, sub-layer, unused-layer, and selected-output-scope tests.

#### R2-P2-02 — Raster barrel cleanup worsened a declared hard-cap violation

`src/core/raster/index.ts` grew from 22 to 32 public exports. The repository describes 20 as a hard cap, but `check:index-exports` remains report-only and is still absent from `release:check`.

The current report shows 15 barrels over the hard cap and 10 more over the soft cap. Largest surfaces remain `scene` 158, GRBL 102, camera 88, job 85, and devices 76. Routing imports through a barrel is not architectural cleanup when it expands an already prohibited public surface without a decomposition plan.

#### R2-P2-03 — Soft-line reporting is visibility, not enforcement

The new `check:soft-size` command is correctly described as report-only and now appears at the end of `release:check`. It reports 78 production files above 250 counted lines, including two files at 400. Because it always exits zero and runs only after all blocking steps, it cannot produce its CI summary while an earlier step—currently Prettier—fails.

This is useful measurement, not closure of the file-size debt. The audit does not classify the non-blocking design itself as a defect; the issue is any claim that the soft tier is now enforced.

#### R2-P2-04 — ADR/index governance drift increased

`DECISIONS.md` now contains 95 ADR headings through ADR-131, while its index still lists 20 entries and stops at ADR-024. It continues to omit later superseding decisions and therefore can present stale posture as current. Generate the index from structured ADR status metadata.

#### R2-P3-01 — Shortcut reference is still not completely synchronized

The dialog now lists the new primary `Ctrl+U` Ungroup binding, but the shipped `Ctrl+Shift+G` alias remains in `src/ui/app/shortcuts.ts:211-223` and is absent from `src/ui/common/shortcut-list.ts:47-60`. The new completeness test explicitly acknowledges the alias but does not assert it is documented.

### PWA status after the interval

Electron PWA registration is **fixed**: `PwaUpdatePromptGate` prevents the service-worker hook from mounting on the desktop shell.

The web recovery issue remains **open**. `PwaUpdatePrompt` still gates Reload through `isActiveJob`, which excludes `disconnected`. A cable loss during a job can therefore expose Reload while disconnect warnings, buffered-motion uncertainty, and recovery context remain unresolved.

### Live browser re-verification

The latest build identified itself as `v0.1.864 - 71683218`. No browser console errors or warnings were observed during the smoke pass.

The earlier layout/accessibility findings reproduced unchanged:

- At 1024×768 in CNC mode, the 3D, Layers, and Router rails extended to x=1051 while the body client width was 993 and horizontal scrolling was unavailable; Router controls remained clipped.
- The Design Library dialog still had no `aria-modal`; focus stayed on the opener, and Escape did not close it.
- With the File menu open, ArrowDown left focus on the `SUMMARY` element labelled File instead of moving into the first `menuitem`.

The viewport override was reset, the audit tab was closed, and the temporary development server was stopped after verification.

### Current validation record

| Check | Latest result |
|---|---|
| Worktree identity and cleanliness | Pass — clean `71683218`, matching remote branch |
| Repository guard | Pass |
| TypeScript | Pass |
| Main ESLint | Pass |
| Electron ESLint | Pass |
| Prettier | **Fail — same 14 files as the previous snapshot** |
| `git diff --check` | **Fail — hundreds of whitespace diagnostics, primarily documentation additions** |
| Full Vitest suite | Pass — exit 0; warning-heavy stderr remains |
| Focused safety lane | Pass — 16 files, 88 tests |
| Focused UI lane | Pass — 11 files, 70 tests |
| Focused architecture lane | Pass — 14 files, 59 tests |
| Web production build | Pass — 972 modules transformed |
| Electron main-process build | Pass |
| Dependency licenses | Pass — 33 production packages across 7 allowed licenses |
| Dependency vulnerability audit | Pass — no known vulnerabilities at low threshold |
| Raw file-size backstop | Pass — 600-line maximum |
| Soft line-size report | 78 files above 250; report-only |
| Barrel export report | 15 hard-cap and 10 soft-cap violations; report-only |

The official `pnpm release:check` remains red because it stops at `format:check`. The independently completed tests and builds prove those later components pass; they do not make the composite release gate green.

### Re-audit conclusion

The interval improves Electron hardening, firmware capability accuracy, geometry error handling, and documentation visibility. It does not change the release decision. The branch should not be merged until the prior P1 machine-truth/lifecycle defects and the formatting gate are resolved. The detailed evidence and remediation order below remain authoritative unless superseded by this re-audit section.

## Original deep-audit verdict — snapshot `1e9a7d02`

**Audited snapshot:** `1e9a7d02f7de1984598088862edce4aaeecdff1e` from `claude/multi-sector-audit-3447b9`, reviewed in a clean detached worktree.

**Baseline:** `main` at `40bd8194`; the candidate snapshot is 65 commits ahead and contains 163 changed files, about 9,197 insertions, and 587 deletions.

**Direct answer — is this good code?** The repository has a strong foundation and many of Claude's individual fixes are good, narrow, and test-backed. The candidate as a whole is **not merge-ready**. There are no confirmed P0 defects, but this repeat sweep found multiple P1 lifecycle and machine-truth defects in tool change, recovery, no-go-zone scanning, camera alignment, rotary parity, Ruida export, and desktop update trust. The official release gate also fails on formatting.

The most important conclusion is not “the tests fail.” They do not: the complete suite passes. The problem is that several current tests assert incomplete or unsafe semantics, and the highest-risk cross-consumer contracts are not covered.

## Scope and method

This was a fresh audit of the implementation, not a reread of the earlier audit conclusions. The sweep covered:

- controller drivers, streaming, alarms, pause/resume, tool changes, and disconnects;
- CNC compilation, plunge/re-entry behavior, probing, work zero, and no-go zones;
- G-code, tiled output, Ruida `.rd`, rotary output, framing, placement, and ETA parity;
- camera calibration, alignment, live/still overlay, board capture, and trace;
- workspace layout, button placement, command menus, keyboard behavior, dialogs, layers, materials, preview, and discoverability;
- persistence, autosave, crash checkpoints, PWA update behavior, state ownership, and transcript identity;
- architecture boundaries, barrel APIs, performance subscriptions, Electron security/update behavior, docs, ADRs, CI, and release gates.

The review used static tracing, focused tests, the complete test suite, production builds, repository gates, and live browser inspection at desktop breakpoints. It did not connect physical laser/CNC hardware, validate a real camera calibration, or install a packaged Windows build.

## Release and validation record

| Check | Result |
|---|---|
| Repository identity guard | Pass |
| TypeScript | Pass |
| Main ESLint | Pass |
| Electron ESLint | Pass |
| Prettier | **Fail — 14 files** |
| `git diff --check` | **Fail — trailing whitespace in `DECISIONS.md`** |
| Full Vitest suite | Pass — 679 files, 4,243 tests; 12 files/17 tests skipped |
| Web production build | Pass |
| Electron main-process build | Pass |
| Dependency license gate | Pass — 33 production packages, all allowed |
| Dependency vulnerability audit | Pass — no known vulnerabilities at low threshold |
| File-size backstop | Pass — maximum 600 physical lines |
| Barrel export reporter | Runs, but is report-only and outside `release:check` |
| Live browser smoke | Pass for launch; layout/accessibility defects reproduced |

The full suite emits several non-fatal warnings: React `act(...)` warnings, jsdom's unimplemented `window.alert`/canvas APIs, and expected WebGL fallback errors. They do not fail the suite, but the noise makes a new warning easier to miss.

The release command is red because `format:check` fails on:

`src/core/camera/index.ts`, `src/core/controllers/grbl/resume-program.test.ts`, `src/core/controllers/relative-jog-commands.ts`, `src/core/invariants/non-finite-coords.ts`, `src/core/job/planner.ts`, `src/core/preflight/no-go-zones.test.ts`, `src/io/dxf/dxf-entities.ts`, `src/io/rd/emit-rd.test.ts`, `src/ui/app/save-rd-action.test.ts`, `src/ui/laser/board-capture/BoardCaptureSteps.tsx`, `src/ui/state/laser-job-actions.ts`, `src/ui/state/laser-store-tool-change.test.ts`, `src/ui/state/setup-blocking-gate.test.ts`, and `src/ui/workspace/RegistrationJigOutlineControls.tsx`.

## P1 findings — must resolve before merge or release

### P1-01 — Tool-change UI unlocks before the controller is physically ready

`step()` changes the streamer to `tool-change` as soon as queue filling encounters a swallowed `M0`, even while retract, spindle-off, and park commands remain in flight (`src/core/controllers/grbl/streamer.ts:203-235`). The setup gate then trusts only `statusReport.state === 'Idle'` (`src/ui/state/laser-store-helpers.ts:51-60`). Start does not invalidate a pre-start Idle report, so that report can be stale.

`continueToolChange()` has no zero-in-flight, fresh-Idle, boundary, or Z-zero guard (`src/ui/state/laser-job-actions.ts:242-265`). The new store test calls Continue immediately, before acks or a fresh status frame (`src/ui/state/laser-store-tool-change.test.ts:72-90`).

**Impact:** jog, probe, Zero Z, or post-change spindle/cut commands can be queued while the controller is still completing pre-boundary motion.

**Required correction:** introduce `tool-change-draining` and `tool-change-ready`. Ready requires all pre-boundary lines acknowledged plus a fresh post-boundary Idle observation. Enforce the same predicate inside the store action, not only in button enablement.

### P1-02 — Tool change does not carry the required bit or prove a new Z touch-off

The CNC emitter writes the next tool name only as a comment (`src/core/output/cnc-grbl-strategy.ts:141-153`). Comments are filtered from the live stream, and the UI falls back to “load the next bit” (`src/ui/laser/JobRunControls.tsx:16-17`). Continue is enabled for every `tool-change` state and does not require a successful post-boundary Zero Z or probe (`JobRunControls.tsx:56-63`).

**Impact:** the operator can install the wrong bit or resume with the previous tool's Z reference.

**Required correction:** make tool-change boundaries structured data containing boundary ID, required tool ID/name, readiness phase, and `zZeroConfirmedAfterBoundary`. Previous Z-zero state must not satisfy a later boundary.

### P1-03 — Fatal controller lifecycle paths omit the new `tool-change` state

The new union member is missing from reboot handling (`src/ui/state/laser-line-handler.ts:188-197`), status-only Alarm cancellation (`laser-status-line.ts:110-117`), rejected-line reset/stop escalation (`laser-error-line.ts:86-114`), and command-shell `machineBusy` (`src/ui/commands/use-app-commands.ts:90-109`).

**Impact:** Alarm/reboot/error can leave Continue visible or skip normal stop escalation. The underlying action guards prevent some writes, but the lifecycle contract is fragmented and not compiler-exhaustive.

**Required correction:** centralize `isActiveJob`, `hasBufferedMotion`, `isMachineBusy`, and fatal transitions in an exhaustive tagged reducer with `assertNever` coverage.

### P1-04 — Recovery checkpoints use the acknowledgement frontier, not the physical-execution frontier

The checkpoint records GRBL acknowledgements while acknowledging that an ack means “parsed,” not “executed” (`src/core/recovery/job-checkpoint.ts:36-46`). `rawResumeLine()` resumes at the first unacknowledged line (`job-checkpoint.ts:110-123`), and storage updates every 25 acks (`src/ui/state/job-checkpoint-storage.ts:14-17`).

**Impact:** after a reset, acknowledged planner blocks that never physically executed are skipped, leaving an uncut or unengraved gap.

**Required correction:** persist a conservative restart frontier, use known physical barriers, or present a previewed overlap restart point for operator confirmation. Tests must model acked separately from executed.

### P1-05 — The checkpoint is deleted before physical completion

`useJobCheckpoint` clears the record when the streamer becomes `done` (`src/ui/app/use-job-checkpoint.ts:40-46`). `done` means all lines were acknowledged. The application separately waits for a dwell and two fresh Idle reports because planner motion can remain (`src/ui/state/laser-post-job-settle.ts:25-79`). The current test explicitly expects the premature deletion.

**Impact:** power, cable, controller, or renderer failure during final planner drain loses the only recovery record.

**Required correction:** clear only after successful stable-Idle settle. Preserve on disconnect, settle timeout, shutdown, and failure.

### P1-06 — No-go-zone scanning skips the initial machine entry move

`findNoGoZoneCollisions()` starts with `current = null`; `appendCollision()` ignores a move when `current` is null (`src/core/preflight/no-go-zones.ts:57-69,94-103`). A leading Z-only retract does not establish XY, so the first actual XY rapid is normally the ignored move.

**Impact:** the head can travel from its real live position through a clamp to the first job point while Start/export preflight passes.

**Required correction:** live Start must pass a trusted initial machine position. When zones exist and an entry segment cannot be proven, block or require an explicit safe-entry contract. Add first-move tests.

### P1-07 — No-go-zone scanning reduces G2/G3 arcs to endpoint chords

The scanner recognizes G0-G3 but parses only X/Y endpoints and passes one straight segment to `segmentIntersectsRect()` (`src/core/preflight/no-go-zones.ts:75-85`). The CNC strategy emits native G2/G3 arcs, so this is reachable product behavior.

**Impact:** an arc whose endpoints/chord avoid a clamp but whose swept curve enters it passes preflight.

**Required correction:** share the true arc geometry already used by arc bed-bounds logic. Cover clockwise, counter-clockwise, full-circle, offset, and non-intersecting-overlap cases.

### P1-08 — Camera alignment is applied in the wrong image basis and at the wrong resolution

Auto-align rectifies the captured image when calibration exists and persists `basis: 'rectified'` (`src/ui/camera/auto-align.ts:34-74`). Live video and “Update still” remain raw (`src/ui/camera/OverlayControls.tsx:24-27`), while `WorkspaceCameraOverlay` applies the saved homography without inspecting `alignment.basis`, calibration, `frameWidth`, or `frameHeight` (`src/ui/camera/WorkspaceCameraOverlay.tsx:18-60`).

Trace now rescales and rectifies correctly (`src/ui/camera/trace-from-camera.ts:49-70`), so CAM-02 is fixed only for trace, not for the surface users rely on to place artwork. The overlay test combines a 1280×720 alignment with a 4×4 still and checks only that some `matrix3d(...)` exists (`WorkspaceCameraOverlay.test.tsx:19-31,95-104`).

**Impact:** calibrated auto-align can visibly mis-register material, especially near distorted lens edges, causing misplaced work.

**Required correction:** rectify the displayed live/still image before applying a rectified-basis homography, or refuse the overlay until a composed distortion transform exists. Scale only for compatible sensor geometry; require recalibration on crop/aspect changes.

### P1-09 — Rotary “machine-space parity” is implemented only in output encoders

`machineSpaceJob()` correctly scales/rebases rotary Y and explicitly says emit, framing, ETA, and placement must all use it (`src/core/job/rotary-job.ts:1-35`). Actual imports exist only in G-code and Ruida emitters.

- Frame computes and sends unscaled `prepared.job` bounds (`src/ui/laser/use-frame-action.ts:42-69`).
- Live ETA estimates unscaled `prepared.job` (`src/ui/laser/live-job-estimate.ts:44-55`).
- Placement/Verified Frame readiness signs unscaled bounds (`src/ui/laser/start-job-readiness.ts:172-182,203-211`).
- G-code applies the rotary transform later (`src/io/gcode/emit-gcode.ts:108-136`).

With the default 60 mm chuck and 360 machine-mm per revolution, the scale is about 1.91. A 100 mm surface-height design frames and estimates 100 mm but emits about 191 mm of Y motion.

**Impact:** “what you frame is what you burn” is false for chuck rotary jobs; ETA, placement, and Verified Frame can certify the wrong physical path.

**Required correction:** produce one prepared machine-space job and use it for every machine-motion consumer. Keep only the canvas rendering surface-true. Add parity tests covering frame bounds, ETA, placement signature, G-code, and `.rd`.

### P1-10 — Ruida `.rd` preflight is weaker than G-code preflight

`emitRdFile()` applies `prepareOutput`, then only `framePreflight` to the outer bounds (`src/io/rd/emit-rd.ts:26-54`). Outer-rectangle edges cannot detect a no-go zone completely inside the job, even if a cut or travel crosses it. The binary path also does not run the same emitted-motion/layer numeric validation as G-code; the encoder writes group speed directly (`src/core/controllers/ruida/rd-encoder.ts:66-76`).

Rotary adds another mismatch: G-code passes `rotaryWrapLimitMm` as a height override, but `.rd` checks transformed bounds against flat `device.bedHeight`. With a 400 mm bed and 360 mm chuck wrap, a roughly 382 mm machine-Y job passes `.rd` while exceeding one revolution.

**Impact:** `.rd` can encode motion through a configured clamp, accept invalid speed/points, or overlap a rotary revolution when the G-code path rejects the same project.

**Required correction:** add a Job-level path preflight shared by text and binary encoders, carry the rotary wrap limit, and maintain a parity rejection corpus.

### P1-11 — Unsigned packaged updates are automatically installed

The updater automatically downloads and installs on quit (`electron/auto-update.ts:37`), while the desktop release workflow deliberately emits unsigned installers when signing secrets are absent (`.github/workflows/release-desktop.yml:79`). HTTPS and the feed hash protect ordinary transport but are not an independent publisher trust anchor if the feed, R2 credentials, workflow, DNS, or TLS authority is compromised.

**Impact:** compromise of the release channel can replace both manifest and binary.

**Required correction:** sign Windows artifacts before enabling automatic installation. Until then, disable auto-install or require a visibly manual, hash-pinned update flow. This is documented risk, but documentation does not close it.

## P2 findings — major correctness, workflow, architecture, and UX debt

### P2-01 — CNC “work zero” advisory tracks general XY origin, not Z zero

`cncWorkZeroAdvisory()` clears when `workOriginActive` is true (`src/ui/laser/cnc-start-advisories.ts:19-25`). Set Origin sends `G92 X0 Y0` and sets that flag, while Zero Z sends `G92 Z0` without setting it (`src/ui/state/laser-origin-actions.ts:69-81`). The warning clears in the wrong case and can remain after the right action. Add session-scoped `workZZeroKnown` with invalidation on reset, reconnect, homing, release, and tool change.

### P2-02 — PWA Reload is offered after an interrupted disconnect

The update prompt gates only `isActiveJob` (`src/ui/app/PwaUpdatePrompt.tsx:27-69`). That helper excludes `disconnected`, while port close deliberately retains a disconnected streamer and safety notice. Reload can therefore erase the exact warning/recovery context the operator needs. Gate with `unsafeToReload`, including interrupted terminal states, unresolved notices/checkpoints, and active controller operations.

### P2-03 — Resume omits the active driver's settings capability

Fresh Start passes `settingsCapability`; `prepareResume()` does not (`src/ui/laser/start-job-flow.ts:111-135`). Marlin/Smoothie can be treated as requiring GRBL `$$`; FluidNC's allowed missing values can become hard failures. Pass the same driver capability snapshot to resume.

### P2-04 — Z-only jog can be blocked by a 2D no-go-zone collision

The jog guard builds an unchanged XY segment even when only `dz` exists (`src/ui/state/laser-jog-actions.ts:127-141`). If the current XY point lies inside a zone, the zero-length segment collides and can block safe retract/touch-off. Skip 2D zone checks when `dx === 0 && dy === 0`.

### P2-05 — System transcript IDs have split ownership

`appendSystemNotice()` uses the last entry's ID + 1 but does not advance `refs.nextTranscriptId` (`src/ui/state/laser-system-notice.ts:13-26`). The next controller/console event can reuse that ID, producing duplicate React keys. Use one allocator/state owner.

### P2-06 — Tiled readiness is fixed, tiled provenance is not

All tiles are now preflighted before any write and controller readiness runs once—good. But tile output still invokes `cncGrblStrategy.emit()` directly (`src/ui/app/save-tiled-gcode.ts:71-93`) and omits build, commit, emitter, assumptions, tile index, and tile count metadata.

### P2-07 — Design Library “Import visible” places later objects off-bed

The dialog passes every visible entry's array index into normal import (`src/ui/library/DesignLibraryDialog.tsx:79-83`). Import first fits the object, then adds `index × 10 mm` to both axes without fitting again (`src/ui/state/scene-mutations.ts:265-284`). With the default catalog, later objects are hundreds of millimetres away. The test checks only object count. Use bounded packing or reject before committing the batch.

### P2-08 — Design Library bypasses the shared accessible dialog

Its raw `role="dialog"` implementation lacks `aria-modal`, initial focus, focus trapping, Escape, and focus restoration (`DesignLibraryDialog.tsx:91-115`), although `src/ui/kit/Dialog.tsx:26-59` already provides them. Live verification showed `aria-modal` was absent, focus stayed on the opener, and Escape did not close the dialog.

### P2-09 — Fixed rails clip safety controls and leave too little canvas

At 1024×768 in CNC mode, live inspection measured the 3D pane, layers rail, and machine rail as fixed siblings extending to x=1051 while the body client width was 993; there was no horizontal scroll. The Router rail was clipped and the canvas was squeezed behind 3D + layers + machine controls. Source confirms fixed widths in `Cnc3DPane.tsx:167-179`, `CutsLayersPanel.tsx:115-122`, and `LaserWindow.tsx:239-256`, mounted together in `App.tsx:54-66`.

The Window menu has no visibility controls, and Frame/Start/Stop remain inside a scrolling machine rail. Add responsive/collapsible rails and a sticky safety-action footer that keeps Stop reachable.

### P2-10 — Verified Frame is a hidden prerequisite

Start can reject a missing/stale Verified Frame (`src/ui/laser/start-job-readiness.ts:190-215`), but no persistent UI shows “Frame verified” or “Re-frame required.” Users learn only after clicking Start. Surface the state beside Frame and Start.

### P2-11 — Undefined `--lf-bg` token breaks intended contrast

Six components use `var(--lf-bg)`, while tokens define only `--lf-bg-0`, `--lf-bg-1`, `--lf-bg-2`, and `--lf-bg-input` (`src/ui/theme/tokens.css:25-28`). This affects safety and selected-state styles, including `SafetyNoticeBanner.tsx:61`, `DesignLibraryDialog.tsx:347`, and `MachineModeToggle.tsx:68`.

### P2-12 — Command/menu construction still subscribes to both whole stores

`use-app-commands.ts:45` calls `useStore()` and `useLaserStore()` without selectors and rebuilds the full command context/registry on periodic status frames. Claude correctly removed unrelated preview/3D recompilation, but this hot subscription remains. Split command families and use narrow shallow selectors.

### P2-13 — Platform and mutable-state contracts contradict the implementation

`CLAUDE.md:96` says UI must not import platform-specific adapters, while `src/ui/app/main.tsx:8` imports both web and Electron adapters and chooses them itself. The Electron adapter is effectively the web adapter with another ID. `PROJECT.md` still promises native menus, though none exist. `laser-store.ts:238` keeps a module-level mutable controller singleton despite the no-module-mutable-state rule.

Either record the actual Chromium-adapter architecture in a superseding ADR or implement injected adapters and a disposable store factory. Enforce whichever boundary is chosen.

### P2-14 — The new barrel checker reports architecture violations but gates nothing

`scripts/check-index-exports.mjs` intentionally exits zero and is absent from `release:check`. It reports 15 barrels over the hard cap and 10 over the soft cap; `core/scene/index.ts` exports 158 symbols, GRBL 102, camera 88, job 85, and devices 76. Useful discovery is not CI enforcement. The `ci:` commit prefix overstates the delivered behavior.

### P2-15 — ADR and coverage governance remain incomplete

The DECISIONS index lists only 20 entries while the file contains 93 ADR headings, and it can present superseded posture as current. `test:coverage` has no thresholds and is outside `release:check`. There is no browser E2E gate, packaged-app launch smoke, or executable coverage of main window/protocol wiring.

## P3 findings — polish and discoverability

### P3-01 — Important features remain buried or inconsistently named

- Ctrl+I remains SVG-only (`src/ui/commands/command-families.ts:34-42`).
- STL relief import remains drag-only (`src/ui/app/use-import-drag-drop.ts:63-92`).
- Design Library is the cryptic `Lib` strip button and lacks a registered command (`ToolStrip.tsx:50-58`).
- Tools is one long menu; Box Fit Test is separated from Box Generator; Text and Offset are hard to discover from the canvas.

### P3-02 — App menu claims ARIA menu semantics without the keyboard contract

`AppMenuBar.tsx` declares `menu/menuitem` but lacks Arrow navigation, focus-on-open, Home/End, and roving tabindex. Live verification showed ArrowDown left focus on the `File` summary rather than moving to the first item. Implement the ARIA pattern or use simpler disclosure semantics.

## What Claude fixed well

The repeat audit should not erase the successful work. These changes are materially good:

- profile-aware menu Connect now uses the selected controller kind and baud;
- File → New preserves the active machine profile;
- finite coordinates and non-finite persisted CNC/machine values are rejected at boundaries;
- tiled export preflights all files before writing and shares controller readiness;
- the planner clamps junction speed to both adjacent blocks;
- CNC through-cut/no-tabs and starter-feed advisories add useful operator context;
- pure-Z CNC resume reconstruction now uses the real plunge feed for current emitted paths;
- camera click mapping respects object-fit letterboxing;
- board-capture provenance prevents the jig panel from silently replacing/unlocking a captured board;
- oversize picker confirmation happens before file reads; malformed DXF coordinates are rejected;
- device-mismatched material recipes warn/confirm instead of silently blocking;
- the Cuts/Layers list remains visible during selection;
- preview and CNC 3D compilation no longer rebuild on every unrelated store update;
- raster luma decode is cached by image identity;
- autosave re-homes a restored slot; Smoothieware comma reports are accepted;
- `.rd` Blob copying and a byte-golden fixture improved binary determinism coverage;
- duplicate/ungroup parity, undo selection preservation, vector failure toasts, grblHAL error retention, and preview error copy are small, well-bounded fixes.

## What is architecturally strong already

Several design choices are worth protecting while fixing the gaps:

1. **Prepared-output spine.** Preview/save/start largely share a single preparation path. The remaining defects are mostly consumers that bypass the last machine-space/preflight stage, not a reason to abandon the spine.
2. **Pure core and explicit controller seams.** The driver interface and pure streamer make deterministic tests possible. The tool-change issue argues for a more exhaustive state model, not more UI conditionals.
3. **Hostile-input validation.** `.lf2`, SVG/DXF, numeric finite checks, raster budgets, and emitted-text invariants show good defensive intent.
4. **Electron hardening.** The custom protocol, CSP, deny-by-default permissions, and private-network camera policy are stronger than a typical Electron wrapper. Signing/update trust is the missing release layer.
5. **Test depth.** 4,243 passing tests, simulator/property/perceptual fixtures, and deterministic snapshots are valuable. The next quality gain comes from contract tests between consumers and real browser/packaged/hardware lanes, not simply more isolated unit count.

## Sector scorecard

| Sector | Current assessment | Main reason |
|---|---|---|
| Controller/streaming | D+ | Tool-change state is non-exhaustive and unlocks before drain |
| CNC workflow | C- | Advisories and resume improved; tool identity/Z proof and work-zero truth remain wrong |
| G-code/preflight | C | Finite/arc-bed checks improved; entry and arc no-go checks remain unsound |
| Ruida/output parity | C- | Determinism improved; path safety and rotary wrap parity are missing |
| Rotary | D | Emitted motion diverges from Frame, ETA, placement, and verification |
| Camera/registration | C | Several workflow fixes landed; displayed alignment basis remains unsafe |
| Persistence/recovery | C- | Autosave improved; checkpoint frontier and lifetime are not physically truthful |
| UI/layout/accessibility | C | Functional density is high; fixed rails, hidden safety state, and dialog/menu contracts hurt use |
| Layers/materials/preview | B | Selection/material/performance changes are solid |
| Architecture/state | B- | Strong core seams; scattered status lists, whole-store subscriptions, and boundary drift remain |
| Electron/security | B- | Good renderer/protocol hardening; unsigned automatic update is open |
| Docs/ADR/CI | C | Many corrections landed; index/enforcement/release hygiene remain incomplete |

**Overall:** C+ foundation, **not merge-ready** candidate.

## Required remediation order

### Stop-ship wave

1. Replace tool-change with draining/ready states, structured tool metadata, fresh Idle, and post-boundary Z proof.
2. Make every fatal lifecycle transition exhaustive for all streamer states.
3. Redesign checkpoint progress around a conservative physical frontier and retain the record through stable Idle.
4. Fix no-go initial-entry and true-arc geometry; add path-level binary parity.
5. Make camera overlay basis/resolution consistent with trace.
6. Share rotary machine-space job across Frame, ETA, placement, verification, G-code, and `.rd`; enforce wrap everywhere.
7. Sign desktop releases before automatic install, or disable automatic installation.
8. Clear Prettier and whitespace failures, then rerun the complete release gate.

### Major correctness/UX wave

1. Separate Z-zero truth from general work origin.
2. Gate PWA reload on unresolved recovery/safety state.
3. Pass driver settings capability through resume.
4. Fix Z-only jog and shared transcript ID allocation.
5. Add tiled provenance and visible Verified Frame state.
6. Replace Design Library bulk offsetting with bounded packing and adopt the shared Dialog.
7. Add responsive/collapsible panels and sticky Start/Stop/Frame controls.
8. Repair theme tokens and narrow command-store subscriptions.

### Governance and polish wave

1. Decide and enforce the real platform/mutable-state contracts.
2. Turn barrel limits into staged enforcement after splitting the largest APIs.
3. Generate the ADR index and add coverage/browser/packaged-app gates.
4. Normalize feature naming and import discovery; implement correct menu keyboard semantics.

## Acceptance tests that are currently missing

- Tool change: stale Idle, nonempty in-flight queue, fresh Idle after final ack, required tool label, post-boundary Zero Z, Alarm/reboot/error in every phase.
- Recovery: acked versus executed frontier; disconnect during final planner drain; settle timeout retains checkpoint.
- No-go: first move from live machine position; G2/G3/full-circle sweeps; motion offsets; Ruida cut and travel crossing an interior zone.
- Rotary: one fixture asserting identical machine-space bounds across Frame, ETA, placement signature, G-code, and `.rd`; wrap rejection parity.
- Camera: raw and rectified basis, same/different resolution, crop/aspect mismatch, edge placement against calibrated fixture images.
- UI: 1024×768 and 1280×720 safety-control reachability; dialog focus/Escape; menu Arrow/Home/End behavior; Design Library batch bounds.
- Desktop: signed installer verification, packaged launch, custom protocol, permissions, update download/install on a staging feed.

## Reusable prompt for the next audit pass

> Run a full, adversarial audit of the latest completed Claude fix snapshot. First pin the exact commit in a clean detached worktree so the review cannot drift while Claude continues working. Re-read the repository rules and the previous master audit, but independently verify every claim against the live implementation.
>
> Audit each sector end to end: information architecture and feature placement; button layout, labels, states, and keyboard behavior; laser and CNC workflows; controller streaming and every lifecycle transition; G-code, Ruida, rotary, Frame/Preview/ETA/Start/Save parity; camera calibration and alignment; imports, trace, layers, materials, persistence, crash recovery, PWA behavior, performance, Electron security, docs, ADRs, CI, and release gates.
>
> For each changed finding, classify it as fixed, partial, regressed, or still open. Do not accept a green unit test as proof when the test encodes the same assumption as the implementation. Trace all safety-relevant states across every consumer, and verify that every surface describing machine motion uses the exact machine-space program that will be emitted.
>
> Use parallel specialist reviewers, then reconcile overlaps into one deduplicated master report. Run the full release gate, focused regression tests, production builds, and live browser checks at realistic desktop sizes. Clearly separate code-proven behavior, browser-observed behavior, and hardware/package behavior that remains unverified.
>
> Lead with findings ordered P0-P3. Include exact file/line evidence, impact, required correction, missing acceptance tests, a direct “is it good code?” verdict, a sector scorecard, a fix-status ledger, what is genuinely strong, and a strict remediation order. Do not modify product code during the audit.

## Snapshot history

The original detailed audit below was pinned to `1e9a7d02`. Claude subsequently advanced through the documentation/shortcut interval described in the original boundary note and then to `71683218`. The re-audit section at the top of this document supersedes that boundary and records the current clean branch state. Future passes should continue to name an exact clean commit and should not treat this untracked audit document as implementation-branch content.
