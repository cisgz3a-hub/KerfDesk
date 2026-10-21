# Rolling audit v2 — ledger

One row per audited area. Counts are after the refuter and the coordinator's re-verification.
Method: [METHOD.md](METHOD.md). Plan: [AREAS.md](AREAS.md).

| Batch | # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 02 | Licensing | 70c01e11f | [02-licensing.md](02-licensing.md) | 27 | 5 | 0 | 2 | 19 | 1 |
| 1 | 03 | Laser output | 70c01e11f | [03-laser-output.md](03-laser-output.md) | 32 (29 unique) | 1 | 3 | 9 | 16 | 0 |
| 1 | 04 | Electron main process | 70c01e11f | [04-electron-main.md](04-electron-main.md) | 33 (32 unique) | 2 | 0 | 1 | 27 | 2 |

## Confirmed P1/P2 (coordinator-verified)

Coordinator checks were made on `origin/main` @ `faf5a54f1`; no audited line changed between
`70c01e11f` and that commit.

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| 02-P2-1 | licensing | "My artwork" Insert (and an edited `.lfart`) creates V-carve, relief or adaptive work in Free without asking for Pro | **READ**: `personal-artwork-actions.ts:62` calls zustand's public `useStore.setState`, which bypasses the `freeProArtworkSetter` wrapper applied only to the creator's `set` (`store.ts:425-433`). Session + refuter REPRO (`requestPro` 0 calls) | open |
| 02-P2-2 | licensing | "Tapered V-bit pair" inlay runs V-carve passes but is classed as Free; browser Free then fails at Preview with the Pro message | **READ**: `operationProFeature` flags only v-carve/relief/adaptive; `tapered-inlay-operation.ts:41` calls `vcarveMedialPasses`, which `browser-free-build.ts:25` strips. Needs a maintainer tier decision | open |
| 03-P1-1 | laser-output | A crafted `.lf2` layer id or colour injects an executable G-code line (e.g. a full-power `G1`) through unsanitised laser comments; Frame, preflight and Job Review never show it | **REPRO**: own Vitest (serialize → plant `\nG1 X300 Y10 F100 S1000\n` in layer id → `deserializeProject` ok → `emitGcode`) — the line is emitted on its own. Code: `grbl-strategy.ts:284` raw interpolation; CNC twin uses `sanitizeGcodeCommentValue`; validator only `requireString`; streamer sends every non-`;` line | open |
| 03-P1-2 | laser-output | Leads burn ~1.5–2 mm into a kept plate when its outline is open (CAD DXF drawn as `LINE` entities), with no warning | **READ**: `laser-lead-sides.ts:104` skips open polylines; `dxf-entities.ts:56-61` makes each LINE an open 2-point path; no join anywhere in `src/io/dxf`. Session + refuter R4 reproduced the burn | open |
| 03-P1-3 | laser-output | With Remove overlapping lines on, a part's lead burns up to 2 mm into the neighbour that shared its edge | **READ**: `prepare-output.ts` runs `optimizePaths` (overlap removal) before `applyLaserLeads`; split pieces become rings only for tabs/perforation (`laser-lead-rings.ts:87-96`). Session + R4 reproduced | open |
| 03-P2-1 | laser-output | Blank last air-on group releases a held `M8` right after the final lit M3 burn (lit dwell with an air on-delay) | READ `grbl-strategy.ts:490` (comment accepts the plain job-end stop, not the held air change). **SOURCE** grblHAL `coolant_control.c`: `coolant_set_state_synced` → `protocol_buffer_synchronize()`, then `coolant_set_state` dwells `settings.coolant.on_delay` ms on every non-zero state | open |
| 03-P2-2 | laser-output | On Marlin, an air change between operations stops the head with continuous (`M3 I`) power on | READ `marlin-strategy.ts:21`. **SOURCE** Marlin 2.1.2.5: `M3 I` → `CUTTER_MODE_CONTINUOUS` (M3-M5.cpp); empty planner turns the laser off only `if (cutter.cutter_mode == CUTTER_MODE_DYNAMIC)` (stepper.cpp); `M7/M8/M9` start with `planner.synchronize()` | open |
| 03-P2-3 | laser-output | Active rotary rebases Y to 0, discarding the Current Position / User Origin anchor | READ `rotary-transform.ts:32-37` | open |
| 03-P2-4 | laser-output | A small whole-number `$30` (e.g. 1) rounds every power to S0 or full power | READ `grbl-laser-lines.ts:23-24` (`Math.round` on integer maxima) | open |
| 03-P2-5 | laser-output | `$30=0` / `$31 ≥ $30` (stock GRBL fires full PWM even at S0) is described as "not confirmed" / "may burn hotter" | READ `parse-settings.ts:287` (`value > 0`). **SOURCE** gnea/grbl `spindle_control.c`: `if ((settings.rpm_min >= settings.rpm_max) || (rpm >= settings.rpm_max))` → `SPINDLE_PWM_MAX_VALUE`, checked before the S0 branch | open |
| 03-P2-6 | laser-output | 4040 contour entry reported as effective while no entry is emitted when bed bounds are unknown | session + R6 REPRO | open |
| 03-P2-7 | laser-output | Image overscan > 5 mm raises false "long blank feed … regenerate" warnings (raster runways unmarked) | READ `laser-off-motion-policy.ts:72` excuses only marked lines | open |
| 03-P2-8 | laser-output | Motion manifest reads every Smoothieware burn as travel (live view, burn trail, camera check wrong) | READ `motion-manifest-parser.ts:156` arms only on M3/M4/M106 | open |
| 03-P2-9 | laser-output (root cause in 14 vector-importers) | Open DXF `LINE` outlines silently lose kerf compensation and inside-first; no join on import, no Line-layer warning | Same DXF read as 03-P1-2 | open |
| 04-P2-1 | electron-main | Camera bridge's fixed loopback port has no server identity check: a squatter receives RTSP logins; operator told the wrong reason | READ `camera-bridge.ts:11,96` (fixed origin, credentials in query, no token); `camera-bridge-lifecycle.ts:19-21` only logs bind failure | open |
