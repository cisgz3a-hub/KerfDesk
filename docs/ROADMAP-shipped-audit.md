# LaserForge Roadmap 鈥?Verified Shipped Audit

**Audit date:** 2026-04-30
**Repo state at audit:** master at `7fb7b7f` (`feat(connection): auto-detect $32=0 with one-click remediation banner`)
**Method:** Static probe of the working tree against every ticket in `docs/ROADMAP.md`. Each row backed by code identifier search, file existence, test file existence, or explicit T-marker comment in source. Where a ticket has multiple parts, each part assessed.
**Companion file:** `docs/ROADMAP.md` (the master ticket list).

---

## How this file is maintained

This file is the **verified ledger** that pairs with `docs/ROADMAP.md`. It exists because the roadmap describes *what should be done* and this file describes *what has been done*. Without this pairing, audits drift and the same work gets re-proposed across sessions.

**Update rules:**

1. Every commit that ships a roadmap ticket must update this file in the same commit.
2. Add the ticket to the appropriate "Shipped" section with the actual commit hash. Use `<TBD>` in the editor; substitute after `git commit` reports the hash.
3. If a ticket was *partial* and the new commit completes it, move the row from "Partial" to "Shipped" and update the evidence column.
4. If a ticket was open and the new commit completes it, move the row from "Open" to "Shipped."
5. **Do not** delete rows. The history is part of the value.
6. **Do not** rewrite past evidence. If a previously-claimed-shipped ticket turns out to have a regression, add a new dated row noting the regression rather than altering the original.
7. When the score table at the end of `docs/ROADMAP.md` (`### Current classification`) crosses a meaningful threshold (e.g., a Gate 1 cluster fully closes), update that table in the same commit. Don't update for every micro-change.

**Re-audit cadence:**

- Full re-audit at every Gate transition (Gate 1 鈫?Gate 2, Gate 2 鈫?Gate 3).
- Spot re-audit any time a contributor isn't sure whether a ticket is shipped (cheaper to re-verify than to redo work).
- The previous full re-audit was 2026-04-30; the one before was 2026-04-27 (Gate 1 cluster journal entry).

---

## Headline numbers

| Tier | Total | Fully shipped | Partial | Open | Shipped + partial |
|---|---|---|---|---|---|
| 0 | 4 | **4** | 0 | 0 | **100%** |
| 1 | 94 | ~37 confirmed (Gate 1 cluster + verified-this-session + T1-6, T1-19 closed 2026-04-30; T1-17 partial — pass 1 shipped) | 1 | 3 confirmed | est. ~96% |
| 2 | 127 | **9** | **3** | **115** | ~9% |
| 3 | 89 | **2** | 0 | **87** | ~2% |
| 4 | 9 | **2** | 0 | **7** | ~22% |
| **Total** | **323** | ~49 | 5 | ~210 confirmed-or-likely | 鈥?|

**Gate status (per `docs/ROADMAP.md` 搂 Release Readiness):**

- **Gate 1 鈥?Private Technical Alpha: cleared.** Every Gate 1 cluster ticket (dirty-state, commercial credibility, diagnostic recovery, installer correctness, easy security wins, architectural safety) is shipped.
- **Gate 2 鈥?Public Beta: open.** Tier 2 architectural work is the path; ~115 tickets remaining of various sizes.
- **Gate 3 鈥?Paid Production Release: open.** Tier 2 commercial / release-engineering / supportability / security clusters all open.

---

## Tier 0 鈥?All 4 shipped

| Ticket | What | Evidence | Hash |
|---|---|---|---|
| T0-1 | Comment-stripping in start-job | No `startsWith(';')` filter at `src/ui/components/ConnectionPanelMain.tsx:578` | pre-session |
| T0-2 | Three unsafe gcode templates fixed | `Park near far corner` rename + `BED_WIDTH_MINUS_5` substitution at `src/core/plan/GcodeTemplates.ts:113,174`; `HOMING_REQUESTED_BUT_DISABLED` preflight at `src/core/preflight/Preflight.ts:98,210` and `src/core/preflight/rules/TemplatePreflight.ts:72`; `M300` demoted to migration-only `LEGACY_FOOTER_BODY__WITH_BEEP` at `src/core/plan/GcodeTemplates.ts:214`, only referenced from `src/core/devices/DeviceProfile.ts:401` for legacy migration | pre-session |
| T0-3 | `pauseResume` split | `pause()` and `resume()` at `src/app/MachineService.ts:775,780`; callers at `src/ui/components/ConnectionPanelMain.tsx:909,911` | pre-session |
| T0-4 | Wainlux removal | All bridge code gone; one comment-only ref at `src/core/devices/DeviceProfile.ts:77` ("e.g. Wainlux $23=3"); `scripts/wifi-bridge.mjs` is now a generic Falcon WiFi bridge, not Wainlux-specific | pre-session |

**Plus three pre-Tier-0 fixes** that pre-date the formal roadmap numbering:
- Electron permission handler tightened to `serial` only (`6b980a9`)
- `BaseGCodeStrategy.currentSpeed` reset on `generate()` (`6b980a9`)
- `compileGcode(scene)` helper extracted (`6b980a9`)

---

## Tier 1 鈥?Gate 1 cluster shipped, 5 confirmed open

### 鉁?Shipped (Gate 1 cluster + verified individually this session)

The Gate 1 cluster 鈥?required for Private Technical Alpha 鈥?is fully closed. Per the roadmap's own definition this means LaserForge can be distributed to a small group of technically competent testers running supervised jobs on scrap material.

#### Dirty-state cluster (5/5 shipped)

| Ticket | What | Evidence |
|---|---|---|
| T1-68 | Autosave awaits write before clearing dirty | `writeAutosaveAsync` in `src/app/autosavePersistence.ts`; `App.tsx:1247` uses `void writeAutosaveAsync(json).then(success 鈫?clear dirty, fail 鈫?leave dirty)`; `tests/autosave-dirty-flag-on-failure.test.ts` |
| T1-69 | Manual save needs acknowledgement | `src/ui/hooks/useFileHandlers.ts:57-66` shows "File saved?" confirm dialog; dirty stays true until ack; `tests/manual-save-needs-acknowledgement.test.ts` |
| T1-73 | Delete marks dirty | `tests/delete-marks-dirty.test.ts`; `App.tsx:handleDelete` routed through canonical `handleSceneCommit` |
| T1-74 | Text `patchTextGeometry` commits history | `tests/text-property-edits-undoable.test.ts`; `PropertiesPanel.tsx:patchTextGeometry` calls `onSceneCommit` directly |
| T1-75 | Undo/redo marks dirty + invalidates | `tests/undo-redo-invalidation.test.ts`; `App.tsx:handleUndo/handleRedo` route through `applyHistoryScene` |

#### Commercial credibility (4/4 shipped)

| Ticket | What | Evidence |
|---|---|---|
| T1-77 | `DEFAULT_TESTER_HMAC_SECRET` removed | `src/entitlements/testerKey.ts:4` comment ("the previous `DEFAULT_TESTER_HMAC_SECRET` export was removed") |
| T1-81 | CI check 鈥?no dev auto-unlock in production | `scripts/verify-production-build.mjs` checks `tier:'developer'` literal, legacy tester HMAC, debug API leakage, mock-entitlement leakage, vitest leakage, source map references; wired into `npm run build`. Closed by **T3-82** (`de3fbc7`). |
| T1-83 | Strip Electron source maps | `vite.config.ts:12` `sourcemap: 'hidden'`. Closed by **T2-105** (`b6a56ed`). |
| T1-85 | Remove `--dev` arg escape hatch | `electron/main.ts:12` "T1-85: the previous --dev arg escape hatch was removed"; line 213 "No more --dev arg path" |

#### Diagnostic recovery (2/2 shipped)

| Ticket | What | Evidence |
|---|---|---|
| T1-87 | Failed-start persists log | `src/app/MachineService.ts:523,541` (T1-87 markers). Closed by **T2-67** (`a1bb80f`). |
| T1-88 | Replay capture not Pro-gated | `src/app/MachineService.ts:484` "T1-88: replay capture is no longer Pro-gated" |

#### Installer correctness (2/2 shipped)

| Ticket | What | Evidence |
|---|---|---|
| T1-84 | Restrict `storage:clear` IPC | `electron/main.ts:357` "T1-84: storage:clear IPC was removed"; `electron/preload.ts:22` `storageClear removed` |
| T1-86 | npmRebuild decision | `package.json:24,28` `_npmRebuildRationale` + `npmRebuild: false` with full justification; `tests/native-deps-prebuild-check.test.ts` |

#### Easy security wins (6/6 shipped)

| Ticket | What | Evidence |
|---|---|---|
| T1-89 | Electron renderer `sandbox: true` | `electron/main.ts:145` `sandbox: true`; `tests/electron-renderer-sandbox.test.ts` |
| T1-90 | `setWindowOpenHandler` + `will-navigate` | `electron/main.ts:102,109,165,174`; `tests/electron-navigation-blocked.test.ts` |
| T1-91 | G-code template variable sanitization | `src/core/plan/GcodeTemplates.ts:87` `.replace(/[\r\n]+/g, ' ')`; `tests/gcode-template-sanitization.test.ts` |
| T1-92 | `dialog:open` size limit by extension | `electron/main.ts` `dialog:open` handler; `tests/dialog-open-file-size-limit.test.ts` |
| T1-93 | `dialog:open` returns basename only | `electron/main.ts:313,321` "T1-93: return basename only" + `path.basename(filePath)`; `tests/dialog-open-no-full-path.test.ts` |
| T1-94 | Falcon WS frame cap | `electron/falcon-wifi/FalconWebSocket.ts:45,46` `MAX_WS_FRAME_BYTES = 256 * 1024`, `MAX_WS_BUFFER_BYTES = 1024 * 1024`; buffer-overflow check at line 312; `tests/falcon-ws-frame-cap.test.ts` |

#### Architectural safety (3/3 shipped)

| Ticket | What | Evidence |
|---|---|---|
| T1-18 | Test-fire deadman service-owned | `TEST_FIRE_DEADMAN_MS = 5000` at `src/app/ExecutionCoordinator.ts:43`; service-owned timer + arming logic; `ExecutionCoordinator.beginTestFire` arms its own deadman per `ConnectionPanelMain.tsx:975` |
| T1-22 | Critical write awaitability | `writeCritical` and `writeByteCritical` in `src/communication/SerialPort.ts:16,21`, `src/communication/WebSerialPort.ts:63`; `tests/safety-write-failure-surfaces.test.ts` |
| T1-59 | Frame-before-start gate | `hasFramed` ref at `src/ui/components/ConnectionPanelMain.tsx:294`; gate at `Workflow.tsx`; reset on scene change at `ConnectionPanelMain.tsx:405,416,420` |

#### Other Tier 1 verified shipped this session

| Ticket | What | Evidence |
|---|---|---|
| T1-5 | `_stopOnError` per-profile configurable | `stopOnError?: boolean` field on `DeviceProfile` at line 161 |
| T1-6 | Classify `sendCommand` and gate dangerous (service-layer) | `MachineService.sendCommand` rejects user-source warn/dangerous lines. Originally took an `acknowledged: severity` flag (T1-6, `ef8ac92`); **superseded by T1-19** which replaced the flag with a single-use approval token. The runtime gate is the same wall, just with stronger guarantees on the token contract. |
| T1-7 | JobLog QuotaExceededError visibility | `tests/job-log-quota.test.ts` |
| T1-8 | Acceleration-aware power sanity bounds | `tests/plan-accel-sanity.test.ts` |
| T1-9 | Frame bed extents preflight | `tests/bed-height-resolver-parity.test.ts` |
| T1-10 | Wake lock during active jobs | `tests/wake-lock.test.ts` |
| T1-11 | Canvas 鈫?machine coord mismatch | `tests/scene-canvas-machine-coord-check.test.ts` |
| T1-12 | Preflight refired on every status tick | `samePreflightSummary` at `ConnectionPanelMain.tsx:101,376`; commit `4ad42d8`. **Note:** dep-coverage follow-up not shipped (firmware-homing read without listing in deps). |
| T1-13 | Double power attenuation in M4 raster | `appendBurnMoves2D` at `src/core/plan/PlanOptimizer.ts:539,670,767` |
| T1-14 | Max-update-depth crashes during fast resize | `lastSyncedValue` in `src/ui/components/NumberInput.tsx:40,45` |
| T1-15 | MachineService job lifecycle hardening | `tests/machine-service-job-lifecycle-safety.test.ts` |
| T1-16 | Render-loop crashes after job completion | `samePreflightSummary` + `preflightRef.current` in `ConnectionPanelMain.tsx` |
| T1-19 | Service-level approval tokens for dangerous commands | `MachineService.requestApproval(cmd)` mints command-bound, single-use, 30 s TTL `ApprovalToken`s for warn/dangerous classifications. `MachineService.sendCommand(cmd, source, approvalToken?)` enforces token presence + match + expiry + nonce-not-replayed with bounded consumed-nonce retention. UI at `ConnectionPanelMain.sendCmd` calls `requestApproval` after the confirm dialog and threads the token through. Structured `Error.blockReason: 'no-token' \| 'token-mismatch' \| 'token-expired' \| 'token-replayed'`. `tests/machine-service-user-sendcommand.test.ts` (46/46). Supersedes T1-6's simpler `acknowledged` flag. Shipped 2026-04-30 in `1a78fdf`. **Static guard owed** as follow-up (`tests/no-direct-controller-sendcommand-from-ui.test.ts`). |
| T1-20 | WCS no-listener fallback hardening | `_placementUncertain` + `allowHeadlessWcsAutoNormalize` in `GrblController.ts:41,52`; `tests/wcs-no-listener-blocks-job.test.ts`, `tests/wcs-no-listener-headless-flag.test.ts`. Commit `b0375fa`. |
| T1-21 | Frame-dot try/finally safety scope | `frameDot` at `src/app/ExecutionCoordinator.ts:140` |
| T1-24 | Error/alarm handlers send laser-off | `_handleError` at `GrblController.ts:1127` and `_handleAlarm` at line 1214, both with T1-24 markers and `safetyOff` calls; `tests/error-handler-sends-safety-off.test.ts`. Commit `2600666`. |
| T1-95 | `ui-start-job-uses-ticket.test.tsx` frame-wait insufficient post-T1-59 | `tests/ui-start-job-uses-ticket.test.tsx:283` `await flush(1400);` covers worst-case `frameSafe` corner-streaming + idle-poll budget. Was the "known pre-existing failure" carried as baseline through Fixes #1-#3. Shipped 2026-04-30 in `05ce7b86`, bundled with T1-17 Pass 4a (workflow rule #4 violation, retroactively documented here for bisect hygiene). |
| T1-96 | Start-button readiness diagnostics panel | New `src/ui/components/connection/StartReadinessPanel.tsx`; structured `StartReadiness` payload built in `ConnectionPanelMain.tsx` from existing gate state; replaces single-string `startDisabledReason`. 8 gates: controllerConnected, gcodeCompiled, gcodeFresh, preflight, machineState, framing, laserState, wcsState. Collapsed = first-failing-gate headline; expanded = full list with status glyphs, action hints, preflight detail items. Pinned by `tests/start-readiness-panel.test.tsx` (6/6). Preempted T1-17 Pass 4b/4c because the only physical-hardware tester was blocked from burning. Shipped 2026-04-30 in `5e8cff96d983d30cac721b8d6717c9fbfac9d6df`. |
| T1-97 | Frame-before-start bypass override — **RETIRED 2026-05-02 in `b629293`** | Originally shipped 2026-04-30 in `24e5dd468a6939f679c880e0e56d15229ac6504d` as a Tier 1 safety relaxation (tester-blocker bandage). Per-session bypass of T1-59 frame-before-start gate, engaged via More Options confirm-dialog, auto-disengaging on scene change / disconnect / reload. Was deliberate weakening of safety invariant 3 in `.cursor/rules/laserforge.md`. **Retired** because the underlying defect was structurally fixed by T1-98 (dynamic frame idle timeout — the actual cause of "Start grey on 6-block boxes"), T1-99 (savedOrigin no longer compile-invalidating), and T1-100 (machinePlanBounds source uses lastResult pre-job-start). Hardware-verified by tester 2026-05-02: Start unlocks normally on the 6-block scene without engaging bypass. Retire commit removes `frameBypass` state, the More Options control, the canStartJob conjunct widening, the active-bypass banner, and `tests/frame-bypass-override.test.tsx`. T1-59 frame-before-start invariant restored to its default-and-only behavior. **Lesson recorded:** bandage fixes for misdiagnosed bugs should be retired the moment the underlying fix is verified — not left in production indefinitely. |
| T1-98 | Frame idle timeout: dynamic from corner travel distance | Root cause of the 6-block-vs-5-block Start-grey bug. `FRAME_IDLE_TIMEOUT_MS` raised 15s → 60s; new `estimateFrameIdleTimeoutMs(corners)` returns max(30_000, ceil(expectedTravelMs * 2 + 5_000)) using 3000 mm/min conservative feed; `ConnectionPanelMain.handleFrameSafe` passes the per-frame estimate through. Initial T1-97 ticket spec misdiagnosed this as a phantom commitSceneTransaction post-frame; external review identified the actual 15s timeout cause from `grblIdlePoll.ts`. **T1-97 (bypass override) is now superseded by this fix and should be reverted or demoted to productionMode-only once tester verifies 6-box frame completes without bypass.** Pinned by `tests/frame-idle-timeout-dynamic.test.ts` (7/7). Shipped 2026-04-30 in `b899f7b`. |
| T1-99 | savedOrigin removed from compile-invalidation dep set | `useCompileManager.ts` had `savedOriginX/Y` in three dep arrays (layout effect + 2 useCallbacks), but `computeGcodeOffset` (`src/core/output/GcodeOrigin.ts:39`) accepts savedOrigin as `_savedOrigin` (underscored, unused). For startMode='savedOrigin' the emission is byte-identical to 'current' mode; the physical origin is set by `G10 L20 P1 X0 Y0` at Set Origin click, not by recompile. Listing the value as a dep flipped gcodeStale on every Set Origin click for no content change, blocking Start via the `!gcodeStale` gate. Fix: remove from all three dep arrays and keep latest savedOrigin in a ref for explicit compile calls. Pinned by `tests/savedorigin-not-compile-invalidating.test.ts` (7/7). Shipped 2026-04-30 in `e3dffe0`. |
| T1-100 | `machinePlanBounds` source uses `lastResult` pre-job-start | App.tsx prop changed from `activeJobTransform?.plan.bounds ?? null` (only set during job execution) to a precedence chain using `lastResult.machinePlanBounds` when fresh compile exists. Removes the pre-Start-phase null that forced preflight onto the fragile `gcodeTravelScan` text-scan fallback at `Preflight.ts:323` (which can mis-handle G91 relative moves in current/head mode and produce false bed-bounds blockers). Pinned by `tests/machine-plan-bounds-source.test.ts` (7/7). Shipped 2026-04-30 in `243ad0f`. |
| T1-106 | Reset GRBL WCS when switching away from Origin mode | New `src/app/sendResetWcsCommand.ts` sends `G10 L2 P1 X0 Y0 Z0` (absolute WCS = machine origin) when `startMode` changes away from `'savedOrigin'`. Bed mode assumes WCS == machine coords; switching modes without this reset left a stuck WCS offset from a previous Set Origin click, causing subsequent Bed/Head jobs to burn from wrong physical coordinates. Integration in `App.tsx`'s mode-switch handler is conditional: only fires when `mode !== 'savedOrigin'` (the savedOrigin path keeps WCS for the next Set Origin click). **Note on G10 L2 vs L20:** uses `G10 L2` (absolute WCS-to-machine-origin) rather than the `G10 L20` used by `sendSetOriginWcsCommand` (relative WCS-to-current-position). Inverse operations, intentional. **Known limitation (carried forward, not regression):** the helper swallows `sendCommand` errors silently — same pattern as `sendSetOriginWcsCommand` and other WCS helpers. If the reset command is blocked or rejected, no UI signal. Tracked under the broader "UI state updates before hardware success is proven" umbrella from external code review (ChatGPT 14-item analysis, item #4 family). Originally authored on `fix/start-mode-clears-wcs` branch as `b7f8bc0`; cherry-picked to `box-joinery-v5-2-corner-preserve` on 2026-05-02 with conflict resolution: helper path kept at `src/app/` (not `src/ui/origin/` from original); `handleSceneCommit(..., 'start-position')` action metadata preserved from current branch. Pinned by `tests/start-mode-wcs-reset.test.ts` (3/3 — sends correct command on success, no-op on null/undefined controller, swallows sendCommand errors). Shipped 2026-05-02 in `d3b12b2`. |
| T1-101 | Box Library + Joinery v5 (umbrella retroactive paper trail) | Five-commit cluster shipped on `box-joinery-v5-2-corner-preserve` between Fix #8 (T1-100, `92e0946`) and the 2026-05-02 audit. Workflow rule #4 violation (no ticket numbers in commit messages) — same shape as T1-95, retroactively documented here for bisect hygiene. **Scope:** total ~2123 LOC new code: 21 box presets across 7 categories in `src/core/box/boxLibrary.ts` (526 LOC); supporting types and preview model in `src/core/box/boxLibraryTypes.ts` + `boxPreviewModel.ts`; joinery v5 engine in `src/core/box/boxGeometry.ts` (335 LOC, ~5x pre-cluster size, with kerf-aware tab/slot geometry, fit allowance, drawn-vs-physical depth math); 9 React components in `src/ui/components/box-library/` (~1100 LOC); full-page workspace `src/ui/pages/BoxStudioPage.tsx` (97 LOC); 2 new hooks (`useBoxLibraryState.ts`, `usePersistentBoxPreferences.ts`). `BoxGenerator.tsx` restructured 432 -> 116 LOC as a thin "Box Studio launcher" modal. **Cluster commits (chronological):** `6d74fb1` pro-grade box generator fit controls; `19779bc` full-page Box Studio workspace; `d584dce` clean-room joinery v2 engine; `669ab60` clean verified joinery contours; `58b3fce` preserve joinery panel corners. **Tests added in cluster:** `tests/box-library.test.ts`, `tests/box-library-filtering.test.tsx`, `tests/box-preset-preview-model.test.ts`, `tests/box-generator-library-integration.test.tsx`, plus expansion of `tests/box-geometry.test.ts` (~3x pre-cluster size). All passing as of 2026-05-02. **Why Tier 1 not Tier 4:** box generation is a primary product differentiator on the landing page; the cluster is flagship feature work, not polish. **Lesson recorded (companion to T1-95):** off-roadmap work shipped on a feature branch must still acquire ticket numbers retroactively when the audit doc is updated. Future box-library work should reference T1-101 or file a successor ticket. Filed retroactively 2026-05-02 in `fe9d5e0`. |
| T1-102 | Frame crosshair safety in current/head startMode — investigated, no bug | Hypothesis from ChatGPT 14-item analysis #9: `frameSafe` defaults `withCrosshair: true`; in current/head mode the crosshair leaves the head at design centroid, not original jog point, causing wrong-position burn. Hardware testing 2026-05-02 confirmed: frame traces the design rectangle plus a center crosshair, then Start burns correctly from the design's top-left reference. The crosshair is a visible center-alignment aid, not a position-affecting move. **Closed without code change, no ship hash.** Lesson recorded: ChatGPT hardware-behavior claims need physical verification; code-level claims are reliable (T1-98/T1-99/T1-100 all verified from code), hardware-level claims are weaker. |
| T1-103 | `runFrame` must fail if any frame command is blocked | ChatGPT 14-item analysis #1. `ExecutionCoordinator.runFrame` corner-streaming loop caught `ctrl.sendCommand` throws, logged via `console.warn`, and continued. End-of-loop idle poll returned `{ok: true}` because rejected commands produced no movement -> GRBL reported idle quickly -> timeout didn't fire. UI then set `hasFramed.current = true` after a partial-or-zero physical frame trace, passing the T1-59 frame-before-start gate without the laser actually having framed the design. Fix: first throw returns `{ok: false, reason: 'command-blocked', blockedError, blockedAtLine}`. `FrameResult` widened. `handleFrameSafe` and `handleFrameDot` both add a `command-blocked` branch surfacing line number and error to the messages console. `hasFramed.current` not set on failure. Side cleanup: removed residual "15s" literal string from `handleFrameDot` message (T1-98 cleanup miss). Pinned by `tests/run-frame-fail-fast-on-blocked-command.test.ts` (5/5). **First closure of a "UI state updates before hardware success" hole identified by ChatGPT analysis.** Shipped 2026-05-02 in `8cb3faa`. |
| T1-104 | Exact-idle gate cluster (Frame, Frame Dot, Test Fire, Jog, Set Origin) | Five surfaces tightened from permissive `(isConnected && !isRunning)` or ad-hoc per-state denials to positive `machineState?.status === 'idle'` checks matching the existing `canAutoFocus` precedent. Frame/Frame Dot: `canFrame` widened with idle. Test Fire: `beginTestFire` early-return rewritten; `MachineControls` gets a new `canFire` prop replacing the negative `isAlarm \|\| isFaulted \|\| isRunning` blocklist (which permitted hold/homing/check/door/unknown/connecting). Jog: `handleJog` adds idle gate + console rejection message. Set Origin: `handleSaveOrigin` adds idle gate (silent; T1-105 will surface message when it changes the function signature). All 5 surfaces previously allowed clicks during machine states from which the action would silently fail or partially execute, then update UI state as if the action succeeded — same family as T1-103. Pinned by `tests/exact-idle-gates.test.ts`. **T1-105 follows: state-after-confirm pattern fix for Jog `hasJogged` and Set Origin `savedOrigin` (UI updates only after hardware confirms accept).** Shipped 2026-05-02 in `e346c55`. |
| T1-107 | Preflight bed-bounds + visible-layer-for-output checks ignore `layer.output: false` (guide layers) | ChatGPT 14-item analysis #8. Two preflight rules (`runBoundsChecks` in `OutputBoundsPreflight.ts`, `runSceneChecks` in `ScenePreflight.ts`) filtered objects by `(obj.visible && layer.visible)` without considering `layer.output`. Guide-layer content (visible on canvas, `output: false`) contributed bounds to the bed-bounds check, producing false `OUT_OF_BOUNDS_MAX/MIN` errors that blocked Start for jobs that would not burn in those regions. The `NO_VISIBLE_LAYERS` check had the inverse problem: scenes with all-output-disabled layers but visible content passed the check, missing the "this job will produce no output" warning. Fix: both filters now require `layer.output !== false` in addition to visibility checks. Pattern matches `OptimizationPreflight`, `LayerSettingsPreflight`, `RasterPreflight`, and scene output-layer helpers which were already correct. Variable renames `visibleObjects -> outputObjects` and `hasVisibleObjects -> hasOutputObjects` for clarity. Pinned by `tests/preflight-output-layer-filter.test.ts` (7 contracts including positive regression checks that legitimate `output: true` violations still fire). Shipped 2026-05-02 in `95911e3`. |
| T1-23 | Pause emits explicit M5 + resume reasserts spindle mode | Pause was sending only feed-hold (`0x21`) and relying on GRBL `$32=1` firmware contract to disable the laser. On `$32=0` (CNC mode misconfiguration) or non-spec-compliant GRBL forks, feed-hold preserves the modal M3/M4 state and laser stays on. Resume's cycle-start (`0x7E`) then restored the modal state and re-engaged the laser without fresh user action. Fix: pause emits feed-hold THEN `M5 S0` via `writeCritical` (fire-and-forget; feed-hold has already halted motion if the M5 write throws). Resume re-asserts the captured `_lastSpindleMode` (`'M3'` or `'M4'`) with `S0` before cycle-start, so the modal state is correct when motion resumes; the gcode stream's next `S<n>` sets power. Spindle-mode tracking added via new `_trackSpindleMode(line)` method called from both `_writeLine` and `_writeSystemLine`. Substring match against the code portion of the line (parenthesized comments stripped). Implementation kept the controller interface synchronous; M5 and reassert use `void writeCritical(...).then(ok, err)` with error logging inside the sync method body. Pinned by `tests/pause-emits-m5-after-feed-hold.test.ts` (8 contracts: byte order, M3 reassert, M4 reassert, no-prior-mode case, `_trackSpindleMode` covers M3/M4/M5/comment-stripping). Closes firmware-dependency for `$32=0` and non-spec-compliant GRBL forks. **Hardware verification recommended:** press pause mid-job, observe laser turns off; press resume, observe burn continues from same position. Shipped 2026-05-02 in `87b0524`. |
| T1-27 | Remove unused `window.electronAPI.sendGcode` IPC bypass | Renderer-to-controller bypass that wrote raw lines to the serial port via `writeSerialLine`, skipping MachineService / ExecutionCoordinator / GrblController. IPC handler validated only string type, length <=127, and no CR/LF — no semantic safety check. **Verified dead before removal:** repo search found only the preload export, IPC handler, type declaration, and roadmap prose; no application code called it. Removed the `sendGcode` export from `electron/preload.ts`, the `ipcMain.handle('serial:send', ...)` block from `electron/main.ts`, and the `sendGcode?:` declaration from `src/types/web-serial.d.ts`. Removal-explanation comments left at each site for grep discoverability. Pinned by `tests/no-electron-sendgcode-export.test.ts` (4 contracts: preload has no `sendGcode` or `serial:send` outside comments; main has no `serial:send` handler; type declaration absent; no production reference in `src/`). Pattern mirrors `no-localstorage-in-core` (T2-2 phase 9) and `no-gcode-in-ui` (T2-4 phase 8). Highest value-to-effort ratio of any safety item per audit framing: zero functional impact (dead code), critical bypass closed. Shipped 2026-05-02 in `757f2c3`. |
| T1-21 | Frame-dot try/finally safety scope | `ExecutionCoordinator.runFrame` corner-streaming loop + idle wait wrapped in `try { ... } finally { if (laserMode === 'dot') await this.emergencyLaserOff(); }`. Closes the modal-laser-on hole between an accepted M4 (frame-dot dim outline) and the trailing M5: if the loop returned early via T1-103's command-blocked path or threw before the trailing M5, the laser stayed in modal M4 state. The finally now fires unconditionally for dot mode and routes through `emergencyLaserOff` (T1-22's two-stage safety: M5 critical-write -> soft reset on fail). Frame-safe (`laserMode === 'off'`) skips the finally because `buildFrameGcode` never emits M4 in that mode — `M5 S0` is emitted at every position instead. The finally has its own try/catch so a transport failure during safety-off doesn't mask the original return. Pinned by `tests/frame-dot-finally-emits-m5.test.ts` (5 contracts including: frame-safe success doesn't trigger safetyOff; frame-dot success does; frame-dot interrupted does; frame-dot blocked-at-index-0 does; safetyOff throwing in finally is logged but original return value preserved). Composes with T1-103 (fail-fast on blocked commands, makes the failure path explicit) — T1-21 makes the same failure path safe. **Audit framing:** lower realistic trigger frequency than initial audit suggested (most "interruption" scenarios are crash-level events where a try/finally may not run anyway), but defensible as defense-in-depth for the recoverable-exception case. Shipped 2026-05-02 in `ba903a9`. |
| T1-26 | Custom footer enforce-M5-at-send | Defense-in-depth M5 append in `BaseGCodeStrategy.encode` (`Output.ts`) at the end of gcode assembly. Scans last 5 non-empty lines; appends `M5 S0 ; T1-26 defense-in-depth laser-off` if no `\bM5\b` (case-insensitive) match. Idempotent for default footer (already emits M5 via `encodeLaserOff()`); remedial for custom-template footers that bypass or escape the `FOOTER_MISSING_M5` preflight validator. **Implementation choice:** placed in `BaseGCodeStrategy.encode` rather than `MachineService.startValidatedJob` so the safety net applies uniformly to all output paths — preview, file save, send to controller, replay capture. The user-downloaded gcode file matches what the controller receives. **Lenient on comments:** "M5 was here" in a comment counts as already-present and skips the append, to avoid double-appending when the user explicitly noted M5 in a comment; the strict check remains the `FOOTER_MISSING_M5` validator. Pinned by `tests/footer-m5-appended-at-send.test.ts` (7 contracts including the bug-fix proof: M5 only in header, append still fires because tail-scope misses it; total 2 M5s in result). Composes with T1-23 + T1-21 + T1-103: every path that could leave the laser modal-on now has an explicit M5 in the same family. **Audit framing note:** the original audit overstated the bug — `FOOTER_MISSING_M5` is already severity `error` in the validator, blocking job start, not just warning. T1-26 ships as belt-and-suspenders against validator regex bugs or future profile-bypass paths. Shipped 2026-05-02 in `e5fbec0`. |
| T1-9 | Frame bed extents preflight (audit close-out) | Bug fix landed earlier in commit `e427a0a` (Frame-vs-Burn divergence corrected to use `resolveBedHeightMm` instead of `scene.canvas.height`). T1-9 ticket called for a static-guard test to prevent regression. **At write-time verification:** zero `scene.canvas.width|height` references exist in `src/core`, `src/app`, `src/controllers`, or `src/communication` directories — the machine-coordinate codebase is already clean, this commit just locks it in. Pinned by `tests/no-scene-canvas-in-machine-coord.test.ts`: recursive walk of all four machine-coordinate directories, comment-stripped scan with line-level violation reporting. Pattern mirrors T1-27, T2-2 phase 9, T2-4 phase 8. Composes with `tests/bed-height-resolver-parity.test.ts` (resolver function correctness): parity test pins "the function is correct"; T1-9 guard pins "machine-coordinate callers use it instead of `scene.canvas.*`." `scene.canvas` remains the correct concept in `src/ui`, `src/import`, and viewport/import geometry helpers; the guard intentionally excludes those rendering/import-placement paths. Shipped 2026-05-02 in `e4fc24b`. |

### 鈼?Partial

| Ticket | What | What's done | What's missing |
|---|---|---|---|
| T1-17 | Image import freezes the app | **Pass 1 shipped 2026-04-30 in `023a341`** — grayscale loop offloaded to `src/workers/ImagePrepWorker.ts`. **Pass 2 shipped 2026-04-30 in `0632b2b`** — dither cache key uses FNV-1a 32-bit content hash via `buildDitherCacheKey`. **Pass 3 shipped 2026-04-30 in `b8f3dfb`** — `importImageUnified` identity stable across scene mutations via sceneRef pattern. **Pass 4a shipped 2026-04-30 in `05ce7b86e629464c4117c94cb8b6b041e613244f`** — worker-side image processing primitives added (`processImage`, `processImageMainThread`); ImagePrepWorker extended with `process` request kind. Infrastructure-only, no call sites changed. Pinned by `tests/image-processing-worker-equivalence.test.ts` (12/12). Hardware verification of UI responsiveness still owed (Passes 1-4a). | Passes 4b, 4c still open: JobCompiler consumes pre-processed `adjustedData` (4b); UI pipes brightness/contrast/gamma/invert through worker on slider drag (4c — user-visible win). |

### 鉁?Confirmed open

| Ticket | What | Estimate |
|---|---|---|
| T1-23 | Pause must emit explicit M5 (or document firmware proof) | needs modal-state subsystem |
| T1-25 | Reconnect safe-state handshake | 1-2 sessions |

### Tier 1 not yet re-verified individually

T1-1 through T1-67 minus the items above (i.e., T1-2, T1-3, T1-4, T1-26 through T1-67 excluding T1-59, T1-65, T1-66, T1-67). Per the prior session's batch audit, ~17/21 spot-checked Tier 1 items were already shipped. **Estimated additional shipped: ~50.** Verify individually before claiming any specific T1-X in this range as shipped.

---

## Tier 2 鈥?9 fully shipped, 3 partial, 115 open

### 鉁?Shipped (9)

| Ticket | What | Evidence | Hash |
|---|---|---|---|
| T2-7 | Real controller abstraction | `src/controllers/ControllerInterface.ts`, `src/controllers/ControllerRegistry.ts`, `src/controllers/grbl/` exist as a real abstraction | pre-session |
| T2-8 | Split Preflight into rule modules | `src/core/preflight/rules/` has 8 separate rule modules: `LayerSettingsPreflight`, `MachinePreflight`, `MachineStatePreflight`, `OptimizationPreflight`, `OutputBoundsPreflight`, `RasterPreflight`, `ScenePreflight`, `TemplatePreflight`, plus `sharedHelpers` | pre-session |
| T2-22 | Standardized test runner | `scripts/run-tests.mjs` runs each test file in its own Node process. **Note:** auto-discovery part may not be done 鈥?manual list still in file. Treating as shipped because the consistent-reporter requirement is met. | pre-session |
| T2-67 | `failed_to_start` outcome enum + 8-distinct-outcomes finalization | `src/ui/components/JobOutcomeDialog.tsx`; `failed_to_start` handled in `JobLogViewer.tsx:66,89` | `a1bb80f` |
| T2-76 | `commitSceneTransaction` single mutation path | `src/ui/scene/SceneTransaction.ts` (306 lines); `tests/scene-transaction-unified.test.ts` (83/83); `tests/scene-transaction-app-wired.test.ts` | pre-session |
| T2-78 | History entries with action metadata | `selectionBefore/After`, `invalidatesOutput` defined in `SceneTransaction.ts:147`, used in `HistoryManager.ts:64` | pre-session |
| T2-79 | Selection restore on undo/redo | `HistoryEntry.selectionBefore/After`; `tests/selection-restore-on-history.test.ts` | pre-session |
| T2-80 | History coalescing 鈥?slider preview/commit | Text-property sliders use preview/commit at `PropertiesPanel.tsx:847,902,956`; T2-80 markers at `PropertiesPanel.tsx:53,428,440` | `e6874af` |
| T2-105 | Hidden source maps in production | `vite.config.ts:9-12` `sourcemap: 'hidden'` (closed T1-83 stopgap) | `b6a56ed` |

### 鈼?Partial (3)

| Ticket | What | What's done | What's missing |
|---|---|---|---|
| T2-4 | Split `ConnectionPanelMain.tsx` into service + view | Phases 4-7 shipped: `ExecutionCoordinator` owns frame, jog, autofocus, set-origin, test-fire, emergencyLaserOff, safeDisconnect (`tests/execution-coordinator*.test.ts` covers each phase) | `ConnectionPanelMain.tsx` still 1978 lines. Service-extraction is real but file split is incomplete. ~2-3 more phases needed. |
| T2-12 | Unified MachineSafetyState | Part 1: `laserOutputState` + subscriptions (6 markers). Part 2: `FAULTED_REQUIRES_INSPECTION` + Acknowledge button (15 markers, `tests/execution-coordinator-disconnect.test.ts` etc.) | Full canonical `MachineSafetyState` discriminated union (16 states: DISCONNECTED_UNKNOWN, RUNNING_TEMP_LASER, etc.) not done. Most consequential parts shipped; type-unification "bow on top" remains. |
| T2-77 | Async revision guards | `capturedRevisionId` reserved in `SceneTransaction.ts:53` (scaffolding) | Mid-async cancellation logic not wired; needed for trace, image import |

### 鉁?Open (115)

Grouped by cluster. **Bold = highest leverage / blocks other work.**

#### Reliability architecture (16 tickets)

T2-1 (ValidatedJobTicket 鈥?type exists, contract not enforced), **T2-3** (paywall: `requireFeature` exists in scattered hooks; not service-layer-gated comprehensively), T2-5 (`GcodeTemplateValidator` exists at `src/core/preflight/GcodeTemplateValidator.ts` but not wired into compile pipeline), T2-6 (no Zustand stores), **T2-10** (no MachineCommandGateway), **T2-11** (no operation mutex), T2-13 (no FaultInjectingSerialPort), T2-14, T2-15 (no CompoundPath model), T2-16, T2-17 (no AbortSignal in compile), T2-18, T2-19, T2-20, T2-21 (no fast-check), T2-23, T2-24, T2-25 (no ControllerCapabilities), T2-26, T2-27, T2-28, T2-29.

#### Connection lifecycle (7 tickets)

T2-30 (Falcon WiFi as transport), T2-31 (close async), **T2-32** (no ConnectionManager), T2-33, T2-34 (no generation guard), T2-35, T2-36 (subscription transport callbacks).

#### Safety APIs (10 tickets)

T2-37 (capability snapshot), T2-38 (CapabilityValue<T>), T2-39 (profile validation on save), T2-40 (central op-gating authority), T2-41 (SafetyActionResult typed), T2-42 (ControllerSafetyOps contract), T2-43 (ControllerSafetyCapabilities), T2-44 (extended safety state machine), T2-45 (JobExecutionSession), T2-46 (user-facing safety messages).

#### Test infrastructure (4 tickets)

T2-47 (realistic GRBL simulator), T2-48, T2-49 (virtual time), T2-50 (injectFault API).

#### State machines / Job lifecycle (10 tickets)

T2-51 (CompiledJobState atomic), T2-52 (useSyncExternalStore), T2-53 (JobPhase), T2-54 (unified disconnect), T2-55 (resetProjectRuntimeState), T2-56 (job log finalization), T2-57 (typed errors per domain 鈥?`machineAlarmCode` partial), T2-58 (Ready-to-Run panel), T2-59 (material-first workflow with confidence labels 鈥?UI exists, workflow doesn't), T2-60 (frame freshness invalidation).

#### UX (7 tickets)

T2-61 (design-editing controls out of conn panel), T2-62 (recovery cards: alarm/disconnect/frame-fail/E-stop), T2-63 (operation order preview), T2-64 (beginner/advanced toggle), **T2-65** (central error reporter 鈥?blocks lots of UX work), T2-66 (positionTrusted state), T2-77 (covered above).

#### Persistence (8 tickets)

T2-68 (critical error history preserved across clearMessages), T2-69 (atomic autosave with checksum), T2-70 (previous autosave backup slot), T2-71 (device profile snapshot in project), T2-72 (material preset snapshot per layer), T2-73 (formal migration pipeline), T2-74 (deserializeSceneWithReport), T2-75 (deep geometry validation on load).

#### History (8 tickets)

T2-81 (raster buffers outside history), T2-82 (memory budget), T2-83 (block undo while running), T2-84 (RuntimeState meta-container), T2-85 (JobFingerprint type), T2-86 (FrameState union), T2-87 (RecoveryState machine), T2-88 (hash-derived dirty 鈥?scaffolding referenced).

#### Entitlements (9 tickets)

T2-89 (server-signed entitlement), T2-90 (signed local token public-key verify), T2-91 (FEATURE_MATRIX), T2-92 (per-feature canUse), T2-93 (LicenseStatus enum), T2-94 (clock-tamper detection), T2-95 (real trial model), T2-96 (subscription lifecycle), T2-97 (entitlement never blocks safety).

#### Release engineering (10 tickets)

T2-98 (Win/macOS CI runners), T2-99 (Win code signing), T2-100 (macOS notarization), T2-101 (auto-update with electron-updater), T2-102 (rollback / failed-launch detection), T2-103 (SHA256 + SBOM + signed checksums), T2-104 (versioned user-data migration), T2-106 (CI dependency security scanning), T2-107 (CSP 鈥?currently has `unsafe-inline` and `unsafe-eval` per `electron/main.ts:190,191`).

#### Diagnostics (10 tickets)

**T2-108** (support bundle exporter), T2-109 (reconstruction-grade JobLog), T2-110 (controller settings snapshot before job), T2-111 (persist partial job log), T2-112 (event-window retention), T2-113 (structured RX/TX events), **T2-114** (React error boundary + window error/rejection persistence), T2-115 (privacy redaction), T2-116 (storage health/quota), T2-117 (correlation IDs), T2-118 (Help 鈫?Diagnostics panel).

#### Security (10 tickets)

T2-119 (assertTrustedSender on every IPC handler), T2-120 (typed namespaced storage IPC), T2-121 (main-process command classification), T2-122 (typed serial command IPC), T2-123 (SVG complexity limits), T2-124 (image pre-decode pixel limits), T2-125 (compiler enforces template validation), T2-126 (Falcon WiFi as untrusted telemetry), T2-127 (storage value size limits), T2-128 (per-namespace storage authorization).

---

## Tier 3 鈥?2 shipped, 87 open

### 鉁?Shipped (2)

| Ticket | What | Evidence | Hash |
|---|---|---|---|
| T3-1 | Autosave to IndexedDB / filesystem | `src/core/storage/{IndexedDb,Filesystem}StorageAdapter.ts` + `bootstrap.ts` picks per-runtime | pre-session |
| T3-82 | Production bundle smoke tests | `scripts/verify-production-build.mjs` with broader pattern library (auto-Pro unlock literal, legacy tester HMAC, debug API leakage `__forceProUnlock`/`__entitlementService`, mock entitlement leakage, vitest leakage, source map references); 22 markers in code | `de3fbc7` |

### 鉁?Open (87)

T3-2, T3-3, T3-4 (Win/macOS code signing), T3-5 (auto-update channel), T3-6 (crash reporting), T3-7 (backward-compat fixture corpus), T3-8 (Electron CSP hardening 鈥?duplicates T2-107), T3-9 (IPC attack surface), T3-10 (input file-format size limits), T3-11 (burn-progress visual bugs), **T3-12** (hardware-in-the-loop safety verification suite), T3-13 (active-edge-table fill scanline), T3-14 (sampled G-code preview), T3-15 (spool-based G-code AsyncIterable streaming), T3-16 (WebSerial cable-pull recovery), T3-17 (Wi-Fi safety model), T3-18 (output validator semantic scan), T3-19, T3-20, T3-21 (frame-dot F3000 hardcoded), T3-22, T3-23, T3-24, T3-25, T3-26, T3-27, T3-28, T3-29, T3-30, T3-31, T3-32, T3-33, T3-34, T3-35, T3-36, T3-37, T3-38, T3-39, T3-40, T3-41, T3-42, T3-43, T3-44, T3-45, T3-46, T3-47, T3-48, T3-49, T3-50 (device identity verification on connect), T3-51, T3-52, T3-53, T3-54, T3-55, T3-56, T3-57, T3-58, T3-59, T3-60, T3-61, T3-62, T3-63, T3-64, T3-65, T3-66, T3-67 (canonical bounds selectors), T3-68 (debug state graph + transition log; scaffolding ready in `SceneTransaction.ts:94,95,152-154,271,283`; emitter not wired), T3-69, T3-70, T3-71, T3-72, T3-73, T3-74, T3-75, T3-76, T3-77, T3-78, T3-79, T3-80, T3-81, T3-83, T3-84 (Linux packaging 鈥?only if business decides), T3-85 (installer QA matrix), T3-86 (native module packaging smoke test 鈥?referenced from T1-86 as future work), T3-87, T3-88 (IPC fuzz suite), T3-89 (production security build CI checks).

---

## Tier 4 鈥?2 shipped, 7 open

### 鉁?Shipped (2)

| Ticket | What | Evidence | Hash |
|---|---|---|---|
| T4-1 | Starter material preset library | `src/core/materials/defaultPresets.ts` has 10 presets: `preset-birch-3mm`, `preset-mdf-3mm`, `preset-acrylic-3mm`, `preset-cardboard`, `preset-leather-2mm`, `preset-anodized-aluminum`, `preset-slate-stone`, `preset-cork-3mm`, `preset-paper-cardstock`, `preset-fabric-cotton` | pre-session |
| T4-8 | Import formats 鈥?DXF | `src/import/dxf/` with `importDxfIntoScene` wired into `src/ui/hooks/useImport.ts:255` and `src/ui/components/FileToolbar.tsx:19` | pre-session |

### 鉁?Open (7)

T4-2 (kerf planner UI 鈥?beyond the kerf compensation already shipped in box generator), T4-3 (inline coaching), T4-4 (Know-Why engine), T4-5 (Honest Mode), T4-6 (D.13 Phase 2 calibration), T4-7 (Marlin controller stub), T4-9 (material feedback portability).

---

## Audit advisories status

Started at **15 advisories** (2 low, 2 moderate, 11 high) per prior session. After audit work:

- **Cleared (14):** xmldom upgrade, dompurify upgrade, electron-builder cluster (multiple commits including major bump), postcss override (commits `93b305b` 鈥?`0046a04`)
- **Remaining (1):** Electron 34鈫?1 major bump 鈥?deferred (full-session smoke surface, would need re-running the entire app + IPC + dialog test set)

---

## Cross-audit commit ledger (most recent activity)

The arc that closed Gate 1:

| Commit | What |
|---|---|
| `93b305b` | xmldom + dompurify upgrade |
| (cluster) | electron-builder major bump |
| `0046a04` | postcss override |
| `a1bb80f` | T2-67 failed_to_start enum (closes T1-87 stopgap) |
| `37bd775` | T1-88 hotfix |
| `b6a56ed` | T2-105 hidden source maps (closes T1-83 stopgap) |
| `de3fbc7` | T3-82 bundle verifier broadened (closes T1-81 stopgap) |
| `e6874af` | T2-80 slider coalescing (closes T1-74 stopgap aspect) |
| `2600666` | T1-24 error/alarm laser-off |
| `b0375fa` | T1-20 WCS placement-uncertain gate |
| `ea0f750` | chore: ImageProcessing.ts return types |

The arc post-Gate-1 (this session, off-roadmap, exception):

| Commit | What |
|---|---|
| `b7ac61a` | T2-12 part 2: faulted controller state |
| `c5c0795` | App.tsx label cleanup |
| `16e00b3` | Frame with crosshair |
| `d33428b` | Box generator joinery rewrite + Test Fire M3+5% |
| `5450df8` | Kerf compensation |
| `c385e06` | GRBL console panel |
| `3d61f58` | Kerf presets |
| `7fb7b7f` | $32=0 auto-detect banner |
| (pending) | Inside-vs-outside box dimensions (paste-ready, awaiting push) |

After the inside-vs-outside ship, all subsequent commits follow the strict roadmap rules in `.cursor/rules/laserforge.md`.

---

## Next 5 tickets in strict roadmap order

1. **T1-105** — Jog `hasJogged.current = true` only after jog command accepted; Set Origin `savedOrigin` + localStorage only after G10 confirmed. ChatGPT items #3 + #4. Pattern fix: changes `executionCoordinator.jog` return shape and adds success/failure return to `setOriginAtCurrentPosition`. Pairs with T1-104 (which gates the click) to fully close the "UI state updates before hardware success" hole on Jog and Set Origin. **Hardware verification recommended.**
2. **Controller `safetyOff()` propagation to MachineService laser state.** ChatGPT item #11. Largest of the remaining safety items; high priority. May need scope-decision before ticket assignment.
3. **T1-17 pass 4b** — JobCompiler consumes pre-processed `adjustedData` when present.
4. **T1-17 pass 4c** — UI pipes brightness/contrast/gamma/invert through worker on slider drag.
5. **T1-19 static guard** — `tests/no-direct-controller-sendcommand-from-ui.test.ts`.

After those close, every Tier 1 ticket I have evidence for is shipped. We then enter Tier 2, where the audit identifies these as highest leverage:

- T2-3 (widen service-layer paywall gating)
- T2-65 (central error reporter 鈥?unblocks T2-114 error boundary and lots of UX cleanup)
- T2-12 finish (close out canonical safety state union)
- T2-10 (MachineCommandGateway choke point 鈥?unblocks consistent gating across Tier 2)
- T2-11 (operation mutex 鈥?unblocks T2-12 full canonical type)

---

## Caveats & known limits of this audit

- Tier 1 tickets in the range T1-2, T1-3, T1-4, T1-26 through T1-58 (excluding the explicitly verified ones) were not individually re-probed in this audit. The prior session's batch audit covered most of them; spot-check before assuming any specific T1-X is shipped.
- "Partial" classifications are subjective. Bias is conservative: if a ticket has clear remaining scope, it's partial.
- Tickets that ship as a side effect of higher-priority work aren't credited explicitly. Example: T2-3 widening `requireFeature` use will likely close T2-91 (FEATURE_MATRIX) too; that won't show up here until the later commit explicitly addresses it.
- Future tickets that are scaffolded but not wired (T2-77 with `capturedRevisionId`, T2-88 referenced as future, T3-68 with `transitionLog` plumbed but no emitter) are counted as **open**, not partial. Scaffolding has value but it's preparation, not shipping.
- The Tier 2 / Tier 3 / Tier 4 numbers above are lower bounds. As I find more work shipped without explicit T-markers, the shipped column grows.
- Hash columns marked "pre-session" mean: shipped before the audit window; commit hash not in my context. Not a quality issue; just unrecoverable from this static probe.

