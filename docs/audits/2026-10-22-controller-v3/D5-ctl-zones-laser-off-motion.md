# Controller audit v3 — D5 No-go zones and laser-off motion (`ctl-zones-laser-off-motion`)

- **When:** 2026-10-22 evening   **Tree:** origin/main @ `7cd526213` (worktree HEAD `b0399cfd9` =
  `7cd526213` plus audit documents only). `origin/main` moved to `8dc125bff` during the audit. No
  scope file changed. Of the other cited files, only `external-program-review.ts`,
  `job-placement.ts`, `start-job-readiness.ts` and `laser-jog-actions.ts` changed, and only in
  message text and a skipped-arc warning. Every finding below still reproduces on the logic of
  `8dc125bff`.
- **Scope:**
  - Core: `src/core/preflight/{no-go-zones,laser-off-motion-policy,relative-motion-envelope,cnc-motion-bounds-preflight}.ts`, with `preflight.ts` and `cnc-preflight.ts` `appendNoGoZoneIssues`.
  - UI: `src/ui/workspace/draw-no-go-zones.ts`, `src/ui/laser/MachineSetupSafetyZones.tsx`.
  - Callers:
    - Start and Save: `start-job-readiness.ts`, `save-gcode-emission.ts`, `job-placement.ts`, `emit-gcode.ts`.
    - Frame: `laser-jog-actions.ts` `runFrame`, `laser-frame-motion-plan.ts`.
    - Jog and point moves: `laser-jog-warnings.ts`, `laser-jog-actions.ts`, `positioning-light-actions.ts`, `head-move-dispatch.ts`, `position-laser-click.ts`, `head-capture-store.ts`, `OriginRow.tsx`, `laser-recovery-move.ts`, remote `machine-execution.ts`/`machine-hold.ts`.
    - External programs: `external-run.ts`, `external-run-bed.ts`, `external-program-review.ts`.
    - Recovery: `laser-recovery-flow.ts`, `start-job-resume-stream.ts`, `ManualLaserRestartDialog.tsx`, `cnc-pass-recovery-flow.ts`, `cnc-supervised-recovery-flow.ts`, `start-job-source.ts`.
    - Laser-off: `findLaserOnTravelIssues` and `findLongBlankFeedMoves`, the drivers' `frameToolOffLines`, `laser-mode-start-acknowledgement.ts`.
- **Governing:**
  - ADR-129, with its 2026-07-15 audit amendment (the scan follows the physical path; Start supplies the head position so the entry move is checked) and its 2026-08-25 amendment (jog warnings are warn-only; a known crossing or an unresolved XY path gets a prominent warning).
  - ADR-231 and ADR-232 (Frame is the spatial source of truth; no-go findings never refuse); ADR-237 (dialog-free Frame, Job Review at Start).
  - ADR-630 and its Amendment 1 item 2 (the external Frame outline is compared with bounds and zones).
  - ADR-500 Amendment 1 §2 (Open installs the document's machine); ADR-373 (beam-off wording residual).
  - Center-origin signed bounds: the DECISIONS.md decision "Signed jog bounds", item 6.
  - WORKFLOW F-A10 check 6; PROJECT.md non-negotiables 1, 3 and 21.
- **Primary sources fetched:**
  - GRBL v1.1 Laser Mode wiki.
  - gnea/grbl `gcode.c` (laser-disable block, jog block, spindle-speed block) and `main.c` (position cleared only at power-up; the homing lock is power-up only).
  - grblHAL core `gcode.c` (`motion_is_lasercut`, only in `Mode_Laser`).
  - FluidNC `GCode.cpp` (laser off for non-feed motion only on a rate-adjusted spindle).
  - Marlin 2.1.2.5 `gcode.cpp` (G0 sets inline power 0, or `apply_power(0)`).
  - LightBurn troubleshooting page "Moves are burned".
  - LightBurn has no no-go zone feature (ADR-129 records this divergence).
- **Lenses run:** L1, L3, L4, L5, L7 as separate passes, with L2 for the laser-off ground truth.
  - L6 folded into L4 (reset and alarm lifecycle).
  - L5: the only untrusted inputs are zones in `.lf2` and machine-profile files, and external programs. The zone validators hold (Verified clean). Open replacing zones is KNOWN (12-P2-1 mechanism).
- **Counts:** 11 raised → 0 refuted → P1 0 / P2 4 / P3 7 (+ 9 KNOWN re-encountered). Refuter: 11
  confirmed, 0 plausible, 0 refuted, 0 known. No severity changes.

## Headline

The zone geometry is sound. Swept segments, swept arcs and inclusive edges are checked, the
cutter radius is added on CNC, inch reports are converted, and every jog entry point warns. The
gaps are in which motion reaches the check, and in one parse.

- **Tool radius (P2-1).** The CNC tool-comment regex reads the last `diameter-mm:` on the line. On
  engraving and tapered ball-nose bits that is `tip-diameter-mm`, so a clamp 1 mm from the cut
  gets no Job Review warning.
- **Laser recovery (P2-4).** Recovery and Start-from-line never scan the resume program. The
  re-entry rapid from where the head now stands is not checked.
- **Project Frame (P2-3).** The Frame perimeter is compared with zones nowhere, while an external
  program's Frame outline and every jog are compared.
- **External programs (P2-2).** On the laser-off side, KerfDesk's own output is dark on every G0
  under `$32=0`, but an opened external program is not checked. On a controller reporting `$32=0`,
  a LightBurn-style file burns every rapid, and the only signal is the generic "settings cannot
  be fully verified" prompt. That prompt points at a Job Review the external path does not have.

## Motion path → check → result

| Motion path | Check it passes through | Result |
|---|---|---|
| Job cuts and travels (laser and CNC Start) | `emitPreparedGcode` → `runPreflight`/`runCncPreflight` → `findNoGoZoneCollisions`, with the trusted bed offset (WCO + native-to-bed) | Job Review advisory; swept G0/G1/G2/G3 |
| Lead-ins/outs, fill and raster overscan runways, park, Focus Test | in the emitted program, same scan | covered |
| CNC safe-Z travel | same scan, XY only, cutter radius from `; cnc tool:` | flagged even at safe Z (message says Z clearance unknown); radius wrong for tip-diameter bits (**P2-1**) |
| Entry move: head → first XY | `initialMachinePosition`, only with a verified native-to-bed frame | covered when the frame is known |
| Unknown native-to-bed frame (grblHAL, unhomed, `$130≠bed`, User/Current/Verified Origin) | `relative-origin` → one "cannot be checked" advisory | advisory; wording P3-4 |
| Save G-code / `.rd` | same scan, no head position; same frame rule (`savePreflightFrameOptions`) | covered after save |
| **Project Frame** (perimeter, approach, return) | none; ADR-232 removed the pre-Frame guard, and Job Review only scans job motion | **P2-3** |
| External program Frame outline | `zonesOverlappingRect` (ADR-630 Amd 1) | Run dialog warning; centreline only on CNC (P3-5); G18/G19 and G28/G30 legs KNOWN |
| External program body | inside its outline, so covered by the outline | ok |
| Jog step / hold / keyboard / phone jog and hold | `runJog` → `warnJogMotionPolicy` → `firstZoneCrossedBySegment` | warn-only toast; the frame is picked from `homingState` (P3-1) |
| Move to position, saved positions, origin row Go, click-to-position, board capture, head-camera capture, recovery move | `jogToMachinePosition` → `warnJogMotionPolicy` | same as jog |
| Positioning-light move | `warnJogMotionPolicy` | same |
| Rotary Test rotation | `jog()` | KNOWN D3-P3 (rotary Y treated as bed Y) |
| **Laser recovery** (saved capsule) | full original program scanned from the live head (`prepareArchivedRecoverySource`); resume program not scanned | **P2-4** |
| **Manual Start from line / restart dialog** | no preflight warnings shown at all | **P2-4** |
| CNC pass / supervised recovery | resume job emitted and scanned; no head position; Absolute with an unknown frame is scanned in `machine` mode at offset 0 | P3-3 |
| Homing | none | by design, stated in the Safety Zones panel |
| XYZ corner probe moves, CNC pause-lift re-entry, second pass | not traced to a zone check | Not verified |
| Auto-focus | Z only (ADR-400 Amd 1 refuses X/Y words) | n/a |

**Laser-off on the same paths:**
- Job G0: `S0` on every G0, so it is dark under `$32=0` too (03 Verified clean).
- Frame: GRBL sends `M5 M9` first (`grbl/driver.ts:81`); Marlin sends its stop lines; Smoothieware sends `M221 S0` (C6-P2-1 KNOWN).
- Jog: keeps a modal M3/M4 (KNOWN ADR-373 residual). A latched Fire blocks jog and Frame (`laser-store-helpers.ts:188`).
- Resume: re-enters with `G0 … S0` (C1).
- External program under `$32=0`: **P2-2**.

## Findings

### P2-1 — The CNC no-go envelope reads an engraving or tapered ball-nose bit's tip diameter as its cutter diameter, so a clamp inside the bit's radius gets no Job Review warning

- **Where:**
  - `src/core/preflight/no-go-zones.ts:160-165`: the regex `^\s*;\s*cnc tool:.*\bdiameter-mm:\s*(…)` has a greedy `.*`, so it captures the last `diameter-mm:` on the line.
  - `src/core/output/cnc-grbl-group-comments.ts:126-135` writes `; cnc tool: <kind>; diameter-mm: D; angle-deg: A; tip-diameter-mm: T`.
  - `src/core/cnc/cnc-group-provenance.ts:61-74` sets `toolTipDiameterMm` for engraving bits with a tip flat, and for tapered ball noses.
  - `no-go-zones.ts:83` replaces the radius for each group, overriding the `activeCncTool` default (`cnc-preflight.ts:335`).
- **Lens:** L3, L7.
- **Anchor:** Twin. The emitter's `diameter-mm` is the cutter's widest diameter (`cnc-tool.ts:19-20`), and the CNC message claims "cutter radius … included" (`cnc-preflight.ts:351`). Contract: WORKFLOW F-A10 check 6.
- **Scenario:**
  1. A CNC V-carve or engraving layer uses a 3.175 mm engraving bit with a 0.2 mm tip flat, or a 6.35 mm tapered ball nose with a 0.5 mm tip.
  2. A clamp zone sits 1 mm from the toolpath centreline.
  3. The scan uses radius 0.1 mm (0.25 mm), not 1.5875 mm (3.175 mm). Job Review shows no no-go warning, and the bit's body passes 0.6–2.2 mm into the zone.
  4. The same path with a 3.175 mm end mill is flagged.
- **Evidence:** REPRO through the real emitter, `emitGcode` with a CNC `profile-on-path` line and a zone at `cutY + 1`. The temporary `src/io/gcode/zz-d5-tool-comment.test.ts` was deleted; a copy is in the scratchpad `d5-repros/`.
  ```
  endMill    "; cnc tool: end-mill; diameter-mm: 3.175" → ["Line 20: the cutter envelope crosses no-go zone \"Clamp\" (cutter radius 1.587 mm included)…"]
  engraving  "; cnc tool: engraving; diameter-mm: 3.175; angle-deg: 30.000; tip-diameter-mm: 0.200" → []   (full-radius rescan: 1 hit)
  taperedBall "; cnc tool: tapered-ball-nose; diameter-mm: 6.350; angle-deg: 7.000; tip-diameter-mm: 0.500" → []   (full-radius rescan: 1 hit)
  ```
  L7: `no-go-zones.test.ts:250-296` uses only the two-field end-mill comment, never the emitter's real form.
- **Novelty:** no prior report or open PR touches `cutterRadiusFromToolComment`.
- **Refuter:** CONFIRMED, P2 kept. Own REPRO and READ.
  - **Repro.** `cncGrblStrategy.emit` of one V-carve contour at y 50, with a 5 × 5 zone at y 51,
    then `findNoGoZoneCollisions`:
    - end mill: `[[20,1.5875]]`;
    - pointed engraving bit, no tip: `[[20,1.5875]]`;
    - the same bit with a 0.2 mm flat: `[]`;
    - tapered ball nose with a 0.5 mm tip: `[]`.
  - **Cause.** The greedy `.*` backtracks to `tip-diameter-mm:`, because `\b` matches between `-`
    and `d`.
  - **Twin.** `program-tools.ts` `parseToolGeometry` reads the same comment by field name and gets
    3.175.
  - **Physical width.** The full diameter is the right keep-out. A 30° 3.175 mm bit with a 0.2 mm
    flat reaches full width 5.55 mm above its tip ((3.175 − 0.2) / 2 ÷ tan 15°). So a clamp
    standing more than about 5 mm above the cut depth meets the full-width flank, and the shank and
    nut are wider still. Even the slot cut at the stock surface (0.2 + 2·d·tan 15° = 0.47 mm at
    0.5 mm depth) is wider than the tip.
  - **Inversion.** Adding a flat makes the bit wider, yet the envelope shrinks from 1.59 mm to
    0.1 mm.
  - **Novelty.** Nothing in `docs/audits` mentions `tip-diameter-mm` or this regex. No open PR
    touches `no-go-zones.ts`.
  - **Severity.** P2: an advisory goes missing, but the emitted program is unchanged.
- **Fix direction:** Anchor the match to `;\s*diameter-mm:` right after the kind, or carry the cutter diameter as structured data. Add a test that feeds the emitter's real comment.

### P2-2 — An external program run on a laser that reports `$32=0` burns every G0 rapid that lacks `S0`; the Run review never says so, and the acknowledgement is the generic settings prompt that points at a Job Review this path does not have

- **Where:**
  - `src/ui/gcode-inspector/external-run.ts:213-224`: the only `$32` gate is `confirmLaserModeStartEvidence`.
  - `src/ui/laser/laser-mode-start-acknowledgement.ts:10-13`: the prompt reads "could not confirm, or observed a mismatch in, … `$30` … or laser mode (`$32=1`) shown in Job Review".
  - `src/core/external-program/external-program-review.ts:124-160` and `RunGcodeFileSummary.tsx:30`: there is no lit-rapid or `$32` warning, and the Run dialog shows no controller settings.
  - `src/core/gcode-view/finding-checks.ts:248`: the Inspector assumes "A G0 never cuts".
  - The detector exists: `findLaserOnTravelIssues` (`predicates.ts:54-86`, non-negotiable 3).
- **Lens:** L2, L3, L5.
- **Anchor:**
  - Ground truth: gnea/grbl `gcode.c` sets `GC_PARSER_LASER_DISABLE` for non-G1/G2/G3 motion only inside `if (bit_istrue(settings.flags,BITFLAG_LASER_MODE))`. grblHAL (`if(settings.mode == Mode_Laser)`) and FluidNC (`if (spindle->isRateAdjusted())`) do the same.
  - LightBurn "Moves are burned": a GRBL laser "still on when moving between shapes" is laser mode off; fix with `$32=1`.
  - Twin: KerfDesk's own output writes `S0` on every G0 so that it stays dark under `$32=0` (03 Verified clean, `$32=0` oracle).
- **Scenario:**
  1. A stock-GRBL diode reports `$32=0`, a common misconfiguration according to LightBurn's troubleshooter.
  2. The operator opens a LightBurn-made `.gcode` (`M4`, `G1 … S800`, `G0 X Y` with no S) and presses Run, then Frame. The Run dialog lists no laser-mode warning.
  3. Start shows the same prompt that fires whenever `$30` is unread or differs from the profile, which is routine on many machines. It cites a Job Review that is never shown on this path.
  4. After Confirm, every rapid between shapes runs at S800. The workpiece is scored and the beam is lit across clamps.
- **Evidence:** REPRO, oracle level. The temporary `src/core/external-program/zz-d5-external-lit-rapid.test.ts` normalizes the file exactly as Run does, reviews it, and runs the repo's GRBL power oracle (`grbl-laser-power-model.ts`, a port of `gcode.c`).
  ```
  reviewWarnings: ["The program switches the laser or spindle on (M3 or M4) before it sets S …"]   (no laser-mode / rapid warning)
  G0X10Y40   laserMode1 beam 0   laserMode0 beam 800
  findLaserOnTravelIssues → ["G0X10Y10","G0X10Y40"]
  ```
  Not run on hardware.
- **Novelty:** ADR-630 decided that "the existing `$32` laser-mode acknowledgement applies". No audit or open PR covers lit rapids in opened programs. PR #1380 and #1384 touch the review for other reasons.
- **Refuter:** CONFIRMED, P2 kept.
  - **Ground truth (fetched).** gnea/grbl `gcode.c` sets `GC_PARSER_LASER_DISABLE` only inside
    `if (bit_istrue(settings.flags,BITFLAG_LASER_MODE))`. Otherwise it runs
    `spindle_sync(..., gc_block.values.s)`. The GRBL wiki says only that in laser mode "G0 enforces
    the laser to be disabled automatically". The LightBurn page was not re-fetched (404).
  - **Repro.** The real `confirmLaserModeStartEvidence`, `normalizeExternalProgram` and
    `reviewExternalProgram`:
    - A `$32=0` snapshot and a `$32=1` / `$30=255` snapshot give byte-identical prompts
      (`sameText: true`), both citing "shown in Job Review".
    - Program `M4 / G0X5Y5 / G1…S700 / G0X80Y60 / …`: the review warns only "M4 before S".
    - `findLaserOnTravelIssues` flags `G0X5Y5` and `G0X80Y60`.
  - **Read.** `external-run.ts` never calls `runControllerReadiness`, so the specific "Controller
    reports $32=0" text (`controller-readiness-messages.ts:26`) never reaches this path.
  - **Novelty.** Not KNOWN:
    - ADR-630 (2026-10-18) chose this acknowledgement deliberately, but does not discuss lit rapids.
    - The 2026-09-25 audit predates external runs.
    - Rolling-v2 area 26 and the 2026-10-20 audits do not raise it.
    - Open PR #1384 changes the review, but for other findings.
  - **Severity.** Not P1: a pre-Start acknowledgement does name laser mode (`$32=1`) as
    unconfirmed or mismatched, and asks the operator to confirm only after checking. But the
    prompt is shared with `$30` mismatches and never states the consequence, so this is P2: a
    misleading result an ordinary user will hit. Because ADR-630 chose the gate, the fix (wording
    and a review warning, not a refusal) is the maintainer's call.
- **Fix direction:**
  - When a laser controller reports `$32=0` (or `$32` is unread) and `findLaserOnTravelIssues` flags the opened program, add a Run review warning that names the consequence ("every G0 rapid below fires the beam").
  - Give the external path its own acknowledgement text that names `$32=0`, not "Job Review".

### P2-3 — The project Frame's own path (approach, perimeter, return) is never compared with no-go zones, before or after it runs, while an external program's Frame outline and every jog are

- **Where:**
  - `src/ui/state/laser-jog-actions.ts:196-279` (`runFrame`) and `src/ui/state/laser-frame-motion-plan.ts:19-63` build and dispatch the tool-off perimeter with no zone check.
  - `src/ui/laser/frame-candidate.ts:14-15` says no-go findings "are Job Review warnings", but `appendNoGoZoneIssues` scans only the emitted job program.
  - Twins:
    - `src/ui/gcode-inspector/external-run-bed.ts:29-45` compares the external Frame outline with zones (ADR-630 Amd 1 item 2).
    - `src/ui/state/laser-jog-warnings.ts:139-155` warns on a jog over the same kind of segment.
  - L7: `use-frame-action.physical-safety.test.ts:247-266` is titled "keeps a perimeter no-go finding advisory". Its zone is crossed only by the perimeter, yet it asserts only that the Frame ran, with a `success` toast. No advisory exists.
- **Lens:** L1, L3, L7.
- **Anchor:**
  - Twin: ADR-630 Amendment 1 item 2. The external outline "is placed on the bed the way a jog's path is", and overlapping a zone "adds a review warning".
  - ADR-129 2026-07-15 amendment: zone checks follow the physical path.
  - ADR-232 permits warnings and forbids only refusals.
- **Scenario:**
  1. A verified native-bed frame (homed stock GRBL) and a 2 × 2 mm clamp zone sit on the bottom edge of a job's bounding box. The job's own diagonal cut misses it.
  2. Frame job traces the rectangle through the zone. The toast says "Frame complete — press Start…".
  3. The permit's warnings, which Job Review shows at Start, do not mention the zone.
  4. The same outline from an opened program would have shown "The Frame outline overlaps the no-go zone …" before Frame.
- **Evidence:** REPRO. The temporary `src/ui/laser/zz-d5-frame-perimeter.test.tsx` reuses the physical-safety harness with `stockNativeEvidence`.
  ```
  frameBounds {minX:40,minY:300,maxX:100,maxY:360}, zone {x:69,y:299,w:2,h:2}, perimeterHit true
  permitWarnings ["Output power uses saved profile S1000; …"]   (no zone)
  toasts ["success: Frame complete — press Start to review and run the current settings at this placement."]
  ```
- **Novelty:** ADR-232 removed the refusal. No report raised the missing advisory or the external-Frame twin.
- **Refuter:** CONFIRMED, P2 kept (low end).
  - **Read.** `runFrame` writes the `buildFrameDispatchPlan` lines directly, without
    `warnJogMotionPolicy`. The only zone checks in `src/` are in `preflight.ts` and
    `cnc-preflight.ts` (job program only), `external-run-bed.ts` and `laser-jog-warnings.ts`.
  - **Repro.** Physical-safety harness with `stockNativeEvidence`:
    - frame bounds {40, 300, 100, 360};
    - zone at x 99–101, y 305–307 on the right edge, where the diagonal cut misses it;
    - result: `ok: true`, the permit warnings carry only the S1000 note, and the toast is
      "success: Frame complete …".
  - **No ADR exempts Frame.**
    - ADR-232 §1: no-go findings "may appear in Job Review".
    - ADR-232 §5: tests "must assert that out-of-bed, no-go, and settings findings reach review".
    - ADR-232 deleted the Frame guard (ADR-231 §1, "its perimeter must clear enabled no-go zones")
      without moving that perimeter check into a warning.
  - **L7 correction.** The test title means "keeps the finding non-refusing", and that test has no
    verified native frame, so it could not show a zone finding either way. The real gap is that no
    test covers a perimeter finding reaching review.
  - **Severity.** Not P3: clamps sit at the stock edges, which is where the Frame rectangle runs.
    It is the low end of P2, because a warn-and-send toast protects little (ADR-237).
- **Fix direction:** Scan the dispatched Frame segments with `firstZoneCrossedBySegment` when the bed frame is known. Toast as jogs do, and carry the finding into the permit's warnings. Rename or fix the test.

### P2-4 — Laser recovery and Start-from-line check zones on the full original program, never on the resume program actually sent, so the re-entry rapid from where the head now stands is unchecked (and the manual restart shows no zone check at all)

- **Where:**
  - `src/ui/laser/laser-recovery-flow.ts:93-103`: `confirmWarnings(source.warnings)`. Those are the warnings of `prepareArchivedRecoverySource` (`start-job-source.ts:253-313`), which prepares and scans the whole original program with `initialMachinePosition` = the live head.
  - `buildLaserResumeProgram` (`laser-resume-program.ts:22-33`) output is never passed to a preflight.
  - `src/ui/laser/start-job-resume-stream.ts:31-60,140-175` (`streamResumeFromRawLine`) and `ManualLaserRestartDialog.tsx:40`: the manual restart confirms only laser mode and the resume question, with no preflight warnings.
- **Lens:** L1, L3, L4.
- **Anchor:**
  - Contract: ADR-129 2026-07-15 amendment. "A live Start supplies the qualified machine position so the head-to-first-XY entry move is checked too." For a resume, the first XY is the resume point.
  - ADR-129 context: resume preflights honour zones.
- **Scenario:**
  1. Bed 400 × 400, front-left origin. Two squares: B at (300–320, 10–30) is cut first, A at (10–30, 350–370) second. A "Rear clamp" zone sits at (100–200, 360–400).
  2. The job stops in A. The operator homes, so the head is at (390, 390), and resumes.
  3. The recovery review scans the full program from (390, 390): head → B → A → park. Nothing crosses, so there is no warning.
  4. The streamed resume re-enters with `G0 X10 Y370 S0` straight from (390, 390) through the clamp.
- **Evidence:** REPRO. The temporary `src/ui/laser/zz-d5-resume-entry.test.ts` uses the real `emitGcode` and `buildLaserResumeProgram`.
  ```
  jobReviewNoGo: []   fullScan: []   (initialMachinePosition 390,390)
  resume head: ["; KerfDesk resume preamble","G21","G90","G54","G94","M5","G0 X10 Y370 S0","M4 S0",…]
  resumeScan: [{"line":7,"text":"G0 X10 Y370 S0"}]
  ```
  The reverse also occurs: the full scan can flag head → first-part legs that the resume never makes.
- **Novelty:** C1, 05 and 18 audited the resume bytes and step-back, not their zone review. The open PR #1370 changes Start-from-line numbering only.
- **Refuter:** CONFIRMED, P2 kept.
  - **Repro**, with different geometry from the auditor's (`emitGcode` + `buildLaserResumeProgram`,
    head after Home at 395,395, zone "Camera mount" at x 150–210, y 340–400):
    - Job Review no-go: `[]`;
    - full-program scan from the head: `[]`;
    - resume program: `[[7,"G0 X45 Y360 S0"]]`.
  - **Read.**
    - `planLaserRecovery` confirms `source.warnings`, which `prepareStartJobFromPrepared`
      computes on the archived full program.
    - No `runPreflight` caller takes resume lines. The callers are `emit-gcode.ts`,
      `rd-preflight.ts` and `tile-emission.ts`.
    - On the manual path (`runStartFromLineFlow`, `ManualLaserRestartDialog`),
      `streamResumeFromRawLine` never shows the prepared `source.warnings`.
  - **Novelty.** Not KNOWN:
    - C1 covered the re-entry feed and dialect, not zones.
    - Rolling-v2 05 and 18 do not mention zones on resume.
    - The July audits counted resume as covered because it re-runs `prepareStartJob`
      (2026-07-10 consolidated v2, line 655), but that scans the original program, not the resume.
  - **Severity.** The re-entry is beam-off (`S0`), so the risk is a collision. P2 stands.
- **Fix direction:** Run `findNoGoZoneCollisions` on the resume (or second-pass) lines with the live head as `initialMachinePosition` and the trusted offset. Show the result in both the saved-recovery and manual-restart confirmations.

### P3-1 — Jog zone and bounds checks pick their coordinate frame from `homingState`, not from what MPos means: silent skip while homed without a verified frame, and the homed negative MPos read as bed coordinates after any reset or alarm

- **Where:**
  - `src/ui/state/laser-jog-warnings.ts:54-69`: `nativePointsOnBed` returns `null` when `homingState === 'confirmed'` and no frame exists, and returns raw MPos otherwise.
  - `:42-43`: `bedPath === null` returns with no warning.
  - `homingState` becomes `'unknown'` on every reset banner, alarm, quick stop and reconnect (`laser-line-handler.ts:424`, `laser-alarm-line.ts:66`, `laser-connection-actions.ts:251`).
  - Twin: `external-run-bed.ts:18-19,36` shows `OUTLINE_NOT_ON_BED` for the same "homed, not verified" state.
- **Lens:** L3, L4.
- **Anchor:**
  - Contract: ADR-129 2026-08-25 amendment ("an unresolved XY path now produce[s] a prominent warning").
  - `MachineSetupSafetyZones.tsx:36-37` promises a warning when the XY path "cannot be resolved".
  - Ground truth: gnea/grbl `main.c` clears `sys_position` only at power-up (`memset(sys_position…)` before the `for(;;)` re-init loop). A soft reset at Idle keeps the homed MPos and does not re-lock.
- **Scenario:**
  1. On a homed grblHAL, or a stock GRBL whose `$130/$131` differ from the bed, no jog ever gets a zone warning or a "not compared" notice.
  2. On a homed stock GRBL with negative machine space: Abort or reset at Idle, then jog 1 mm. The toast says "Jog target X-198.000 … is outside the configured machine bounds". A zone covering the whole bed is not reported.
  3. The external-run outline uses the same `nativePointsOnBed`, so it misplaces the outline after a reset too.
- **Evidence:** REPRO. The temporary `src/ui/state/zz-d5-jog-reset.test.ts` drives the real store, connect handshake and reset banner.
  ```
  confirmedToasts: []                       (whole-bed zone, homed, no frame)
  homingStateAfterReset: "unknown"
  resetToasts: ["Jog target X-198.000 Y-150.000 is outside the configured machine bounds X0.000..400.000, Y0.000..300.000. …"]
  ```
- **Refuter:** CONFIRMED (READ plus ground truth fetched).
  - **Read.** `nativePointsOnBed` returns raw MPos whenever `homingState !== 'confirmed'`, and the
    reset-banner and alarm patches set `homingState: 'unknown'`.
  - **Ground truth.** In gnea/grbl `main.c`, `memset(sys_position…)` and the `HOMING_INIT_LOCK`
    alarm sit before `for(;;)`, so a soft reset at Idle keeps the homed MPos.
  - **Partly seen before.** The homed-without-frame skip is a stated choice in the `bedJogPath`
    comment, and the 2026-09-25 audit noted it as a side effect (SM-6 evidence). The reset and
    alarm half is new.
  - Jog warnings are sent with the move, so P3 is right.
- **Fix direction:** Key the bed comparison on positional evidence: a confirmed frame, or "never homed since power-up". When neither holds, give one "zones not compared" notice, as the external run does.

### P3-2 — Zones cannot be placed where the profile's own bounds are negative: a center-origin bed can protect only its +X/+Y quadrant, and the editor calls bed coordinates "machine-coordinate" beside a DRO that shows native MPos

- **Where:**
  - `src/ui/laser/MachineSetupSafetyZones.tsx:126-145`: `min 0`, through the clamp at `NumberField.tsx:35`.
  - The same rule is enforced on load and import: `machine-profile-io.ts:265-266`, `project-device-profile-validator.ts:183-184`, `profile-catalog.ts:306-307`.
  - Twin: `machine-bounds.ts:13-21` gives `center` the bounds `[-W/2, W/2]`, which the "Signed jog bounds" decision adopted.
  - `MachineSetupSafetyZones.tsx:68` titles the field "machine-coordinate". `StatusDisplay.tsx:51` shows raw `MPos`, which is negative on a homed negative-space GRBL.
- **Lens:** L3, L4.
- **Anchor:** Twin: signed center-origin bounds versus non-negative zone validation. ADR-129: zones exist for clamps and fixtures anywhere on the bed.
- **Scenario:**
  1. On a center-origin 400 × 400 machine, typing X −150 / Y −120 for a front-left clamp leaves X 12 / Y 0. The zone lands near the bed centre.
  2. A profile file carrying the right zone is refused: "profile.noGoZones[0] is invalid".
- **Evidence:** REPRO. The temporary `src/ui/laser/zz-d5-center-zone.test.tsx` renders the real panel.
  ```
  bounds {minX:-200,minY:-200,maxX:200,maxY:200}
  zoneAfterTyping {x:12, y:0, …}
  importOfNegativeZone {"kind":"invalid","reason":"profile.noGoZones[0] is invalid"}
  ```
- **Refuter:** CONFIRMED (READ).
  - `rectForZone` uses the raw zone X/Y in machine coordinates.
  - `machineBoundsForDevice` gives a center-origin bed the range `[-W/2, W/2]`.
  - All three validators (`isNonNegativeFinite` and `requireNonNegative`) reject a negative X or Y,
    and the UI field floors at `min ?? 0`.
- **Fix direction:**
  - Validate zones against `machineBoundsForDevice`, not against ≥ 0.
  - Label the fields as bed coordinates and offer "use head position", converted through the native-bed frame.

### P3-3 — CNC pass and supervised recovery scan Absolute jobs with an unknown native-bed frame in `machine` mode at offset 0, where Start and Save switch to `relative-origin`

- **Where:**
  - `src/ui/laser/cnc-pass-recovery-flow.ts:130-138` and `cnc-supervised-recovery-flow.ts:213-221` pass `preflightMotionOffset` only when defined, and pass no `preflightCoordinateMode`.
  - `src/io/gcode/emit-gcode.ts:261-265` then picks `machine`, because Absolute carries no `jobOrigin`.
  - Twin: `start-job-readiness.ts:428-433` and `save-gcode-emission.ts:76-86` use `relative-origin`.
- **Lens:** L3.
- **Anchor:** Twin: one frame rule for one program (18 Verified clean, "Start and recovery both carry `trustedMotionOffsetForPreflight`", which did not cover the undefined case).
- **Scenario:**
  1. A homed grblHAL router, which never gets a frame, runs an Absolute job and is interrupted.
  2. The recovery confirmation lists collisions and out-of-bed lines computed on work coordinates as if they were bed coordinates.
  3. The same dialog also carries Start's "cannot be checked" text from the re-qualification. The advice is spurious or missing, and contradicts itself.
- **Evidence:** REPRO at emit level (same temporary file as P2-1).
  ```
  recoveryLike (no offset, no jobOrigin): ["no-go-zone-collision: Line 20: the cutter envelope crosses no-go zone \"Clamp\" …"]
  startLike (relative-origin): ["no-go-zone-collision: No-go zones cannot be checked from this hand-set origin …"]
  ```
  The wiring is READ.
- **Refuter:** CONFIRMED (READ).
  - `emit-gcode.ts:261-265` defaults to `machine` when neither a mode nor a `jobOrigin` is given.
  - Neither recovery flow sets `preflightCoordinateMode` (`cnc-pass-recovery-flow.ts:130-138`,
    `cnc-supervised-recovery-flow.ts` `recoveryEmitOptions`).
  - Start's `coordinatePreflightContext` passes `relative-origin`.
- **Fix direction:** Pass `preflightCoordinateMode: 'relative-origin'` when the archived source has no trusted offset, as Start does.

### P3-4 — When the native-bed frame is unknown, the no-go advisory blames "this hand-set origin" for Absolute and Current Position jobs, and advises a placement that does not exist on that controller

- **Where:** `src/core/preflight/preflight.ts:204-213` and `cnc-preflight.ts:324-331`. They are reached from `start-job-readiness.ts:428-433` for every placement whenever `trustedMotionOffsetForPreflight` is `undefined`, which on grblHAL, FluidNC, Marlin and Smoothieware (except the Falcon A1 Pro) is always.
- **Lens:** L3 (message versus condition).
- **Anchor:** Twin with `UNKNOWN_NATIVE_BED_MESSAGE` (`native-bed-frame.ts:60-61`), which states the real cause (an unverified controller-to-bed mapping).
- **Scenario:** A homed grblHAL in Absolute placement with a zone enabled. Job Review says the zones cannot be checked "from this hand-set origin" and to "use a placement with a trusted machine position". No placement qualifies on grblHAL.
- **Evidence:** READ. The message text is shown in the P3-3 REPRO output.
- **Refuter:** CONFIRMED (READ).
  - Both texts fire on `relative-origin` with no offset. Start chooses that for every placement
    when the trusted offset is `undefined`.
  - `resolveNativeBedFrame` returns a frame only for the Falcon A1 Pro vendor contract or for
    current stock-GRBL evidence.
- **Fix direction:** Name the unverified controller-to-bed mapping, and drop advice that cannot be followed.

### P3-5 — An external CNC program's Frame outline is compared with zones on the centreline only; the project CNC scan adds the active bit's radius

- **Where:** `src/ui/gcode-inspector/external-run-bed.ts:37` (`zonesOverlappingRect(rect, …)`, no expansion). The twin is `cnc-preflight.ts:335` (`defaultCutterRadiusMm: activeCncTool(config).diameterMm / 2`) and `no-go-zones.ts:171-179`.
- **Lens:** L3.
- **Anchor:** Twin: one no-go model for CNC motion (ADR-630 Amd 1 item 2 versus the CNC preflight's cutter-envelope rule).
- **Scenario:** A ¼" bit runs an opened program whose outline stops 2 mm short of a clamp zone. The Run review is silent. The same geometry as a project job warns "cutter envelope crosses".
- **Evidence:** READ.
- **Refuter:** CONFIRMED (READ). `zonesOverlappingRect` compares the raw outline, and
  `external-run-bed.ts` adds no cutter radius anywhere.
- **Fix direction:** Expand the outline by the active bit's radius in CNC mode, and say so in the warning.

### P3-6 — Latent: the jog warning reads an absolute jog's X/Y as native MPos, but `buildJogCommand` sends `$J=G90` in work coordinates; the test that pins it uses WCO 0

- **Where:**
  - `src/ui/state/laser-jog-warnings.ts:97-100`: `relative === false` → target `{x: dx, y: dy}`, compared with MPos.
  - `src/core/controllers/grbl/commands.ts:135-138` emits `G90`, not `G53`.
  - `laser-jog-actions.zone-guard.test.ts:142-161` runs at MPos 50/50 with no WCO.
- **Lens:** L3, L7.
- **Anchor:** Twin: the warned path versus the commanded path (gnea/grbl jog block: `$J=` targets obey G90 in the active work coordinates unless G53).
- **Scenario:** Latent. No production caller passes `relative:false` to `jog()` today; the Frame return builds its own line. A future absolute jog with a WCO of (100, 50) would be warned 100/50 mm away from where it goes.
- **Evidence:** READ plus `grep "relative: false"`, which finds only fixtures, HPGL, air-keep-alive and the Frame return.
- **Refuter:** CONFIRMED (READ; latent).
  - `resolveJogXyPath` takes `{dx, dy}` as an MPos target.
  - `buildJogCommand` writes `G90` with no `G53`.
  - The production callers that pass `relative: false` are `air-keep-alive.ts`,
    `hpgl-interpreter.ts` and `laser-frame-motion-plan.ts:107`. None of them goes through `jog()`.
- **Fix direction:** Convert an absolute target by WCO (or send `G53`), and test with a non-zero WCO.

### P3-7 — Latent: the three modal scanners (no-go, relative envelope, bounds) parse a narrower G-code than GRBL runs: `G91` only as the first word, one-word-I/J arcs as chords, `G20` ignored

- **Where:**
  - `no-go-zones.ts:126-130,189-191` and `relative-motion-envelope.ts:98-108`: `isGcodeCommand` is anchored at line start, and an arc needs both I and J.
  - `predicates.ts:173` (same arc rule).
  - The header at `predicates.ts:8-11` says they "can validate G-code from external tools too".
- **Lens:** L4, L7.
- **Anchor:** Ground truth: gnea/grbl `gcode.c`. An omitted I or J is 0 (only both missing is `error:26`), and modal words may appear in any order on a line. `relative-motion-envelope.test.ts` has no arc or `G91` case.
- **Scenario:** Latent. KerfDesk writes both I and J, emits `G91` only alone (Focus Test, Z only), never `G20`, and `.rd` preflight synthesizes `G0`/`G1`. A future external caller would get a 0 mm instead of a 10 mm span for `G2 X20 Y0 I10`, and an absolute reading of `G0 G91 X10 Y10`.
- **Evidence:** REPRO. The temporary `src/core/preflight/zz-d5-relative-envelope.test.ts` gives `semicircleBothIJ` → "spans 10.000 mm in Y", `semicircleJOmitted` → no span, `g91NotFirstWord` → 10 mm against `g91First` → 20 mm.
- **Refuter:** CONFIRMED (READ; latent).
  - `commandPattern` (`gcode-words.ts:27`) is anchored at `^`.
  - In `no-go-zones.ts`, `nextPoint` and `motionIntersectsRect` need both I and J, and fall back to
    the chord when either is missing.
- **Fix direction:** Share one modal word scanner (`scanGcodeWords`) for distance mode and units, and default an omitted I/J to 0. Alternatively, narrow the header claim.

## KNOWN (re-observed, not re-raised)

- **Jogs and point moves keep a modal M3/M4** ("beam off" copy in Move to position, saved Go and `head-move-dispatch.ts`). This is the C8 KNOWN / ADR-373 residual. The GRBL wiki confirms jogs "inherit and maintain the previous laser state".
- **D3-P3 (v3):** no-go zones and jog warnings treat rotary Y as a bed position.
- **03-P3-5 / 18 K-9:** the relative envelope seeds work 0,0 for Current Position jobs.
- **03-P2-7 / 18 K-7:** marked image runways over 5 mm raise false long-blank-feed warnings (`laser-off-motion-policy.ts:72`).
- **26-K1 (WA-4):** G18/G19 arcs are left out of the external Frame outline and its bed and no-go check.
- **18-P3-2:** the `G28`/`G30` intermediate leg is left out of the external outline and its zone check.
- **12-P2-1 (now P3), mechanism shared with 13-P1-1:** Open installs the document's device wholesale. When the file carries the same `profileId|name|bed`, no banner shows and its `noGoZones` silently replace the machine's, so an older project drops a clamp zone added since. ADR-500 Amendment 1 §2 decided Open's behaviour. ADR-400 Amendment 1 exempted only the Auto-focus command, and zones may deserve the same exemption. This is a maintainer decision, not raised.
- **C1-P3-1:** 4040 resume re-enters with an unbounded `G0`, unlike the controlled laser-off seeks.
- **C6-P2-1:** Smoothieware Frame, jog and Home leave `M221 S0` (laser-off side effect on external runs). PR #1380 is open.

## Refuted

Candidates dropped before raising:

- **Frame lit on GRBL.** No. `frameToolOffLines` is `[M5, M9]` before the perimeter (`grbl/driver.ts:81`), and the Frame jogs then inherit a disabled spindle.
- **Jog while Fire is latched.** Blocked by `FIRE_ACTIVE_COMMAND_MESSAGE` (`laser-store-helpers.ts:188`).
- **G53 / G28 / G92 in KerfDesk output confusing the scanner.** None are emitted (grep of `src/core/output`, `src/core/cnc` and `src/io/gcode`).
- **Help topic "preflight checks before frame, start, or export"** (`help-topics.ts:270`). The topic has no consumer in the UI (only its own test), so it is unreachable copy.
- **The canvas zone overlay disagrees with the job in User Origin / Current Position.** By design: the canvas is artwork-relative there (`UNKNOWN_NATIVE_BED_MESSAGE`, ADR-327), and the zone is drawn at its fixed bed position.
- **Zones outside the bed are ignored by the job scan but not by jogs.** Harmless: motion outside the bed also raises out-of-bed, and the CNC envelope that reaches the bed is kept (`no-go-zones.ts:147`, tested).
- **Hold-jog warns for the full travel even when released early.** This is conservative warn-only guidance (ADR-232).
- **Laser head or nozzle size is not modelled.** No contract asks for it. A zone is the beam point's keep-out, and CNC states its own holder caveat.

## Verified clean

- **Geometry.**
  - `segmentIntersectsRect` covers inclusive edges, endpoints inside, crossings and collinear touch.
  - `arcIntersectsRect` uses the swept arc, not the AABB; a full circle with no endpoint axes is handled.
  - The jog guard (`firstZoneCrossedBySegment`) and the scanner share the helpers.
  - The CNC envelope is expanded by the cutter radius (apart from P2-1).
  - Compact modal continuations (`X…S…`) are scanned (tests at `no-go-zones.test.ts:203-248`).
- **Units.** Inch status reports are converted for the jog start (`inferCurrentMachinePosition`), the Start head position (`initialMachinePositionOption`) and the WCO (`knownWco`). Jogs always send `G21`.
- **Frames of reference.** Zones are bed-fixed and do not follow a WCS or origin change. Start and Save translate program coordinates to bed coordinates with WCO + native-to-bed (`trustedMotionOffsetForPreflight`), or fall back to `relative-origin`. Save and `.rd` share `savePreflightFrameOptions`.
- **Every app jog entry point warns:** pad step and hold, keyboard, phone jog and hold, Move to position, saved positions, origin row Go, click-to-position, board capture, head-camera capture, recovery move, positioning-light move and rotary Test. All go through `runJog`/`jogToMachinePosition` → `warnJogMotionPolicy` (grep of `.jog(` and `jogToMachinePosition(`).
- **Canvas twin.** `drawNoGoZones` draws only enabled zones through `toSceneCoords`. That is the exact inverse of the machine transform for all five origins, matching `rectForZone` in machine coordinates. Disabled zones are neither drawn nor checked.
- **Validators.** `.lf2`, machine-profile import and the catalog reject NaN, Infinity, negative and zero sizes. The UI floors W/H at 0.1 mm.
- **Laser-off ground truth.**
  - GRBL, grblHAL and FluidNC darken G0 only in laser mode.
  - Marlin 2.1.2.5 `gcode.cpp:243-250` zeroes power on G0 in every cutter mode.
  - KerfDesk's own output carries `S0` on every G0, so it is dark in both `$32` states (03).
- **Laser-off motion policy.**
  - `isConfiguredIntentionalLaserOffMotion` excuses only marked lines, by exact controlled feed or within the largest automatic overscan (including sub-layers and object overrides).
  - `controlledLaserOffTravelFeedIssue` bounds the feed to 1..maxFeed.
  - `controlled-laser-off-motion-preflight.test.ts` covers rounding and overrides.
- **Relative envelope on KerfDesk output.** The only `G91` is the Z-only Focus Test step, so the XY span is unaffected. Arc bulges are included when both I and J are present (REPRO: semicircle, 10 mm span).

## Not verified

- **No hardware.** P2-2 rests on the gnea `gcode.c` port in `grbl-laser-power-model.ts` and the fetched sources, not a burn.
- **Marlin fan-wired lasers (`M106`) in opened programs.** G0 does not touch fan PWM, so lit rapids are plausible there too. The Marlin reader was not traced.
- **XYZ corner-probe XY moves, CNC pause-lift re-entry and the laser second-pass Frame/Start warnings.** These were not traced to a zone check.
- **FluidNC laser mode.** Whether KerfDesk's `$32` evidence models FluidNC's spindle-type laser mode (no `$32`) was not checked; that belongs to D6.
- **Phone remote and MCP motion** beyond the `jog()` entry (rolling-v2 01).

```json
[
  {"id":"D5-P2-1","severity":"P2","area":"ctl-zones-laser-off-motion","file":"src/core/preflight/no-go-zones.ts","line":161,"anchor":"Twin: cnc-grbl-group-comments.ts:134 writes diameter-mm then tip-diameter-mm; cnc-tool.ts diameterMm is the widest cutting diameter; cnc-preflight.ts:351 claims cutter radius included","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Greedy tool-comment regex takes tip-diameter-mm for engraving and tapered ball-nose bits, so the no-go cutter envelope shrinks to the tip and a clamp 1 mm from the cut gets no Job Review warning (end mill of same diameter is flagged)"},
  {"id":"D5-P2-2","severity":"P2","area":"ctl-zones-laser-off-motion","file":"src/ui/gcode-inspector/external-run.ts","line":218,"anchor":"Ground truth: gnea/grbl gcode.c laser-disable only under BITFLAG_LASER_MODE (grblHAL Mode_Laser, FluidNC isRateAdjusted); LightBurn 'Moves are burned' ($32=1 fix); Twin: KerfDesk output writes S0 on every G0 (03 verified)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"An opened external program on a laser reporting $32=0 burns every G0 rapid without S0; the Run review has no lit-rapid or $32 warning, and the only gate is the generic settings prompt that cites a Job Review this path does not show"},
  {"id":"D5-P2-3","severity":"P2","area":"ctl-zones-laser-off-motion","file":"src/ui/state/laser-frame-motion-plan.ts","line":19,"anchor":"Twin: ADR-630 Amendment 1 item 2 (external Frame outline compared with zones), laser-jog-warnings.ts:139 (jog segments); ADR-129 2026-07-15 amendment; ADR-232 allows warnings","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"The project Frame's approach, perimeter and return are never compared with no-go zones: a zone crossed only by the perimeter gets a success toast and no Job Review line, while the same outline from an opened program is warned; the physical-safety test titled 'perimeter no-go finding advisory' asserts no advisory"},
  {"id":"D5-P2-4","severity":"P2","area":"ctl-zones-laser-off-motion","file":"src/ui/laser/laser-recovery-flow.ts","line":103,"anchor":"Contract: ADR-129 2026-07-15 amendment (head-to-first-XY entry move checked with the live position)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Laser recovery confirms zone warnings of the full original program from the live head, never the resume program; the re-entry G0 from the homed head to the resume point crosses a clamp zone unreported, and manual Start-from-line/restart shows no preflight warnings at all"},
  {"id":"D5-P3-1","severity":"P3","area":"ctl-zones-laser-off-motion","file":"src/ui/state/laser-jog-warnings.ts","line":68,"anchor":"Contract: ADR-129 2026-08-25 amendment, MachineSetupSafetyZones.tsx:36 (unresolved path warns); Twin: external-run-bed.ts OUTLINE_NOT_ON_BED; Ground truth: gnea/grbl main.c keeps sys_position across soft reset","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Jog zone/bounds frame is chosen from homingState: homed without a verified frame silently skips zones; after a reset/alarm the homed negative MPos is compared as bed coordinates, giving 'outside configured bounds' on every jog and missing every zone"},
  {"id":"D5-P3-2","severity":"P3","area":"ctl-zones-laser-off-motion","file":"src/ui/laser/MachineSetupSafetyZones.tsx","line":137,"anchor":"Twin: machine-bounds.ts:13 signed center-origin bounds vs non-negative zone validation in UI, machine-profile-io.ts:265, project-device-profile-validator.ts:183, profile-catalog.ts:306","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Zones cannot have negative X/Y: a center-origin bed can protect only its +X/+Y quadrant (typed -150/-120 commits 12/0; a correct profile file is refused); fields are labelled machine-coordinate beside a DRO showing native MPos"},
  {"id":"D5-P3-3","severity":"P3","area":"ctl-zones-laser-off-motion","file":"src/ui/laser/cnc-pass-recovery-flow.ts","line":135,"anchor":"Twin: start-job-readiness.ts:428 and save-gcode-emission.ts:76 use relative-origin when the trusted offset is undefined","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"CNC pass and supervised recovery emit Absolute jobs with an unknown native-bed frame in machine mode at offset 0, so zone and bed advisories are computed on work coordinates as bed coordinates, contradicting Start's 'cannot be checked'"},
  {"id":"D5-P3-4","severity":"P3","area":"ctl-zones-laser-off-motion","file":"src/core/preflight/preflight.ts","line":208,"anchor":"Twin: UNKNOWN_NATIVE_BED_MESSAGE (native-bed-frame.ts:60) states the real cause","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"With an unknown native-bed frame the no-go advisory blames 'this hand-set origin' even for Absolute/Current Position and advises a trusted placement that no placement provides on grblHAL/FluidNC/Marlin/Smoothieware"},
  {"id":"D5-P3-5","severity":"P3","area":"ctl-zones-laser-off-motion","file":"src/ui/gcode-inspector/external-run-bed.ts","line":37,"anchor":"Twin: cnc-preflight.ts:335 expands zones by the active bit radius","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"External CNC program outline is compared with zones on the centreline only; the same geometry as a project CNC job is warned with the cutter radius"},
  {"id":"D5-P3-6","severity":"P3","area":"ctl-zones-laser-off-motion","file":"src/ui/state/laser-jog-warnings.ts","line":100,"anchor":"Twin: commands.ts:135 sends $J=G90 (work coordinates) vs warning target read as native MPos; L7 test at WCO 0","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Latent: an absolute jog's target is warned as machine coordinates while the command moves in work coordinates; the pinning test uses WCO 0"},
  {"id":"D5-P3-7","severity":"P3","area":"ctl-zones-laser-off-motion","file":"src/core/preflight/relative-motion-envelope.ts","line":104,"anchor":"Ground truth: gnea/grbl gcode.c (omitted I/J is 0, modal words in any order); predicates.ts:8 claims external validation","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Latent: no-go, relative-envelope and bounds scanners treat G91 only as the first word, read one-word I/J arcs as chords and ignore G20; unreachable from KerfDesk output today"}
]
```
