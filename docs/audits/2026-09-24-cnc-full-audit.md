# KerfDesk CNC audit (2026-09-24)

The router side of KerfDesk, checked against the real GRBL 1.1h source. Every finding was reproduced or traced to code and is backed by a cited source.

- **Checked:** main at 6b6250b, 24 Sep 2026
- **Machine:** Neotronics 4040 Max, GRBL 1.1
- **Controller model:** GRBL 1.1h parser and planner built from source
- **Fixes:** Draft PR on claude/cnc-audit-te9azb

## Verdict

KerfDesk writes G-code that real GRBL 1.1h accepts line for line, and the core geometry is right. Cutter offsets, pocket coverage, depth passes, climb direction on all five origins and the rule that the bit is always up before a rapid all check out.

The problems sit around that geometry. A router job with laser mode still on gets only a folded-away warning. The bit-change park is not moved with the job, so it can run past the end of travel. Tabs are measured from the cut floor, so extra depth thins or removes them. Secondary bits inherit the primary bit's feeds and depth. On your 4040 profile every material recipe is capped at a feed that rubs rather than cuts. Holes smaller than the bit are skipped without a word, and adaptive clearing refuses ordinary rectangles.

Five clear defects are fixed in the draft PR, including inlay plugs that could not seat at inside corners. The rest need a decision or a larger change, and each one below says what I would do.

Findings: 1 critical, 10 high, 22 medium, 18 low.

## What could make the 4040 lose position

**1. Laser mode left on ($32=1).** This is the strongest candidate. In laser mode GRBL powers the spindle only while a cutting move runs and skips every spin-up wait. At job start and after each tool change the `G4 P3` dwell runs with the spindle off, and power arrives about 0.86 s before the bit reaches the stock. Every rapid switches it off again. Worst of all, after Pause the spindle stops, and on Resume motion restarts in the same instant the power returns, dragging a stopped bit through the cut (MC-1), while KerfDesk's Resume text says it waits for speed. A bit dragged or plunged below speed can stall an axis, and a stalled stepper loses steps without GRBL knowing. KerfDesk detects $32=1 but shows it only inside a folded Warnings list (JR-1). The GRBL wiki: "If you switch back from laser mode to a spindle for milling, you **MUST** disable laser mode by sending Grbl a `$32=0` command."

**2. Z driven into the top of its travel.** KerfDesk never compares the job's Z span with the machine's Z travel. If work Z0 is set within 3.81 mm of the top, every retract drives Z into its stop. With soft limits off ($20=0, the GRBL default) the motor stalls and every later cut is deeper by the lost amount (JR-3).

**3. A touch-off with the clip off.** Probing never checks the probe circuit, so a forgotten clip drives the bit into the plate for up to 25 mm before GRBL alarms (MC-2).

**4. Helical entries collapsing into plunges.** Only if you use Helical entry: 40 to 50% of small helix revolutions ran as straight plunges in GRBL's own arc code (GC-1, fixed in the PR).

**5. A bit-change park past the end of travel.** Only if the job changed bits and a park position is set in Machine Setup. The park is not moved with the job, so with zero set away from the bed corner it can drive the carriage into the end of travel and lose steps, and every cut after the change is shifted (CO-1).

After any of these, an Abort during the cut raises ALARM:3, and pass recovery still lets you tick "Position retained" (MC-3). The 300 mm/min starter feed on your profile is not a cause: it is too slow, not too heavy (FS-2).

Next step: send the `$$` output from the 4040, and say whether that job changed bits. The $32, $20, $130 to $132 and $110 to $112 values will say which of these applies.

## Fix these first

1. MC-1: With $32=1, Resume drags a stopped bit through the cut. Check $32 on the 4040 first; in the app, show $32=1 on a router job as its own banner with a one-click fix (JR-1).
2. CO-1: Move the bit-change park with the job, or park in machine coordinates, so it cannot run past the end of travel.
3. JR-3: Compare the job's Z span with the Z travel, so a retract cannot drive Z into its stop.
4. MC-2: Show the live probe input before a touch-off, so a forgotten clip cannot drive the bit into the plate.
5. TP-1: Measure tab height from the stock bottom, not the cut floor. Needs your decision because it changes ADR-258.
6. FS-1: Work out each secondary bit's feed and depth from that bit, not from the primary.
7. FS-2: Stop the 4040 starter cap from limiting every recipe to 300 mm/min. Needs your decision; the Settings audit owns the values.
8. JR-2: Warn when a hole or slot is narrower than the bit and will not be cut.
9. AC-2: Make adaptive clearing work on rectangles, and say plainly when a pocket will not be cut.

## Job Review and warnings

What the operator is told before Start, and whether it is visible and actionable.

### JR-1: A router job with laser mode on ($32=1) gets only a folded-away warning

**High** · New · Reproduced

After a laser session the controller often still has $32=1. KerfDesk knows this and writes the right text: "Set $32=0 for spindle work: laser mode cuts spindle power to zero during rapids, so plunges would start with the bit not at speed." But it sits inside "Warnings (N): open to review; none block the start", which is collapsed, and the Controller section is collapsed too. Laser jobs get an always-visible banner for the opposite mismatch; router jobs do not.

In the GRBL source, laser mode passes zero spindle speed on every non-cutting motion and ignores the spin-up delay. So `M3 S12000` after `G0 Z3.810` starts the spindle at 0, the `G4 P3` dwell runs with it off, and the spindle first turns when the plunge begins. This is the most likely cause of the 4040 losing position.

**Fix.** Show a CNC version of the laser banner whenever $32=1 or unknown on a router job, and open the Warnings list. Name all three effects: the spin-up dwell runs unpowered, power comes only during cutting moves, and Pause/Resume has no spin-up (MC-1). Put a guarded one-click "Send $32=0" on that row, like the ADR-361 speed-ceiling fix, and warn when a router project writes $32=1 from the Console or Machine Settings, as laser projects already do for $32=0. Keep it a warning, not a block, as the frame-first rules require.

**Evidence.**

- Probe L6 p02 H5: `start ok=true` with the $32 text inside the collapsed list; p09: `details has open attribute: false`.
- `JobReviewWarnings.tsx:20` opens the list only for controller-identity warnings; `JobReviewControllerSection.tsx:30` is a plain `<details>`.
- The banner is laser-only: `laser-mode-start-acknowledgement.ts:15-24`, `JobReviewAcknowledgement.tsx:29-35`. `cnc-setup-attestation.ts:4-11` has no $32 item.
- GRBL `gcode.c:869-873` (non-G1/G2/G3 motion sets laser disable), `gcode.c:931` ("Pass zero spindle speed for all restricted laser motions"), `protocol.c:674` ("When in laser mode, ignore spindle spin-up delay"), `stepper.c:845` (PWM updated per block).
- KerfDesk's own program on real GRBL under grbl-sim at $32=1: `dwellPwm [0]`, `travelPwm [0]`, `plungeAbovePwm [255]`, power on 0.86 s before the bit reaches the stock, against the 3 s the program budgets. At $32=0 the dwell and travel run at full PWM.
- A router project can write $32=1 from the Console or Machine Settings with no warning; only laser projects get a machine-kind check (`grbl-setting-write.ts:59-73`). Open since the 13 July setup audit.

**Sources.**

- [GRBL wiki: Laser Mode](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Laser-Mode): "If you switch back from laser mode to a spindle for milling, you MUST disable laser mode by sending Grbl a $32=0 command."
- [GRBL wiki: Laser Mode](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Laser-Mode): "a G0 rapid motion mode or G38.x probe cycle will never turn on and always disable the laser, but will still update the running modal state."
- [GRBL gcode.c](https://github.com/gnea/grbl/blob/master/grbl/gcode.c): "Pass zero spindle speed for all restricted laser motions."

### JR-2: Holes and slots narrower than the bit are skipped with no warning

**High** · Still open · Reproduced

On an inside-profile layer with a 20 mm hole and a 3 mm screw hole, cut with a 1/8" bit, the screw hole gets no toolpath at all. Nothing warns and Start is allowed. The same happens to a 2 x 2 mm pocket next to a large one, a 2.5 mm slot, and the 2 mm neck of a dumbbell-shaped hole. A layer is only reported when every shape in it fails.

This was finding 1.9 in the July audit and is still open.

**Fix.** Check shape by shape. For each layer, count the closed shapes that produced no path and warn, for example: `Operation "Holes": 1 of 3 shapes (3.0 mm) is narrower than the 3.175 mm bit and will not be cut.` Show them in the 3D preview the way Easel shows uncarvable areas in red.

**Evidence.**

- Probe L6 p03: `G1 cutting moves within 3 mm of the 3.0 mm hole centre: 0`, `… within 12 mm of the 20 mm hole centre: 516`, `preflight []`, `grbl errors 0`.
- Probe L2 comp: pocket with a 30 x 30 rect plus a 40 x 2.5 slot, `PARTIAL {"narrowCut":false,"issues":[]}`; dumbbell `neck reached false []`.
- `compile-cnc-diagnostics.ts:17-42` (`findDroppedCncLayers`) checks whole layers only.

**Sources.**

- [Easel: Uncut Areas](https://support.easel.com/hc/en-us/articles/360012763973-Uncut-Areas): "Uncarvable areas are shown in the 3D preview as red areas."
- [Easel: Uncut Areas](https://support.easel.com/hc/en-us/articles/360012763973-Uncut-Areas): "Depending on your bit size, some of your design may not be carvable because the bit is too large to fit into some areas."

### JR-3: Z travel is never checked, and soft limits off is shown as neutral

**Medium** · New · Reproduced

A job 80 mm deep in 90 mm stock on a machine with 75 mm of Z travel spans Z -80 to +3.81, more than the whole axis, and nothing warns. The ordinary case is quieter: thick stock or a long bit puts work Z0 near the top of travel, and each retract to safe Z then drives Z into its stop. With $20=0 (the GRBL default) GRBL does not stop the move, so the motor stalls and every later depth is off by the lost amount. This is a second way to lose position.

X and Y bounds are checked; Z is only an informational fact. The $20 and $22 rows are always shown in neutral tone.

**Fix.** Warn when safe Z minus the deepest Z is more than $132. When the machine is homed and the work offset is known, warn when the offset plus safe Z is above 0 or the offset plus the deepest Z is below -$132. Show $20=0 in warning tone on router jobs.

**Evidence.**

- Probe L6 D2 and D3: no warning for an 83.8 mm Z span with $132=75, or for safe Z 80.
- Out-of-bed covers X and Y only: `cnc-motion-bounds-preflight.ts:13-31`. `zTravelMm` is "(informational, not hardware proof)": `job-review-live-rows.ts:136-144`.
- WCO Z is parsed (`status-parser.ts:139`) but unused. GRBL machine range is [-$13x, 0]: `system.c:334-352`, `limits.c:372-384`. `machine-envelope.ts:20-29` derives Z bounds, but its only caller uses XY.
- With soft limits on, grbl-sim raised ALARM:2 during the rapid to the first cut of a job 16 mm deep with Z0 60 mm down on 75 mm of travel, because GRBL checks each line as it is planned.

**Sources.**

- [GRBL wiki: Configuration ($20)](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Configuration): "Soft limits requires homing to be enabled and accurate axis maximum travel settings, because Grbl needs to know where it is."
- [GRBL wiki: Configuration ($21)](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Configuration): "a hard limit event is considered to be critical event, where steppers immediately stop and will have likely have lost steps."
- [GRBL wiki: Configuration ($130-$132)](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Configuration): "This sets the maximum travel from end to end for each axis in mm."

### JR-4: When helical entry, adaptive or rest planning fails, the whole layer is left out and the message does not say so

**Medium** · New · Reproduced

With Helical entry on, one pocket region that cannot take a helix (a letter O with its island, a Raster pocket, or a pocket smaller than the minimum helix) removes every region of that layer from the output, including regions where the helix fits. The rest of the job runs. Job Review says only "Adjust Helical entry or disable it", and its facts still list "helix entry" for the layer. The checkbox is also offered for Raster pockets, which can never use it.

Adaptive and rest failures behave the same way, and the adaptive text gives the wrong remedy ("Adjust Radial engagement" when the real cause is a V-bit). On a single-layer job the refusal blames bit width and drops the real reason.

**Fix.** Fall back to the ordinary entry for each region where the helix cannot be planned, and say so. Word planner warnings as "… will not be cut: <reason>". Add the layer reasons to the empty-output refusal. For adaptive with a non-end-mill, say "choose an end mill". Hide Helical entry for Raster pockets.

**Evidence.**

- Probe L2 order: `HELIXDROP letter-O 0`, `raster-x 0`, `d5 0`, `island-free rect + letter-O 0` (the rect is lost too); control rect `255`.
- `cnc-helical-pocket-passes.ts:13-18` returns `[]` for raster or any failing bucket; `compile-cnc-layer-passes.ts:189-195` then returns it.
- Probe L6 p11: `cutting moves inside the pocket region: 0`, `start ok=true`. Single layer: `start ok=false` with only the bit-width text (`start-job-readiness.ts:308`).
- Wrong adaptive remedy: `cnc-preflight.ts:128`. `cnc-layer-empty` is skipped by `explicitPocketPlannerHasBasePaths` (`compile-cnc-diagnostics.ts:30`).

### JR-5: No flute length on bits, and no warning for deep passes

**Medium** · New · Confirmed in code

A 40 mm deep profile with a 1/8" end mill, or a single 6 mm pass (1.9 times the bit diameter), gets only generic warnings. A typical 1/8" bit has about 12 mm of flute, so cutting through 18 mm plywood rubs or buries the shank. The app's own tooltip says "Rule of thumb: up to half the bit diameter in wood", but nothing warns when it is exceeded.

**Fix.** Add an optional flute length to the bit (coordinate with the tapered ball-nose work in PR #889) and warn when the depth exceeds it. Warn when depth per pass is more than one bit diameter.

**Evidence.**

- `CncTool` has no flute-length or stickout field: `cnc-tool.ts:7-27`.
- Probe L6 D1: `G1 lines=486 minZ=-40`; K4: `minZ=-6`. Tooltip: `CncLayerAdvancedFields.tsx:96`.

**Sources.**

- [Harvey Performance: End Mill Anatomy](https://www.harveyperformance.com/in-the-loupe/end-mill-anatomy/): "Length of cut (LOC), which is a measurement of the functional cutting depth in the axial direction"
- [Shapeoko CNC A to Z: Feeds and speeds basics](https://shapeokoenthusiasts.gitbook.io/shapeoko-cnc-a-to-z/feeds-and-speeds-basics): "10% to 50% of the endmill diameter for softer materials"

### JR-6: Job Review shows the stored feed and RPM, not what the program sends

**Medium** · Still open · Reproduced

A layer set to feed 7000, plunge 6500 and 20000 RPM on a profile with a 6000 mm/min maximum is sent as F6000 and S12000, but the Job Review rows show 7000, 6500 and 20000. Drill layers always send the lower of feed and plunge, which the rows never show. This was July finding 1.17.

**Fix.** Show the compiled values, with the stored value in a tooltip when they differ.

**Evidence.**

- Probe L6 p08: program `F words: 6000  S words: 12000`; rows (`JobReviewLayerCells.tsx:153-168`) show 7000/6500/20000.
- Drill feed is `min(feed, plunge)`: `compile-cnc-job.ts:417-430`.

### JR-7: Many warnings name an internal layer id and give no outcome or fix

**Medium** · New · Reproduced

About 20 warning templates say "Layer operation-<uuid>" instead of the layer name the table shows. Some say "A layer's feed …" without naming it. "feed 7000 mm/min is outside (0, 6000]" does not say the program was capped at 6000. The V-carve text says a V-bit is required, yet the job runs with an assumed 60 degree angle. Out-of-bed produces up to five raw rows such as "Line 22: Y out of bed: 652.3820000000001" and tells router users to "reduce overscan", a laser term. The unknown-bed warning never says to home the machine.

**Fix.** Use layer names, say what the program will do and how to fix it, and give one summarised out-of-bed message. `cnc-missing-primary-tool-warnings.ts` already does this well and can be the model.

**Evidence.**

- `Layer ${layer.id}` in `cnc-preflight.ts:107-231`, `cnc-tool-geometry.ts:50-144`, `cnc-through-cut-tab-warnings.ts:43,52`, `cnc-default-feed-warnings.ts:30`.
- Unnamed layer: `cnc-machine-limit-warnings.ts:57-95`. V-carve fallback: `vcarve-angle.ts:6-16`.

### JR-8: No warning for a plunge faster than the feed, or an RPM below $31

**Low** · New · Reproduced

Plunge 2000 with feed 800 warns only if $112 is lower. The plunge tooltip itself says "slower than XY feed". An RPM of 5000 with $31=8000 is silently run at the $31 speed.

**Fix.** Add both as Job Review warnings.

**Evidence.**

- Probe L6 H2 and H6. GRBL clamps to minimum PWM: `spindle_control.c:201-207`.

**Sources.**

- [GRBL wiki: Configuration ($31)](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Configuration): "Lower RPM values are accepted by Grbl but the PWM output will not go below 0.02V, except when RPM is zero."

### JR-9: Two override warnings are worded as blocks, and three docs still call ADR-172 a hard block

**Low** · Partly fixed · Confirmed in code

"CNC Start blocks increased or invalid controller overrides" and "CNC Start requires a fresh GRBL override observation" appear under "none block the start". `docs/architecture/05-cnc-chain.md`, `07-frame-permit-model.md` and `09-weakness-register.md` still describe the ADR-172 missing-work-zero check as a hard block; the code and DECISIONS.md made it a warning under ADR-228.

**Fix.** Reword the two messages and update the three documents.

**Evidence.**

- `cnc-accessory-readiness.ts:65-66,75`; comments at `controller-readiness.ts:121-122,130`; `start-job-controller-policy.ts:17-31`.

## Toolpaths

Tabs, cut order, entry moves and what gets cut.

### TP-1: Tabs are measured from the cut floor, so extra depth thins or removes them, and grooves get tab bumps

**High** · New · Reproduced

The tab top is placed at the cut depth minus the tab height, and stock thickness is never used. On 6.35 mm stock with 2 mm tabs:

Cut 0.5 mm into the spoilboard and the tabs are 1.5 mm thick. Cut 2.15 mm in and they sit entirely below the stock, so there are no tabs at all, while the layer still says tabs are on and the "no holding tabs" warning stays silent. The part comes free under the bit.

The same rule adds tabs to any profile deeper than the tab height, even when it does not go through. A 3 mm deep On-path groove in 19 mm stock gets four raised bumps, each about 9 mm long, in its floor.

**Fix.** Measure the tab top from the stock bottom when the cut reaches it, and only add tabs to cuts that reach the stock bottom, as Easel does. Because this relies on the stock thickness being right, keep the existing depth-past-stock warning and have it state the resulting tab thickness. This changes ADR-258, so it is your call.

**Evidence.**

- `cnc-tabs.ts:33-36`: `return -(Math.max(0, depthMm) - height)`; `compile-cnc-layer-passes.ts:291` gates tabs with no stock input.
- My re-run: groove 3 mm in 19 mm stock has a lateral cut level at Z-1 (the tab top); overcut 0.5 puts the tab top at -4.85 (1.5 mm of tab in stock); overcut 2.15 puts it at -6.5, below the -6.35 stock bottom.
- Probe L2 tabs: `overcut 2.15 tabTop -6.5 → 0`; `GROOVE … "windows":[{"z":-1,"len":9.17}×4],"warnings":[]`.

**Sources.**

- [Easel: How To Use Tabs](https://support.easel.com/hc/en-us/articles/360012453214-How-To-Use-Tabs): "Tabs are automatically added by Easel if you set the cut depth of an outline shape to be the same as the thickness of your material."
- [Easel: Additional Depth](https://easel.com/features/additional-depth-cut-throughs): "This is compatible with tabs and will not affect tab position or height."
- [Easel: How To Use Tabs](https://support.easel.com/hc/en-us/articles/360012453214-How-To-Use-Tabs): "When you are cutting out a design entirely from your material, there is a risk that your design will break free and become damaged by the bit."

### TP-2: A hidden laser setting could cut the outline before the pocket

**Medium** · Fixed in PR · Reproduced

If a project had Layer priority set to "Reverse layer order" in laser mode, the setting survived a switch to CNC and save/load, and it reversed operations that share one artwork. On a two-colour SVG with an outline and a pocket, the part was profiled free first and then pocketed, which ADR-310 forbids. The dialog is hidden in CNC mode, so there was no way to see or reset it.

**Fix.** Fixed in the PR: layer priority no longer reorders CNC groups, so the ADR-310 order (all clearing, then all profiles) always holds.

**Evidence.**

- `optimize-paths.ts:90-108` reversed groups sharing a `sourceObjectId`; `prepare-output.ts` applies it to CNC jobs.
- My re-run on one object with a pocket and an outline: default order pocket first; with `reverse-project-order` the outline started at move 9 and the pocket at move 36. With the fix both orders cut the pocket first.
- The CNC command gate hides the setting because "optimizePaths passes kind:'cnc' groups through untouched" (`machine-command-gate.ts:14-17`), which is now true.

### TP-3: Profiles on different layers are not ordered inside-first

**Medium** · New · Reproduced

Inner-before-outer ordering only works inside one layer. With the holes on an inside-profile layer and the outline on an outside-profile layer, the order follows the layer list. If the outline layer is listed first, the part is cut free and the holes are then cut in a part held only by tabs, or loose if tabs are off. Nothing is reported.

**Fix.** In the profile phase, run any profile group whose contours lie inside another group's outside profile first. At minimum, warn and name the pair.

**Evidence.**

- `compile-cnc-job.ts:5-6` promises "Profiles last, inner contours before outer". The order actually comes from `artwork-order.ts:36-49` and `cnc-tool-sections.ts:14-20`; `profile-ordering.ts` orders within one layer.
- Probe L2 order: `[outline, holes] → "outline > holeB > holeA"`, no warning; within one layer `NEST "partBHole > partB > disc > ringHole > ringOuter"` is correct.

### TP-4: Ramp entry falls back to straight plunges, and ramps can descend faster than the plunge rate

**Medium** · New · Reproduced

On open paths (engrave, or open vectors on-path) each pass ramps down from the previous level, and the ramped stretch is never re-cut at level. The next pass then plunges straight down one full pass depth into uncut stock, and the start of an open through-cut line ends one pass shallow. On closed loops shorter than the ramp, the remaining depth after one lap is a vertical plunge.

Ramps also run at the cutting feed. With a wood recipe, where plunge is 0.4 times feed, any ramp steeper than about 24 degrees descends faster than the plunge rate.

**Fix.** Open paths: ramp down and back over the first stretch so every level is completed. Short loops: keep ramping over more laps before the level lap. Cap the ramp's Z rate at the plunge feed, as V-carve moves already are.

**Evidence.**

- Probe L2 ramp-open (engrave 3 mm, 1.5 mm per pass, 10 degrees): `G0 X100.000 Y100.000` then `G1 Z-1.500 F300` straight into uncut stock.
- `motion-polish.ts:196-197` re-cuts closed paths only; `:236-240` short-loop plunge; `:199` ramps built without `lateralFeed`.
- Probe L4 p5: 45 degree ramp, plunge 580, `maxDescentZRate 1018`.

### TP-5: Automatic tabs land on corners and can cover most of a small part

**Low** · New · Reproduced

Automatic tab centres are spaced evenly from a seam at the middle of the longest edge. On a 50 mm square all four tabs straddle corners. On a 10 mm disc the tabs cover 79% of the perimeter with no warning; the coverage warning fires only at 100% and only for a whole layer.

**Fix.** Move automatic tabs onto straight runs longer than the tab, scale the count with the perimeter, and warn above about 50% coverage per shape.

**Evidence.**

- `cnc-tab-ramp.ts:207-212`, `motion-polish.ts:129-152`, `cnc-full-tab-coverage-warnings.ts:16-18`. Probe L2 tabs: square `"spansCorner":true` x4; disc `fractionAtFloor 0.208, warnings []`.

**Sources.**

- [Easel: How To Use Tabs](https://support.easel.com/hc/en-us/articles/360012453214-How-To-Use-Tabs): "We recommend avoiding corners rounded edges; try keeping tabs on smooth, straight sections on your project."

## Feeds and speeds

How feed, plunge, RPM and depth per pass are chosen for each bit.

### FS-1: A secondary bit inherits the primary bit's feed and depth

**High** · Still open · Reproduced

A hardwood V-carve sign with a 90 degree V-bit and a 1/8" end mill clearing the flat floor, 4 mm deep: the end mill gets the V-bit's numbers. It slots the full 4 mm in one pass at F3600 with F1440 plunges. Its own recipe is 960 feed, 380 plunge and 1.3 mm per pass, so that is 3.75 times the chip load and 3 times the depth. Relief finishing does the same: a 1/16" ball-nose gets the 1/4" roughing recipe.

On your 4040 profile the 300 mm/min starter cap hides this for recipes, but values you type for the V-bit are still inherited. The only notice is an advisory in the folded Warnings list saying the values are shared and to verify them. This was flagged as high severity in the 13 July cutting-mechanics audit (section 14.5) and is still open.

**Fix.** For a material-recipe layer, compute each secondary bit's feed, plunge and depth per pass from that bit; `calculateFeeds` already takes the diameter. For typed values, have the advisory state the chip load and depth-to-diameter ratio against the chart for the secondary bit.

**Evidence.**

- `compile-cnc-operation-groups.ts:218-236` builds the clearing group from the layer's `settings` (`{ ...settings, cutType: 'pocket' }`) and its `depthPerPassMm`. Same for relief finishing: `compile-cnc-relief.ts:145-147,228-237`.
- Probe L4 p3: `group cutType=pocket tool=em-3175 D=3.175 feed=3600 plunge=1440 rpm=12000 depthPerPass=5.1… passZ levels=-4.000`.
- The saved program says `; cnc feed-source: material-recipe` over the V-bit's numbers for the end mill (`L4-p3-vcarve-clear.nc:12-23`).

**Sources.**

- [Harvey Performance: Speeds and Feeds 101](https://www.harveyperformance.com/in-the-loupe/speeds-and-feeds-101/): "A chip load that is too large can pack up chips in the cutter, causing poor chip evacuation and eventual breakage."
- [Shapeoko CNC A to Z: Feeds and speeds basics](https://shapeokoenthusiasts.gitbook.io/shapeoko-cnc-a-to-z/feeds-and-speeds-basics): "10% to 50% of the endmill diameter for softer materials"

### FS-2: On your 4040 profile every recipe is capped at 300 mm/min with the spindle at 12,000 RPM

**High** · New · Reproduced

The Neotronics starter is scoped to a 1/8" two-flute bit in wood or MDF, but its 300 mm/min feed is applied as a ceiling to every material and every bit from 1/16" to 1/2". RPM stays at 12,000, so the chip load is 0.0125 mm per tooth: a fifth of the chart value for 1/8" in MDF and half the 0.0254 mm floor the Shapeoko guide gives. The bit rubs instead of cutting, which dulls it and burns wood; in acrylic it melts the edge.

The calculator row shows the chart chip load ("chart chipload 0.100 mm: machine-aware feed 300") and Job Review says "Hardwood recipe", so nothing shows the real 0.0125. The starter itself is labelled "Unverified cutting starter: retained legacy values … no attributable physical cutting record is attached."

**Fix.** Apply the starter ceiling only when the bit and material match its scope. When any ceiling lowers the feed, lower RPM in proportion, down to a spindle minimum, so the chip load holds. Show the achieved chip load in the calculator and Job Review, and warn below about 0.025 mm. The Settings audit owns the 300 mm/min value itself.

**Evidence.**

- `resolve-cnc-auto-settings.ts:145-154`: `materialFeedCeiling` takes the lesser of the profile max, live caps and the starter feed, for any bit and material. RPM: `:132-143`.
- Starter scope and notice: `cnc-machine-starter-catalog.ts:53-100`.
- Probe L4 p6 (real component): `3.175 mm (1/8") end mill at 12,000 RPM → chart chipload 0.060 mm: machine-aware feed 300, plunge 120 mm/min, 0.75 mm/pass`, applied `achievedChipMmPerTooth 0.0125`.

**Sources.**

- [Shapeoko CNC A to Z: Feeds and speeds basics](https://shapeokoenthusiasts.gitbook.io/shapeoko-cnc-a-to-z/feeds-and-speeds-basics): "a value of 0.001'' (0.0254mm) is a good absolute lower limit guideline"
- [Shapeoko CNC A to Z: Feeds and speeds basics](https://shapeokoenthusiasts.gitbook.io/shapeoko-cnc-a-to-z/feeds-and-speeds-basics): "instead of slicing into the material, the cutting edges will mostly rub against the surface, and then 'heat happens' and this is very bad for the quality of the cut and for tool life"
- [Harvey Performance: Speeds and Feeds 101](https://www.harveyperformance.com/in-the-loupe/speeds-and-feeds-101/): "A chip load that is too small can cause rubbing, chatter, tool deflection, and a poor overall cutting action."

### FS-3: New layers on your 4040 profile get the 1/8" bit whatever the Active bit is

**Medium** · New · Reproduced

With the Active bit set to a 1/4" end mill, a new layer still gets the 1/8" starter bit at 300/250/12000/0.75. Job Review's "Active bit" row shows 1/4" while the layers table and the program header say 1/8". Start does warn when work Z was set with a different bit, but if you load the Active bit the outline ends up 1.59 mm off per side.

**Fix.** Seed the starter only when the layer's bit is the starter's bit. Otherwise seed the material recipe for the Active bit.

**Evidence.**

- `resolve-cnc-auto-settings.ts:63-88` returns `toolId: starter.tool.toolId` and never reads `machine.toolId`.
- Probe L4 p7(a): `job default toolId em-6350` then `fresh layer {"toolId":"em-3175","feed":300,…}`.
- Mitigation: `cnc-start-advisories.ts` warns "This job starts with X, but work Z was established for Y".

### FS-4: Nothing checks the commanded chip load or depth against the bit that cuts

**Medium** · Still open · Reproduced

Pasting a 1/4" MDF layer's settings onto a 1/16" layer gives the small bit 2640 mm/min (1.8 times its chart value) and 3.2 mm per pass (twice its diameter), with no notice. Feed presets apply to any layer. Surfacing runs 2500 feed and 600 plunge at the machine's maximum RPM whatever bit is fitted; that last part was July finding 2.1.

**Fix.** Add one Job Review advisory per CNC group comparing feed / (RPM x flutes) and depth per pass / diameter with the chart for that group's bit. It also backstops FS-1 and FS-2. Give surfacing its own RPM field.

**Evidence.**

- Probe L4 p7(b): after paste `{"toolId":"em-1588","feed":2640,"plunge":1060,"rpm":12000,"doc":3.2}`.
- Retained-feeds check only fires on a bit change: `cnc-bit-change-advisory.ts:48-66`. Surfacing: `save-surfacing-program.ts:68-70` uses `spindleMaxRpm`.

**Sources.**

- [Harvey Performance: Speeds and Feeds 101](https://www.harveyperformance.com/in-the-loupe/speeds-and-feeds-101/): "A chip load that is too large can pack up chips in the cutter, causing poor chip evacuation and eventual breakage."

### FS-5: The chip-load chart jumps at band edges

**Medium** · New · Reproduced

Chip load is looked up in bands at 1.5, 3.175 and 6.35 mm. A 1/8" bit entered as its measured 3.18 mm gets the 1/4" values, taking hardwood feed from 960 to 2400 mm/min. The 4 mm and 3/16" bits get 1/4" values, and a 1/16" bit gets the 1/8" value, 1.5 times the Shapeoko guide's 1/16" maximum in MDF.

**Fix.** Interpolate chip load between chart diameters.

**Evidence.**

- `feeds-calculator.ts:42,79-84`. Probe L4 p1, hardwood at 12k: 1.5 → 480, 1.51 → 960, 3.175 → 960, 3.18 → 2400, 6.36 → 3600.

**Sources.**

- [Shapeoko CNC A to Z: Feeds and speeds basics](https://shapeokoenthusiasts.gitbook.io/shapeoko-cnc-a-to-z/feeds-and-speeds-basics): "10% to 50% of the endmill diameter for softer materials"

### FS-6: Chip thinning and effective diameter are not modelled

**Low** · Still open · Confirmed in code

Adaptive clearing engages 10% of the bit but keeps the slotting feed, so the real chip is about 0.6 of the chart value (0.0075 mm on your 4040). V-bits are banded by their full 12.7 mm body, not the width they cut at the programmed depth. This is disclosed by an advisory and was open in the July audits.

**Fix.** Apply a capped radial chip-thinning factor to adaptive and light-stepover groups, and band V-bits and ball-noses by their diameter at depth.

**Evidence.**

- `adaptive-pocket-operation.ts:25,30`; `cnc-angled-tool-feed-advisory.ts`.

**Sources.**

- [Harvey Performance: Combat Chip Thinning](https://www.harveyperformance.com/in-the-loupe/combat-chip-thinning/): "Once the RDOC falls below 50% of the cutter diameter"

### FS-7: Automatic feeds depend on whether a controller happened to be connected

**Low** · New · Reproduced

While a controller reports $110/$111=1000 and $112=400, any machine edit rewrites every automatic layer to those caps; after disconnecting, the same edit gives 1440/580. Automatic RPM also only goes down: lowering spindle max to 10000 and raising it to 24000 leaves the layers at 10000.

**Fix.** Recompute only on edits that change the recipe, leave live caps to the Job Review warnings, and request the recipe's nominal RPM.

**Evidence.**

- Probe L4 p9 and p7(c). The comment at `cnc-live-caps-actions.ts:4-5` says it "never rewrites an existing layer". RPM request: `cnc-auto-seeding.ts:123`.

### FS-8: Depth per pass carried float noise into the G-code

**Low** · Fixed in PR · Reproduced

Depth per pass was rounded with `Math.round(x / 0.1) * 0.1`, which wrote values such as `5.1000000000000005` into G-code comments and advisory text.

**Fix.** Fixed in the PR: the calculator divides by a whole step count, and a test pins clean 0.1 mm values.

**Evidence.**

- `feeds-calculator.ts:114-116`; `L4-p3-vcarve-clear.nc:16`: `per-pass-mm: 5.1000000000000005`.

### FS-9: CNC machine presets cannot set a maximum feed

**Low** · Still open · Confirmed in code

Picking a router preset leaves the profile's max feed at the 6000 mm/min diode-laser default. GRBL clamps to its own $110/$111, so this only makes the offline ceiling and estimate optimistic. July finding 2.3.

**Fix.** Add an optional max feed to `CncMachinePreset`.

**Evidence.**

- `cnc-machine-catalog.ts:3-21` has no feed field.

## G-code and GRBL

What the emitted program does on real GRBL 1.1h.

### GC-1: Helical pocket entries often ran as straight plunges on GRBL 1.1h

**Medium** · Fixed in PR · Reproduced

Each helix revolution was written as one arc that ends where it starts. GRBL 1.1h rebuilds the arc centre in single precision and treats such an arc as a full circle only if the computed angle is within 5e-7 radians of zero. At bed coordinates of a few hundred millimetres the rounding is larger than that for small helices, and when it falls the wrong way GRBL runs the revolution as a zero-length arc: one straight line. All revolutions of a helix round the same way, so the whole helix becomes a straight plunge through the pass depth, exactly what Helical entry is for avoiding. Preview and estimate showed a helix. Rectangles aligned with the axes were immune, which is why the July acceptance test missed it.

**Fix.** Fixed in the PR: each revolution is written as two half-circle arcs, which cannot be mistaken for a zero-length arc. Both halves share one exact centre.

**Evidence.**

- Example from the emitted corpus: `G3 X232.609 Y247.720 Z-0.667 I2.855 J0.921 F300`. My own float32 recomputation gives 2.119e-6 rad, above the 5e-7 limit, so it collapses; the lanes got the same value.
- Traced GRBL build: 54 of 117 revolutions collapsed on a circular pocket, 66 of 66 on a rectangle rotated 30 degrees, 0 on an axis-aligned rectangle. Random sweep: 978 of 3000 small helices.
- Timed in GRBL's own planner: a revolution that should take 1.26 s took 0.0425 s.
- After the fix: 0 of 570 arcs collapsed across three pockets in the traced build, and 0 GRBL errors.
- grblHAL computes the centre in double precision and is not affected.

**Sources.**

- [GRBL config.h](https://github.com/gnea/grbl/blob/master/grbl/config.h): "Offset-based arcs are much more accurate but still have a problem when arcs are full-circles (2*pi)."
- [GRBL motion_control.c](https://github.com/gnea/grbl/blob/master/grbl/motion_control.c): "float center_axis0 = position[axis_0] + offset[axis_0];"
- [GRBL wiki: FAQ](https://github.com/gnea/grbl/wiki/Frequently-Asked-Questions): "It is good practice to separate all of your arc motions into 90 or 180 degree motions."

### GC-2: Saved files carried bytes that GRBL runs as realtime commands

**Low** · Fixed in PR · Confirmed in code

GRBL acts on every byte above 0x7F the moment it arrives, before the line is parsed, even inside a comment. Saved files had UTF-8 text in comments: `Default 400×400` contains 0x97 (rapid override to 25%), a starter V-bit name with "—" contains 0x94 (feed override -1%), and a profile named with "Ä" would send 0x84 (safety door, job holds). KerfDesk's own streamer skips comment lines, but GRBL's reference streamers send them.

**Fix.** Fixed in the PR: every written comment value is folded to printable ASCII (× to x, degree sign to deg, dashes to -, accents dropped, anything else to ?), including the laser image header.

**Evidence.**

- Corpus: `c36-surfacing.nc:6`, `c20-multitool-rpm-change.nc:46,60`, `c35-header-metadata.nc:6`.
- Every user label passes through `sanitizeGcodeCommentValue` (`gcode-comments.ts`); the raster header wrote a literal × (`emit-raster.ts:392`).
- KerfDesk already refuses non-ASCII in queued lines (`serial-wire-encoding.ts`) and in user macros.

**Sources.**

- [GRBL serial.c](https://github.com/gnea/grbl/blob/master/grbl/serial.c): "Real-time control characters are extended ACSII only."

### GC-3: Small formatting gaps: negative zero, a zero dwell, and the safety scan

**Low** · New · Confirmed in code

Coordinates can be written as `-0.000`, and the emitter compares formatted text to decide "same position", so `-0.000` and `0.000` count as different places (usually just an extra retract). A spin-up under 0.0005 s writes `G4 P0.000`, and a comment claims preflight rejects a zero spin-up when it accepts it.

The post-emit safety scan also has gaps. It checks a diagonal `G0 X Y Z` against the target Z, so a rapid that starts buried in the stock passes. It ignores G91, arc Z, `G0 Z -2` with a space, and spindle words written as `M03` or `M3S12000`, and it keeps the last Z across an M0 tool change. KerfDesk's own output never does any of these, so this is defence in depth.

**Fix.** Normalise `-0.000` to `0.000`; round the dwell up to 0.001 s or drop it and fix the comment; check `min(modalZ, targetZ)` for rapids that carry Z; track G90/G91, G20/G21 and arc Z; forget Z at M0.

**Evidence.**

- `cnc-output-precision.ts:22-24`; comparisons at `cnc-grbl-strategy.ts:251,417,450`; `c37-tile-1.nc:178 G1 X-0.000`.
- `cnc-motion.ts:38` skips arcs; `:74` matches `/^M3\b/`; `:101-114` uses `targetZ ?? modalZ`. Probe L2: `INVARIANT diagonal G0 XYZ out of a buried bit []`.

## V-carve, inlay and other strategies

V-carve, inlay, adaptive, rest machining, drilling and relief.

### AC-1: Straight inlay plugs could not seat at any inside corner

**High** · Fixed in PR · Reproduced

An inlay pair on a shape with an inside corner (an L, a T, most letters, a star) produced a plug that would not go in. The insert is cut by an outside profile, so its inside corners keep a fillet the size of the bit radius, while the pocket kept those corners sharp. At a 90 degree corner the fillet stands r(1 - 1/sqrt 2) proud of the pocket wall, less the fit allowance: 0.36 mm with a 1/8" bit and the default 0.1 mm allowance, 0.83 mm with a 1/4" bit. Squares, circles and other shapes without inside corners fitted, and a 30 mm square is what the July acceptance run used.

**Fix.** Fixed in the PR: the shared contour is now rounded by the bit radius at inside corners as well as outside corners, so pocket and plug have the same corners and the allowance is a real gap all the way round. Shapes or holes closer together than the bit diameter now merge in both halves, because the insert profile cannot cut between them either.

**Evidence.**

- `inlay-pair.ts:86-89` built the shared contour with an opening only (offset by -r, then +r). That rounds outside corners and leaves inside corners sharp.
- Lane probe on an L with a 3.175 mm bit: plug material 0.3585 mm inside the pocket wall at 0.1 mm allowance, 0.1585 mm at 0.3 mm, none at 0.5 mm. A square control fitted with exactly 0.2 mm total clearance.
- New regression test measures the shapes the bits actually cut, not the plan: 26 (1/8" bit) and 177 (1/4" bit) sample points of plug outside the pocket before the fix, 0 after.

**Sources.**

- [Carveco Help Centre: Inlays](https://support.carveco.com/hc/en-gb/articles/19574903302172-Toolpaths-and-Machining-Inlays): "Automatically adds corner radii to avoid sharp edge misfits."
- [Carveco Help Centre: Inlays](https://support.carveco.com/hc/en-gb/articles/19574903302172-Toolpaths-and-Machining-Inlays): "Rounded corners make male part fitting easier and more reliable."

### AC-2: Adaptive clearing refuses ordinary rectangles, and the pocket is left out of the job

**High** · New · Reproduced

At the default radial engagement (10% of the bit), adaptive clearing refuses every pocket that is not a square or a circle: rectangles from 33 x 30 mm up, a rounded rectangle and an ellipse, with both 1/8" and 1/4" end mills. 25% and 40% are refused too. The cause is the first ring. Rings are spaced at half the engagement, so the innermost ring of a rectangle is a thin line along its middle, and cutting that line from the entry helix is a full-width slot, which the plan check rightly rejects.

A refused layer compiles to nothing while the rest of the job runs, so a board with an adaptive pocket and an outside profile is cut out with no pocket (see JR-4). The warning suggests adjusting Radial engagement, which does not help below 50%, and 50% brings its own problem (AC-6).

**Fix.** Grow the first ring outward from the entry helix in a spiral instead of slotting the centre line, so the engagement limit holds from the first move. Until then, word the warning as "this pocket will not be cut" and point to the Offset fill, which cuts it.

**Evidence.**

- Lane probe, 45 x 30 mm rectangle: the plan check rejects it with a 180 degree contact on the first ring, which measures 15.16 x 0.15 mm. A 30 x 30 mm square passes.
- Two-layer probe: the compiled job contains only the outside profile; `cnc-adaptive-clearing-invalid` is a Job Review warning, not a refusal (`start-job-readiness.ts:307,344`).
- `adaptive-pocket-sequences.ts:49` spaces the levels at load / 2; `adaptive-pocket-operation.ts:117` returns no passes when the check fails.

**Sources.**

- [Autodesk Fusion: 3D Adaptive Clearing](https://help.autodesk.com/view/fusion360/ENU/?guid=GUID09E44604-DAD8-47D6-ADC6-C100869DE724): "It is unique in that it guarantees a maximum tool load at all stages of the machining cycle"

### AC-3: Relief roughing cuts into steep walls, and the finish allowance is left only on floors

**High** · Still open · Reproduced

Relief roughing samples the model on a grid one eighth of the bit diameter wide and follows contours between the samples, so beside a steep or vertical wall the cutter can cross up to one cell into the part. On raised lettering with vertical walls a 1/4" end mill cut up to 0.87 mm into the walls below their tops, and a 1/8" end mill 0.58 mm. The 0.5 mm finish allowance is added only in Z, so it gives the walls no protection, and finishing cannot put material back. Ball finishing also gouged the foot of a 12 mm dome by 0.10 to 0.17 mm.

ADR-289 already says roughing contour points are "not certified" and that those limits "remain informational", but Job Review tells the operator nothing.

**Fix.** Leave the allowance sideways as well as down (grow the tool footprint by the allowance), treat each sample as its whole cell when deciding where roughing may go, and meanwhile add a Job Review note giving the sampling resolution.

**Evidence.**

- `heightmap-tool-offset.ts:97` (`Math.min(0, safe + allowanceMm)`) adds the allowance in Z only.
- Roughing cell is D/8 (`compile-cnc-relief.ts:48,277`); contours follow marching-squares midpoints (`relief-roughing.ts:36,75-76`).
- Lane probe on exact height maps: wall intrusion 0.8729 mm (6.35 mm end mill) and 0.5838 mm (3.175 mm); dome finishing clearance -0.10072 mm (3.175 mm ball) and -0.17344 mm (6.35 mm ball).

**Sources.**

- [Autodesk Fusion: Stock to Leave](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/GUID998628B4-233F-4BC3-BB35-D7CF196B1E91.htm): "The amount to leave perpendicular to the tool axis, ie. on the walls of the part."

### AC-4: A V-carve flat depth deeper than the bit can reach is capped without a word

**Medium** · New · Reproduced

With Flat depth on, a depth deeper than the V-bit's cone is cut only to the cone height, in both the V-bit and the clearing passes. For example 5 mm with a 1/4" 90 degree bit, whose cone is 3.175 mm tall, gives a floor at 3.175 mm. Job Review's Cut depth still shows 5 and there is no warning; only a comment inside the G-code says 3.175. Several starter V-bits have short cones: about 1.5 mm on the 1/8" and 3 mm 90 degree bits and 2.75 mm on the 1/8" 60 degree bit.

**Fix.** Show the compiled depth in the Cut depth cell whenever it is shallower than requested, and add one warning such as "This V-bit reaches only 3.18 mm, so the flat floor will be there".

**Evidence.**

- Lane probe: requested 5 mm, deepest move -3.175 in both the pocket and V-carve groups, 0 Job Review warnings. The G-code says `; cnc depth: requested-mm: 5.000; per-pass-mm: 2.000; emitted-max-mm: 3.175`.
- `JobReviewLayerCells.tsx:136` shows the compiled depth only when Flat depth is off.

### AC-5: Tile registration holes can land on the finished face or off the board, and tile files do not say where to re-zero

**Medium** · New · Reproduced

Seam dowel holes go at fixed 25% and 75% points along each tile rectangle, whatever the artwork or stock. Tiling a 300 x 120 mm board with a pocket across the seam put one 6 mm hole on the sign face, 6.6 mm from the pocket, and the other 13.4 mm outside the board outline, where it drills air on a board-sized blank. A second probe put a hole 8.4 mm past the board edge, where clamps sit. Either way one dowel is left, and one dowel cannot stop the stock turning. No warning appears.

Nothing tells the operator where to re-zero for the next tile either. Each tile has its own zero at its own corner, the file says only `; tile: row 1, column 2`, and the toast says "re-registering the stock between tiles". The step, the slide direction and the hole centres are not given.

**Fix.** Place seam holes along the seam inside the stock and clear of every cut, warn when a hole leaves the stock, and give each tile file a header with its zero relative to tile 1, the slide direction and the hole centres.

**Evidence.**

- `tile-registration.ts:15,73-90` (`REGISTRATION_HOLE_EDGE_FRACTIONS = [0.25, 0.75]`); tile rectangles are not clipped to the job.
- Lane probe, 180 mm tiles with 20 mm overlap: holes at stock (218.41, 173.41) and (218.41, 263.41); the board spans machine Y 130 to 250.
- Lane probe, 310 x 130 mm sign on a 330 x 150 mm board with 200 mm tiles: a hole at bed (208.4, 398.4), off the stock, with `tileAdvisories: []`.
- `tile-emission.ts:93`, `save-tiled-gcode.ts:100`; tiles are shifted to their own corner (`tile-plan.ts:1-8`).

### AC-6: The adaptive engagement check under-reads, and at 50% it lets a full-width slot through

**Medium** · Still open · Confirmed in code

The adaptive plan check turns the measured contact angle into an engagement with the formula for a symmetric chord. For a side cut that reads about a quarter of the true engagement at small angles, and it tops out at the bit radius even for a full slot. Plans it accepted at the default 10% setting reached 52 to 71 degrees of contact, the equivalent of 19 to 34% of the diameter. At 50%, the only setting at which rectangles pass (AC-2), a 45 x 30 mm pocket ships a full-width slot on every level with no warning. The July audit (1.6) found the saturation; the under-reading is new.

**Fix.** Compare the measured contact angle with acos(1 - load / radius), or report radius x (1 - cos angle), so a slot reads as the full diameter.

**Evidence.**

- `adaptive-pocket-verifier.ts:176` returns `toolRadiusMm * (1 - Math.cos(span / 2))`; the tolerance is one cell times sqrt 2 (`:74-75`).
- Lane probe, circle of radius 15 mm: the check measured 84 degrees; an independent sweep found 67 degrees on the plan and 71 on the G-code.
- At 50%: 1530 lines, 0 GRBL errors, no preflight issue, and 13.74 mm of full-width slot on level 1 starting at line 36.

**Sources.**

- [Autodesk Fusion: 3D Adaptive Clearing](https://help.autodesk.com/view/fusion360/ENU/?guid=GUID09E44604-DAD8-47D6-ADC6-C100869DE724): "The maximum amount of engagement the Adaptive toolpath should maintain. This can be considered the stepover amount"

### AC-7: Surfacing accepts a stepover above 100% and leaves uncut strips

**Low** · New · Reproduced

The Surfacing stepover field has no upper limit. At 150% with a 25.4 mm bit the rows are 38.1 mm apart, leaving 12.7 mm strips uncut, with no warning.

**Fix.** Cap the stepover below 100% or warn above it.

**Evidence.**

- `SurfacingPanel.tsx:117` (`positiveOnly`); `surfacing.ts:171` checks only that it is positive. Lane probe: `max row gap 38.100 mm`, 0 GRBL errors.

### AC-8: The drill cycle drills one bit-sized hole for any shape, and moves through air at plunge feed

**Low** · New · Reproduced

A Drill layer on a 10 mm circle with a 1/8" end mill drills one 3.175 mm hole at the circle's centre. The tutorial explains this, but Job Review gives no hint. Every peck retracts to Z0 and comes back down at the plunge feed, about 36 mm of feed move through air per 10 mm hole, roughly 7 seconds a hole at 300 mm/min.

**Fix.** Warn when the drawn shape is much larger than the bit. Retract with G0 and return with G0 to 0.25 mm above the previous peck, as G83 does.

**Evidence.**

- Lane probe: `G1 ... Z-3.000 F300`, `G1 ... Z0.000`, `G1 ... Z-6.000` and so on to Z-10.000, all at F300.

**Sources.**

- [LinuxCNC G-code reference: G83](https://linuxcnc.org/docs/html/gcode/g-code.html): "Rapid move back out to the retract plane specified by the R word."
- [LinuxCNC G-code reference: G83](https://linuxcnc.org/docs/html/gcode/g-code.html): "Rapid move back down to the current hole bottom, less .010 of an inch or 0.254 mm."

### AC-9: An inlay pair's pocket depth, fit allowance and spacing are hidden behind Advanced

**Low** · Still open · Confirmed in code

"Inlay pair" is in the always-visible Cut type list, and Basic view relabels Cut depth as "Insert depth", but pocket depth, fit allowance and pair spacing only appear with Advanced on. Otherwise they silently default to min(3, depth) and 0.1 mm per side. July finding 3.7.

**Fix.** Show the inlay fields next to the depth field in Basic view; the component already hides itself for other cut types.

**Evidence.**

- `CncInlayFields` is rendered only from `CncLayerAdvancedFields.tsx:29`.

## Machine control

Tool changes, pause, stop, resume, probing and Frame on a router.

### MC-1: With laser mode on, Resume drags a stopped bit through the cut, while KerfDesk says it waits for speed

**Critical** · New · Reproduced

CNC Pause sends GRBL's safety-door byte, which stops motion with the bit still in the cut and switches the spindle off. On Resume, GRBL normally restarts the spindle and waits 4 seconds before moving. With $32=1 it skips both: the spindle power returns in the same instant motion restarts, so a stopped bit is pushed through the material at cutting feed. That can snap the bit, or stall the steppers and lose position.

KerfDesk's Resume advisory says the opposite: "Resume restarts the spindle, waits for it to reach speed, then continues the same line". That is only true at $32=0. A hardware feed hold and resume behaves the same way at $32=1.

**Fix.** When $32 is not verified as 0, change the Resume advisory to say motion restarts with no spin-up and recommend Abort plus pass recovery instead. Fix the $32 setting itself through JR-1. At $32=0, state GRBL's fixed 4 second delay and warn when the configured spin-up is longer than 4 seconds.

**Evidence.**

- Real GRBL 1.1h under grbl-sim, pause then resume mid-cut. $32=0: `Door:0` → `Door:3` with `FS:0,12000` for 4.02 s, then Run. $32=1: no Door:3 phase, first report `<Run|MPos:15.284,5.000,-1.000|FS:300,12000`, `spindleOnBeforeMotionSeconds: 0`.
- GRBL `protocol.c` safety-door restore: in laser mode it only flags a PWM update "to turn on laser when cycle starts"; the `delay_sec(SAFETY_DOOR_SPINDLE_DELAY, …)` branch runs only without laser mode. Same pattern for the spindle-stop override restore. `config.h:179` sets the delay to 4.0 s.
- KerfDesk text: `cnc-pause-resume-policy.ts:9-12`; timing assumptions in `laser-job-pause-resume.ts:85-91,138-143` and ADR-180 Amendment 2.
- grblHAL does the same ("When in laser mode, ignore spindle spin-up delay", `spindle_control.c`).

**Sources.**

- [GRBL protocol.c](https://github.com/gnea/grbl/blob/master/grbl/protocol.c): "When in laser mode, ignore spindle spin-up delay. Set to turn on laser when cycle starts."
- [GRBL wiki: Laser Mode](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Laser-Mode): "If you switch back from laser mode to a spindle for milling, you MUST disable laser mode by sending Grbl a $32=0 command."

### MC-2: Touch-off probing never checks that the probe circuit works

**High** · Still open · Confirmed in code

If the clip is forgotten, falls off or has a broken lead, the touch-off move `G38.2 Z-25 F150` drives the bit into the plate for the rest of its 25 mm and only then raises ALARM:5. A V-bit tip or a 1/8" end mill can break, Z can stall and lose steps, and the plate or stock gets dented. Corner probing starts with the same Z move.

GRBL reports the probe input live, and KerfDesk parses it, but the Probe panel never shows it. The panel only says "clip the probe lead to the bit". gSender asks for a continuity check before every probe.

**Fix.** Show the live probe input in the Probe panel and prompt the operator to touch the plate to the bit and see it light before Run. This is a prompt, not a new refusal.

**Evidence.**

- `probe.ts:108-111` builds `G91`, `G38.2 Z-25.000 F150`. Checks before Run are only Idle and spindle-off: `laser-probe-policy.ts:27-33,136-150`.
- `status-parser.ts:278` parses `Pn:P`; the UI reads only `pins.door` (`LiveMotionBar.tsx:157`).
- GRBL raises ALARM:4 only if the input is already triggered and ALARM:5 only after the whole move: `motion_control.c:272-274,296-298`.
- Open since the 13 July probing audit, sections 8.1 and 10.4.

**Sources.**

- [Sienci: LongMill touch plate](https://resources.sienci.com/view/lmk2-touch-plate/): "gSender will prompt you to check for continuity before starting the process, to ensure your probe has the proper connection."

### MC-3: After an Abort during a cut, pass recovery still offers "Position retained"

**Medium** · Fixed (ADR-215 Amendment 1) · Reproduced

Abort sends a soft reset. If the machine is moving, GRBL kills the steppers at speed and raises ALARM:3, "Position has likely been lost". KerfDesk records this as an ordinary cancel. With a stored G54 origin and a touch-plate Z, the work offset survives the reset, so the operator can tick "Position retained … the work offset matches" and recut a pass that is now offset by the lost steps. KerfDesk's own alarm table says ALARM:3 means "Position is lost … Re-home".

**Fix.** Record a position-lost alarm raised by the stop and have the retained-position check refuse it, as it already does for a reboot. Better still, have CNC Abort send the door byte, wait briefly for the hold, then reset; in the sim that ends with no alarm and the position kept.

**Status (2026-09-26).** Fixed by ADR-215 Amendment 1. Every reset KerfDesk sends against a running job (Abort, the fail-dark stop, the automatic stop after a rejected line) records whether it reached a moving machine, a run stopped by a position-losing alarm (such as a hard limit) is recorded the same way, and the retained-position check refuses both. Sending the door byte before the reset remains a follow-up.

**Evidence.**

- grbl-sim "abort while cutting": `ALARM:3`, then `[G54:1.000,2.000,3.000]` kept and `[G92:0.000,0.000,0.000]` cleared. "Abort after Door:0": no alarm.
- Abort is a bare 0x18: `laser-job-actions.ts:306`; recorded as `cancelled`: `checkpoint-interruption.ts:43`; `retainedPositionIssue` refuses only a reboot or a changed offset: `cnc-pass-recovery-review.ts:60-75`.
- Checklist wording: `CncPassRecoveryChecklist.tsx:55`; alarm text: `alarm-codes.ts:36-41`.

**Sources.**

- [GRBL motion_control.c](https://github.com/gnea/grbl/blob/master/grbl/motion_control.c): "Force kill steppers. Position has likely been lost."
- [GRBL wiki: Commands](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands): "If reset while in motion, Grbl will throw an alarm to indicate position may be lost"

### MC-4: The tool-change stop leaves the bit 3.81 mm above the stock

**Low** · New · Confirmed in code

At a tool change the program retracts to safe Z (3.81 mm), parks and pauses. The message says to load the bit and re-zero but not to raise Z first, and Z jog is click-only in steps of at most 5 mm, so there is little room to swap a bit.

**Fix.** Add "jog Z up for clearance" to the message, or add a tool-change lift height (a machine-coordinate G53 move only when the machine is homed).

**Evidence.**

- `cnc-grbl-transitions.ts:81-92`; `machine.ts:272` (`safeZMm: 3.81`); `JobRunControls.tsx:17`.

### MC-5: Z jog is too coarse for a paper touch-off

**Low** · New · Confirmed in code

The smallest jog step is 0.1 mm and Z jog is click-only at 600 mm/min. A 0.1 mm error in Z zero changes the width of a 60 degree V-carve line by about 0.12 mm.

**Fix.** Add 0.01 and 0.05 mm steps for CNC.

**Evidence.**

- `FocusJogControls.tsx:4`; `JogPad.tsx:31,47`.

### MC-6: The in-repo GRBL test model gets the door and reset behaviour wrong

**Low** · New · Confirmed in code

The test fixture reports `Door:1`, resumes straight to Run with no 4 second phase, ignores $32, and raises ALARM:3 on any reset with pending motion, even after a completed hold. Real GRBL goes Door:0, Door:3 (4 s), Run, and raises no alarm after Door:0. So no test can catch MC-1 or check a door-then-reset stop.

**Fix.** Model Door:0 and Door:3 with the delay keyed on $32, and raise the alarm only while a cycle or hold is executing.

**Evidence.**

- `src/__fixtures__/controllers/grbl-sim-machine.ts:147-155,189-196,199-224`.

### MC-7: A park position cannot be cleared back to "none"

**Low** · Still open · Confirmed in code

Park X and Park Y show an unset park as 0 and have no clear button, so typing a value and then 0 leaves a park at X0 Y0 instead of none. With no park, a job started from the current position parks back at its own start. With 0, 0 it rapids to work zero at the end and at every tool change, which on a machine without homing looks like an uncommanded homing move. July finding 3.6.

**Fix.** Use the existing clearable number field for Park X and Y, as Ramp angle already does.

**Evidence.**

- `DeviceSetupCncMachineStep.tsx:116,125` (`parkXMm ?? 0`); `parkTarget` in `cnc-grbl-transitions.ts` falls back to the job start only when both are unset.

## Placement and zero

Where the job lands on the machine and how zero is set.

### CO-1: The park position is not moved with the job, so bit-change and end parks can run past the end of travel

**High** · New · Reproduced

At every bit change and at the end of the job the program parks with `G0 X Y` using the Machine Setup park numbers as they are, while the cuts are shifted to wherever you set zero. With zero set at bed (150, 100) and a park of X0 Y380, the bit-change park lands at bed (150, 480), 80 mm past the back of a 400 mm bed. On a homed machine in Absolute mode an unset park goes to machine 0,0, exactly where the homing switches trip, although the code comment says it parks "at the front for bit access".

Stock GRBL ships with soft and hard limits off, so the carriage drives into the end of travel during the bit change and loses steps, and every cut after the change is shifted. Job Review shows only an "out of bed" advisory and labels the park "Machine origin". This is a candidate for the 4040's lost position if that job changed bits with a park set.

**Fix.** Decide which frame the park is in and say so in Machine Setup. The consistent rule is that a park is a bed position, moved with the job like every cut, with the job start used instead when zero's bed position is unknown. On homed machines a machine-coordinate park (G53) is the robust alternative. Keep the out-of-bed advisory.

**Evidence.**

- `translateCncGroup` (`job-origin.ts:233-238`) moves the passes but not `parkXMm`/`parkYMm`; the park is written at `cnc-grbl-transitions.ts:86` and `cnc-grbl-strategy.ts:166-167`.
- Lane probe, two-bit job, park X0 Y380, User Origin with zero at bed (150, 100): `G0 X0.000 Y380.000` at the bit change and the advisory `out-of-bed: Line 60: Y out of bed: 480`.
- Lane probe, homed stock GRBL in Absolute mode, park unset: both parks are `G0 X0.000 Y0.000` (machine 0,0), preflight returns nothing, and Job Review shows "Park after job: Machine origin".
- A park field that was ever edited cannot go back to unset (MC-7), so a touched field becomes a configured park.

**Sources.**

- [GRBL defaults.h](https://github.com/gnea/grbl/blob/master/grbl/defaults.h): "#define DEFAULT_SOFT_LIMIT_ENABLE 0 // false"
- [GRBL limits.c](https://github.com/gnea/grbl/blob/master/grbl/limits.c): "This provides some initial clearance off the switches and should also help prevent them from falsely triggering when hard limits are enabled"
- [GRBL wiki: Set up the Homing Cycle](https://github.com/gnea/grbl/wiki/Set-up-the-Homing-Cycle): "Default setting (`$23=0`), the home location is the top right of your work area, with the spindle all the way up."

### CO-2: Origin settings other than Front left and Center mirror or rotate the part on a GRBL router

**Medium** · New · Reproduced

The Origin setting decides which way +X and +Y run. Front left is the GRBL router layout. Front right and Rear left mirror the part, and Rear right turns it 180 degrees. The setting is labelled "Machine origin corner" and shares its wording with "Recorded home", and the code says machine zero "sits at the homing corner", so an operator whose GRBL homes at the rear right (the GRBL default) is invited to pick Rear right. Frame then shows the part displaced but not mirrored. The corner probe and surfacing assume Front left whatever the setting says. Your Neotronics profile uses Front left, which is correct.

**Fix.** Describe the CNC Origin as an axis layout with the note "standard GRBL router: Front left, whatever the homing corner", correct the code comment, and warn in Job Review when a CNC profile uses a mirrored or turned layout.

**Evidence.**

- `jog-direction.ts:17-32` and `origin-transform.ts:50-72` define the layouts; `origin-transform.ts:9` says "Machine origin (0, 0) sits at the homing corner".
- Lane probe with an engraved "L": Front right and Rear left mirrored, Rear right turned 180 degrees; with User Origin at the board corner, Rear right put the part off the board.
- `probe.ts:119` and `surfacing.ts:112` hard-code the standard layout.

**Sources.**

- [LightBurn: Mirrored or backwards output](https://docs.lightburnsoftware.com/latest/Troubleshooting/JobQuality/MirroredOrBackwards/): "The Origin for GCode devices (including most diode lasers) is typically in the front left corner, regardless of where limit switches are installed."

### CO-3: The job anchor sits on the bit's reach, not on the artwork, so the part lands one bit width in from zero

**Medium** · New · Reproduced

The nine anchor points are placed on the area the cutter sweeps, including the default lead-in arcs, not on the artwork. With a 1/8" bit and an outside profile anchored front left, the artwork corner lands at (3.175, 3.175) from zero; at the back anchors the lead arc makes it three bit radii. A V-carve is offset by the V-bit's full radius even though a V cut meets the surface at the outline. Layers run separately with the Output toggles do not line up, because each run is anchored on its own reach. WORKFLOW.md says the anchors name "physical corners of the artwork".

**Fix.** Pick one rule and document it. Either anchor on the artwork (or on the stock rectangle, which keeps separate runs lined up) and show in Job Review how far the bit reaches past zero, or keep the reach anchor but leave out lead arcs and use a V-bit's cutting width.

**Evidence.**

- `jobOriginOffset` (`job-origin.ts:99-110`) anchors `computeJobBounds`, which widens tool-centre bounds by the radius on every side (`job-bounds.ts:128-153`).
- Lane probe, 50 x 30 mm outside profile, 3.175 mm bit: artwork corner at (3.175, 3.174) front left and (3.175, -4.763) back left; centre anchor off by 0.794 mm.
- Separate runs: `pocket inset from sign edge = (-3.175, -3.175)` against a designed (30, 20).

**Sources.**

- [LightBurn: Coordinates and Job Origin](https://docs.lightburnsoftware.com/latest/Reference/CoordinatesOrigin/): "the smallest possible rectangle that can fully contain all graphics you're sending to the laser."

### CO-4: False "outside the stock" warnings, and a misplaced 3D stock

**Medium** · New · Reproduced

The stock position is drawn in bed coordinates, but the "Toolpaths span … outside the stock" advisory compares it with the program's own coordinates. On a homed machine in Absolute mode it fires on every job even when the part is well inside the board, and it also fires for the default full-bed stock with the Center anchor. With User Origin the 3D preview draws the board about 95 mm away from where the canvas shows it. False warnings train operators to skip the list that carries the real ones, such as $32 (JR-1).

**Fix.** Keep the stock in bed coordinates, map the program into bed coordinates with the offset preflight already trusts, skip the check when zero's bed position is unknown, and draw the 3D stock with the same mapping.

**Evidence.**

- `cnc-stock-warnings.ts:21-33` compares `computeEmittedJobBounds(prepared.job)` with `stock.originOffset`.
- Lane probe, homed Absolute job inside a 110 x 110 mm board: "Toolpaths span -304.8–-196.8 × -253.2–-146.8 mm, outside the 110 × 110 mm stock at (95, 145)".
- Lane probe, Center anchor with the default stock: "Toolpaths span -54.0–54.0 × -53.2–53.2 mm, outside the 400 × 400 mm stock at (0, 0)".

### CO-5: The default part zero is G92, which every Abort, alarm and reconnect clears

**Low** · Still open · Confirmed in code

Set origin sends `G92 X0 Y0` and Zero Z sends `G92 Z0`. GRBL clears G92 on every reset, and Abort is a reset, so after an Abort or alarm the XY zero is gone and re-running a half-cut board means finding the corner by eye. KerfDesk correctly marks the origin unknown afterwards. The touch plate already writes a persistent Z, and a persistent XY origin exists but is not the default. This was deliberately deferred.

**Fix.** On homed machines, default to the persistent origin (`G10 L20 P1`) or offer it at Set origin.

**Evidence.**

- `origin-actions.ts:52-69`, `commands.ts:73,84`; reset path `laser-job-actions.ts:282-306`; GRBL `gc_init()` on every reset (`main.c:89`) zeroes G92 (`gcode.c:44`). Deferred in `03-coordinates-and-origin.md:126`.

**Sources.**

- [GRBL interface.md](https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md): "This flushing and re-initialization clears `G92`'s by G-code standard, which some users still incorrectly use to set their part zero."

## Preview, simulation and time

What the preview, 3D pane, Inspector and estimate show.

### PV-1: The time estimate ignores the Z axis's own speed and acceleration

**Medium** · Still open · Reproduced

The estimate times every move with one maximum feed and one acceleration. GRBL limits each move by each axis's own $11x and $12x, and Z is usually much slower. Against GRBL's own planner with router Z values, the estimate ran 4% short on a tabbed profile, 10% on a V-carve and 17% on a drilling job. Diagonal XY rapids are the other way: GRBL runs them up to 1.4 times faster.

**Fix.** Carry per-axis maximum rate and acceleration ($110 to $112, $120 to $122 when known) into the timing, and compute each block the way GRBL does.

**Evidence.**

- `segment-blocks.ts:35-37`; `parse-settings.ts:144-153` maps only $110/$111 and $120/$121.
- Probe L7 (traced GRBL planner): profile 190.6 s vs 198.8 s, V-carve 247.0 s vs 275.8 s, drill 86.3 s vs 104.0 s. With Z given XY limits the estimate is within 1%.

**Sources.**

- [GRBL planner.c](https://github.com/gnea/grbl/blob/master/grbl/planner.c): "block->rapid_rate = limit_value_by_axis_maximum(settings.max_rate, unit_vec);"

### PV-2: The 3D pane hides shallow V-bit engraving

**Medium** · New · Reproduced

A 60 degree V-bit line 0.2 mm deep is about 0.23 mm wide. The 3D pane samples the tool every half cell (0.4 mm) and only marks cell centres inside the cutting radius, so on the default 400 x 400 stock at least 95% of such a line is invisible and the depth probe reads 0. This breaks the module's own promise that "no cell the tool touched is skipped".

**Fix.** For each segment, compute each cell's depth from its distance to the segment rather than stamping discrete positions, or sample at no more than half the cutting radius.

**Evidence.**

- `stamp-toolpath.ts:15-17,264-265,294`; `design-scene-source.ts:31`. Probe L7 pane-engrave: `cutCells=18` where about 433 are needed, `probe@line=0.000`.

### PV-3: Imported programs: G10, G92, G53 and G28 axis words are drawn as moves

**Medium** · Still open · Reproduced

When an .nc file is opened, `G10 L2 P1 X-300 Y-300 Z-60` is drawn as travel to (-300, -300) at Z-60, `G92 X0 Y0` as a move to 0,0 (so the cut is drawn in the wrong place), and G53 as a move in work coordinates. The Inspector then reports a false "rapid through material down to Z -60" and nearly doubles the time. Imported programs cannot be started, so this misleads rather than endangers.

**Fix.** Treat the axis words of G10, G92, G43.1, G28.1 and G30.1 as data. Treat G53, G28 and G30 as moves to an unknown machine position: break the trace and mark timing unavailable.

**Evidence.**

- `gcode-program-line-parser.ts:160-167,198-206`; `gcode-render-model-builder.ts:208-225`. Probe L7 imported-programs.

**Sources.**

- [GRBL wiki: Commands](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands): "Supported Non-Modal Commands | G4, G10 L2, G10 L20, G28, G30, G28.1, G30.1, G53, G92, G92.1"

### PV-4: The Inspector does not warn about lines GRBL 1.1 will reject

**Low** · New · Reproduced

`T1 M6`, `G98`, `G20 G21` on one line, `G41`, `G43 H1`, `M7` on stock builds and arcs with a 0.02 to 0.1 mm radius mismatch all stop GRBL with an error, but the Inspector shows nothing or only "info".

**Fix.** When the target is GRBL 1.1, warn and name the line and the error GRBL will stop on. Reuse the 2D parser's arc rule.

**Evidence.**

- `gcode-render-model-builder.ts:51-52` (`ARC_RADIUS_TOLERANCE_MM = 0.127`). Checked with the real GRBL parser: error:20, error:21, error:33.

## Checked and correct

### Job Review and warnings

- Through-cuts without tabs warn; depth past the stock bottom warns for every cut type (July 1.19 fixed); $30 mismatch and machine feed limits give the right numbers.
- Refusals are limited to programs that cannot be built (no V-bit angle, safe Z at or below 0, zero passes); everything else is a warning, as ADR-228 requires. Save now refuses exactly what Start refuses (July 4.1 to 4.4 fixed), and CNC Resume works with a spindle advisory (July 4.5).

### Toolpaths

- Cutter offset is exactly the bit radius outside and inside, on rectangles, circles, L-shapes, acute points and stars, with no gouges.
- Pocket rings are spaced at the stepover and leave no uncut floor at 40 to 100% stepover; islands are never entered. July 1.10 (uncut core above 50%) is fixed.
- Depth passes land exactly on the final depth, never exceed the depth per pass, and ramps hold their angle. July 1.4 (ramp restarting at the stock top on tabbed loops) is fixed.
- Climb keeps the material on the right with an M3 spindle and conventional is the reverse: 40 of 40 cases on all five origins, including finish passes and raster wall rings. July 1.1 and 1.2 are fixed; the weakness register W-02 entry is out of date.
- Lead-ins stay on the waste side, tabs are exactly tab width plus bit diameter long, rise at the plunge feed, and every XY rapid happens at safe Z.

### Feeds and speeds

- The feed formula matches Sandvik and ShopBot (feed = RPM x flutes x chip load), in mm/min under G21 G94. Plunge is 0.4 times feed for wood and depth per pass 0.4 to 0.5 times the diameter, inside the Shapeoko guide's ranges.
- Manual edits drop the automatic source, bit changes recompute the recipe, and $30 only sets spindle max through an explicit choice (July 3.3 fixed).

### G-code and GRBL

- Real GRBL 1.1h accepts every emitted program in a 38-program corpus covering every cut type, multi-tool, coolant, park, origins, surfacing and tiling. The only error is M7 on stock builds, which Job Review already warns about.
- Every program starts `G21 G90 G54 G94 G17`, lifts Z before every M3 (also after M0), dwells after M3 in seconds, stops the spindle and coolant before park and M0, and restates modal state after M0.
- The longest sendable line is 50 bytes, well inside GRBL's 80-character line buffer and 128-byte receive buffer. No exponent notation, no zero-length moves, and an F word before every feed move.

### V-carve, inlay and other strategies

- V-carve depth follows the bit angle exactly: 90 degree bit on a 6 mm strip -2.999 mm (3.000 expected), 60 degree bit with a 0.5 mm flat tip -4.761 (4.763), and the cone-height cap with Flat depth off is shown in Job Review. The two-stage clearing hand-off is consistent.
- Inlay pairs: allowance sign and per-side value, mirroring, spacing, pocket-before-insert order and independent depths are right.
- Adaptive clearing, where it accepts a pocket, enters with a 3 degree helix and leaves no stock (coverage 1.000).
- Rest machining with a 1/4" rough and a 1/8" rest bit leaves only the finishing bit's unavoidable corner fillets, and the rest path cuts only where needed.
- Drill pecks land exactly on each step and the final depth, with a full retract between pecks.
- Relief finishing follows the scallop law, and the far-edge row is now cut (July 1.11 fixed). Surfacing ends exactly at the far edge with an exact depth ladder.
- Tiling: tiles step by tile size minus overlap, cover the job, lose no motion at seams (worst 0.053 mm over 8,604 samples), and both tiles bore each seam hole at the same stock point.

### Placement and zero

- All nine anchors under User Origin, Verified Origin and Current Position put the anchored area within 0.001 mm of zero on the front-left and rear-left origins, and Current Position parks back at its start.
- Absolute placement lands the part where the canvas shows it, and the PR #852 work-offset compensation holds: work offsets 0 and (-250, -200) cut at the same machine position.
- Frame traces the emitted tool centre plus the bit radius, leads included, within 0.001 mm.
- Z0 is the stock top on every cut type: output is identical at 6.35 and 19.05 mm stock, and no XY rapid runs below safe Z.
- Origin commands put G54 in the same block, G10 L20 accounts for G92, and every program restates G21 G90 G54 G94 G17 at the start and after each bit change. July 1.18 (stock versus travel ignoring the stock position) is fixed.

### Preview, simulation and time

- The preview is built from the compiled job, not the G-code text; stamping the job and the re-parsed G-code give the same removal grid. Tool shapes match the analytic surfaces.
- With equal axis limits the estimate is within 1% of GRBL's planner, including junction deviation, arcs, dwells and helix Z length. Imported inch and incremental programs are drawn and timed correctly.

## How this was checked

Eight parallel lanes each probed one part of the chain through the real compile, emit and preflight code: G-code, toolpaths, advanced strategies, feeds, machine control, Job Review, preview and coordinates. Every emitted program went through the GRBL 1.1h g-code parser built from the gnea/grbl source, which reports every error rather than the first. Arc and timing questions went through a traced build of the same source that logs every planner segment, plus an independent single-precision model of GRBL's arc maths.

I re-ran the top findings myself before writing them up: the $32 mechanism in the GRBL source, the tab heights, the reversed cut order, the secondary-bit feeds, the helix collapse (2.119e-6 rad on the example arc, the same number the lanes found) and the Neotronics feed cap. Quotes from outside sources were fetched and checked word for word.

### Limits

No hardware was used, so nothing here is an air-cut or material result. Bit breakage, burning and stalls are inferred from the cited sources, not observed. The 4040's real $$ values, spindle torque curve and frame stiffness are unknown. Vectric pages could not be fetched (blocked by robots.txt), so no Vectric behaviour is claimed. The Settings audit thread owns the shipped values themselves; this report covers how the code uses them.
