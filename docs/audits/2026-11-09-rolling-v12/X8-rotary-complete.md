# Rolling audit v12 — X8 Rotary complete: can a round glass burn right while it turns?

- **When:** 2026-11-09, 22:55–23:50 +0800   **Tree:** origin/main @ `ffd9fe66b`; its `src` is identical to `43d75cabb`. Repros ran on the scratchpad export `j18-main`, with `node_modules` a junction. A hash check of 102 rotary, emit and preflight files against `ffd9fe66b` found no difference.
  - Returning-user baseline: 1.0.29 (`df2279e26`) from the X2 tree `zz-v2\old29`. Since 1.0.29 only `src/core/preflight/rotary-bounds.ts` changed among rotary files (+5/−1, iterable input; #1612's performance change).
- **Requested by** the maintainer on 2026-11-09: "make sure our function to laser a rotary item is also fully build? I need to be able to put in a round glass or whatever and burn perfect burn while it rotates".
- **Scope:** about 55 rotary files and their consumers.
  - Core: `src/core/devices/rotary*.ts`, `src/core/job/rotary-*.ts`, `laser-lead-rotary.ts`, `src/core/preflight/rotary-bounds.ts`.
  - UI: `src/ui/laser/Rotary*.tsx`, `rotary-*.ts`, `device-setup/DeviceSetupRotaryFields.tsx` and `src/ui/commands/rotary-command-family.ts`.
  - Consumers: emit (`emit-gcode.ts`), Frame, estimates, the jog checks, Job Review and the G-code inspector's rotary energy and wrap.
- **Governing:**
  - ADR-127 and its Amendment 1 (placement anchor); ADR-315 (rotary independent of Labs, one raster disclosure).
  - ADR-373 and its Amendment 1 (roller diameter, Test rotation, Rotary switch); ADR-503 item 4 (published presets).
  - ADR-228 Amendment 2 (camera on a rotary, #1641); ADR-492 item 9 (images scan along X); ADR-626 (leads within one turn); ADR-500 Amendment 2 (Open keeps the machine in use).
- **Lenses run:**
  - **L1 contract:** the ADR clauses above, checked in code.
  - **L3 twin models:** emitted motion against the wrap preview, the Job Review fact, Frame bounds and the G-code inspector's dose model. 1.0.29's save and emit against main's open and emit.
  - **L4 adversarial:** artwork taller than one turn, diameter changes, Reverse, every placement, a tapered part.
  - **L9 entry points:** Rotary Setup, Machine Setup's rotary fields, the Rotary switch, presets, Open of a saved rotary project, and Abort followed by a re-run.
  - **LightBurn parity:** LightBurn's public docs and forum, cited inline.
  - Not run: L2 beyond LightBurn and controller docs, L5, L7. No browser, no hardware.
- **Counts:** 7 raised, refuter pending.
  - P1 1 (defect), P2 2 (missing features), P3 4: 2 wording defects and 2 missing features.
  - KNOWN re-encountered: 5 (D3-P2-2, D3-P3-1, D3-P3-2, D3-P3-3 and W4-P2-1 / #1641).

## Headline

**Not yet. The geometry is right, but the burn quality on the round part is not.**

**What is right.** On every controller KerfDesk drives (GRBL, grblHAL, FluidNC, Marlin, Smoothieware), for chuck, scaled roller and surface-calibrated roller, the geometry holds:
- A design exactly one turn tall (Ø80, 251.33 mm) emits exactly one turn (error 0.000 mm).
- A 20 mm square keeps its aspect (20.000 mm; 20.006 mm on the chuck, from 3-decimal rounding).
- The job lands centred on the head with Current Position, which is LightBurn's recommended start.
- Image rows run along the circumference at the right pitch, and no rapid turns the part more than 29°.
- A diameter change rescales the output, and artwork taller than one turn is warned.
- A project saved by 1.0.29 with the rotary on emits byte-identical G-code on main.

**What is wrong: the burn depth.** KerfDesk scales only Y, so it writes the layer's speed as the machine feed. Every stroke that runs round the part therefore travels over the glass faster than the speed the operator set (X8-P1-1):
- **Creality chuck preset on a Ø80 glass:** 6.3× faster, 9,425 mm/min for a 1,500 mm/min layer. KerfDesk's own G-code inspector computes that such a stroke gets 15.9 % of the energy of a stroke along the glass.
- **Stock roller:** about 2× faster.
- **Effect:** text outlines and any fill hatched at an angle burn unevenly, and a 90° fill burns at 16 % of the set energy. Nothing in Job Review says so.

**Two gaps are missing LightBurn features the goal needs:**
- **No A or Z rotary axis (X8-P2-1).** The maintainer's own Falcon A1 Pro plugs its rotary into a dedicated side connector, and LightBurn users drive it as A or Z. KerfDesk emits Y only, yet still offers the A1 Pro the Creality "Y port" preset.
- **No taper correction (X8-P2-2).** A tapered tumbler or glass burns 11 % short at the narrow end, with no Taper Warp.

**Images are fine as they are.** Engraving images or photos on a cylindrical glass on a Y-port rotary (chuck or roller) is geometrically correct today. Image rows run along X at the layer speed.

## Feature inventory (LightBurn vs KerfDesk)

| Feature | KerfDesk | Where (`ffd9fe66b`) | LightBurn |
|---|---|---|---|
| Rotary types: roller and chuck | **present.** Chuck scale = motion per turn ÷ (π × object Ø). Roller scale = motion per turn ÷ (π × roller Ø), independent of the part; a roller without a roller Ø is surface-calibrated at ×1 | `core/devices/rotary.ts:19,60-68` | Chuck or Roller; for a roller "Object Diameter … does not affect output" ([GCode rotary](https://docs.lightburnsoftware.com/2.1/Reference/RotaryMode/RotaryModeGCode/)). Pro-loop L10 found the law clean |
| Steps or mm per rotation, and calibration | **present.** "Motion per turn"; Test rotation turns the object, chuck or driven roller once, pauses, and turns back; the note names the value to change (ADR-373 Amd 1) | `ui/laser/rotary-test-rotation.ts:62-84`, `RotaryTestRotationPanel.tsx` | MM Per Rotation plus Test: 360°, pause, return; "reduce" if it turns too far (same page) |
| Object diameter and circumference, with a measure helper | **present.** Linked diameter and circumference; "Measure with a strip" (`d = L/π − t`) | `rotary.ts:100-113`, `RotaryMeasureHelper.tsx`, `rotary-setup-edit.ts:118-123` | Diameter linked to Circumference; "use the largest diameter" for tapers |
| Rotary on Y vs a dedicated A or Z axis | **partial.** Y only on every controller; no A, B or Z word is ever emitted for a laser (`axis-out.txt`) | `core/job/rotary-transform.ts:141-155` maps Y only | Rotary Axis: Y, or "Z Axis or A Axis" for a dedicated rotary port; Move window rotational arrows jog A in degrees ([Move window](https://docs.lightburnsoftware.com/1.7/Reference/MoveWindow/)). **X8-P2-1** |
| GRBL `$` settings assumed | none written; a Y-port rotary uses the controller's Y `$101/$111/$121` as they are | — | Docs say to set A-axis steps per degree, max speed and acceleration on the controller ([legacy GRBL rotary](https://docs.lightburnsoftware.com/Rotary-GRBL.html)) |
| Mirror and direction reversal | **present.** Reverse rotary axis mirrors about the anchor, or within the wrap for Absolute | `rotary.ts:34-37`, `rotary-transform.ts:39-69` | "Mirror Output to Rotary" |
| Centring the design and choosing where to start | **present.** A placed job keeps its anchor (Current Position, User or Verified Origin); Absolute rebases to work Y 0. Centre & LED is disabled on a rotary | `rotary-job.ts:30-47`, `artwork-centre-control-state.ts:49-50` | Start From "Current Position" recommended; graphics above or below the origin make the rotary turn |
| Enable or disable per job; saved projects | **present.** The Rotary switch above Frame and Start, as one undoable profile edit that expires a completed Frame. A project stores `device.rotary`; opening a file for the same machine keeps the current machine's rotary and toasts "rotary setup" (ADR-500 Amd 2 D1-D2) | `RotaryModeSwitch.tsx:28-52`, `project-device-profile-validator.ts:121-132` | "Enable Rotary"; optional switch in the Laser window |
| Split output | **missing** (not needed for parity) | — | Galvo only (Split Size and Overlap); the GCode page has no split setting |
| Tapered warp / cylinder correction | **missing.** One diameter per setup; the strip helper and the tutorial name tapered parts | `rotary.ts:21-38`; `placement-tutorials.ts:196` | **Taper Warp** tool: Top Ø, Bottom Ø, Length ([Taper Warp](https://docs.lightburnsoftware.com/2.1/Reference/TaperWarp/)). **X8-P2-2** |
| Rotary jog or move | **partial.** Y jog in machine mm, checked against `[0, wrap]`. Move-to keeps Y on a rotary. No degree or surface-mm jog | `laser-jog-warnings.ts:93`, `head-move-dispatch.ts:105-115` | Y rotary: Y arrows; A rotary: rotational arrows in degrees |
| Frame on the rotary | **present.** Frame traces the machine-space job; its bounds change with the diameter, so a diameter change expires a Frame | `frame-bounds-preview.ts:34`, `required-frame-readiness.ts:79-93` | Frame turns the rotary |
| Raster and photo on the rotary | **present.** Rows forced along X (angle, cross-hatch and per-pass angles set aside, with a diagnostic); row pitch follows the scaled bounds; overscan stays on X | `compile-job-raster.ts:139-150` | Same behaviour (rows along X); no documented speed rule |
| Speed and acceleration on the rotary axis | **defect.** Layer speed is written as machine F unchanged; strokes round the part run at F ÷ scale | `rotary-transform.ts:71-95` (geometry only) | Not documented; forum reports disagree. **X8-P1-1** |
| Cut and fill on the rotary | **present** (geometry): arcs become G1 chords; leads stay within one turn. Fill hatch angle is not forced to 0°, so angled fills hit X8-P1-1 | `rotary-transform.ts:141-155`, `laser-arc-moves.ts:44`, `laser-lead-rotary.ts:22-81` | Same geometry |
| Wrap preview | **present.** Rotary Setup's 2D wrap diagram (circumference, machine travel, scale, artwork coverage, seam) and the inspector's 3D "Wrap round the rotary" | `RotaryWrapPreview.tsx`, `rotary-wrap-preview.ts:22-48`, `use-laser-burn.ts:92-118` | Preview shows flat; no 3D wrap |
| Test rotation and calibration pattern | **present.** Test rotation (above); "Generate test pattern": 50 × min(20, π·d/2) mm rectangle with a centre cross | `rotary-calibration-pattern.ts:20-71` | Test button; no pattern |
| Rotary presets | **partial.** One: Creality Rotary Kit Pro chuck, 40 mm per turn, for the `creality-falcon` family (A1 Pro included) | `rotary-presets.ts:19-36` | None; values come from the manufacturer. **X8-P3-3** |
| Glass guidance (dither, power, wet paper, dish soap) | **missing** for the rotary. One photo recipe: "Clear acrylic or glass, from the back" | `ui/raster/photo-recipes.ts:79-80` | Not documented in LightBurn's rotary pages or the Full Wrap Tumbler guide ([guide](https://docs.lightburnsoftware.com/2.1/Guides/FullWrapTumblers/)). The tips are third-party (Epilog wiki, FacFox). Not raised (no anchor) |
| Job Review on a rotary job | Fact "Enabled · Chuck, Ø80 mm · Y ×0.16, one revolution = 40 machine mm"; the qualification warning appears only when the job has raster; the wrap warning appears past one turn | `rotary-summary.ts:39-44`, `rotary-raster-qualification-warnings.ts:13-21`, `rotary-bounds.ts:28-39` | — |

## Accuracy matrix

Ø80 mm glass (circumference 251.327 mm). Hardware assumed per setup:
- **Chuck:** the Creality preset, 40 machine mm per chuck turn.
- **Scaled roller:** 40 machine mm per turn of a Ø25 driven roller.
- **Surface-calibrated roller:** Y steps/mm already in surface mm.

Each controller's built-in profile was used; the A1 Pro was also run separately as grblHAL CoreXY. Every cell below was the same on GRBL 1.1, grblHAL, Falcon A1 Pro, FluidNC, Marlin and Smoothieware (`acc-out.txt`, 6 × 3 × 5 runs).

| Check | Chuck 40 mm/turn | Roller Ø25, 40 mm/turn | Roller surface-calibrated | Result |
|---|---|---|---|---|
| Full wrap: 20 × 251.327 mm outline, lit Y travel → surface | 40.000 machine → 251.327 | 128.000 → 251.327 | 251.327 → 251.327 | **exact** (err 0.000 mm; no stretch, gap or overlap beyond the shared seam line) |
| Aspect: 20 mm square and Ø20 circle | 20.006 × 20 | 20.000 × 20 | 20.000 × 20 | **holds** (the chuck's +6 µm is 0.001 machine-mm rounding at ×0.159) |
| Lands where shown (Current Position, centre anchor at head Y 80) | job centre at machine Y 80.000 | 80.000 | 80.000 | **holds** |
| Raster 20 mm at 10 lines/mm: rows, direction, pitch, span | 200 rows along X; pitch 0.094/0.100 (±3 µm rounding); span 19.899 | 200; 0.098; 19.900 | 200; 0.100; 19.900 | **holds** |
| Largest rapid in Y | 3.175 machine = 28.6° | 10.160 = 28.6° | 19.95 = 28.6° | **holds** (no wild spins) |
| Diameter 80 → 60 (chuck) | 20 mm design → 4.2440 machine (expected 4.2441) → 19.999 mm on Ø60 | — | — | **rescales** |
| Artwork 270 mm (> one turn) | `ok=false`, "spans 42.972 mm in Y, more than one turn of the object (40.000 mm)" | "137.510 … (128.000 mm)" | "270.000 … (251.327 mm)" | **warned** (wording: X8-P3-1) |
| **Speed round the part** (Line 1,500; Y strokes) | **9,425 mm/min** surface | **2,945** | 1,500 | **X8-P1-1** |
| **Fill 3,000 at 90° / 45°** (`spd-out.txt`) | **18,850 / 4,190** (16 % / 72 % of the set energy) | **5,890 / 3,781** (51 % / 79 %) | 3,000 / 3,000 | **X8-P1-1** |
| Fill 3,000 at 0°, and images | 3,000 | 3,000 | 3,000 | holds (rows along X) |
| Tapered tumbler, rim Ø80 to base Ø70 over 100 mm, Ø80 entered (`taper-out.txt`) | rim square 19.75 mm, base square **17.75 mm** (−11.3 %) | — | — | **X8-P2-2** (no taper input) |
| 1.0.29 save → main open → emit (`ret-out.txt`): chuck, chuck reversed, scaled roller, unscaled roller, disabled; Absolute, Current Position, User Origin | 15/15 **byte-identical** (comments excluded) | | | **holds** |
| Axis words emitted (`axis-out.txt`) | X, Y on GRBL and on the A1 Pro | | | **X8-P2-1** on dedicated-port rotaries |

## Findings

### X8-P1-1 — Strokes that run round the part burn at the layer speed ÷ the rotary's Y scale: 6.3× faster on the Creality chuck preset, 2× on a stock roller, with no warning

- **Kind:** defect.
- **Where (`ffd9fe66b`):**
  - `src/core/job/rotary-transform.ts:71-95` (`applyRotaryYScale`) and `:141-155` (`mapSegment`) map only the points' Y; every group keeps its layer speed.
  - `src/core/job/rotary-job.ts:51-58` (`machineSpaceJob`) and `src/io/gcode/emit-gcode.ts:296-305` (`applyRotaryStage`) feed that job to every emitter, so `F` is the layer speed in machine mm/min.
  - The app's own twin, `src/ui/gcode-inspector/burn-grid.ts:216-225` (`surfaceFeed`), says "F measures commanded XYZ travel per minute". It converts each move to surface speed with `surfaceYScale` (`use-laser-burn.ts:176-181`).
  - Its test `burn-rotary-energy.test.ts:24-34` pins that a Y stroke at the same F gets 0.424 J/mm² against 2 J/mm² along X.
  - `src/ui/laser/job-review/rotary-raster-qualification-warnings.ts:13-21`: the only rotary warning, and only for raster jobs. `rotary-summary.ts:39-44` states the scale as a fact.
- **Anchor:**
  - **Twin:** emitted feed against the inspector's dose model. The inspector models the energy the program really puts on the surface; the emitter does not apply the same conversion.
  - **Contract:** the layer Speed is the speed across the material, and on a flat bed `F` is exactly that. ADR-127 maps "surface mm" to machine mm and says every consumer that reasons about machine motion must route through the same mapping. Speed is the one quantity it leaves unmapped.
  - **Ground truth (partial):** LightBurn's GCode rotary page says nothing about feed conversion. Forum reports disagree (a [user thread](https://forum.lightburnsoftware.com/t/rotary-engraver-burning-lighter-on-the-x-axis-than-on-the-y-axis/139773) reports the symptom; a [regular](https://forum.lightburnsoftware.com/t/rotary-settings-chuck-vs-roller/134890) says LightBurn computes surface speed). So parity cannot be settled from public sources.
- **Scenario:** the maintainer puts a Ø80 glass in the Creality chuck (preset: 40 mm per turn, scale ×0.159).
  - The name is a Line at 1,500 mm/min. Its horizontal strokes (along the glass) burn at 1,500. Its vertical strokes (round the glass) move the surface at 9,425 mm/min, so they get 15.9 % of the energy.
  - A Fill hatched at 90° burns at 18,850 mm/min (16 %), and at 45° at 72 %.
  - On a stock roller (Ø25, 40 mm per turn) the same strokes get 51 %.
  - Job Review shows "Y ×0.16" and nothing else. The burn comes out faint or missing in one direction, which is the opposite of "perfect burn".
- **Evidence:** REPRO.
  - `zz-x8\acc.mts` → `acc-out.txt`: Y-stroke surface speed 9,425 / 2,945 / 1,500 mm/min on all six controllers.
  - `zz-x8\spd.mts` → `spd-out.txt`: line and fill at 0°, 90° and 45°, plus the app's own `moveDoseJPerMm2`: "X stroke 1.2000 J/mm2, Y stroke 0.1910 J/mm2 → Y gets 15.9% of the X dose".
  - Job Review for the vector job: 0 rotary warnings, 0 preflight issues (`axis-out.txt`).
- **Severity:** P1.
  - **For P1:** METHOD §3, "silently produces wrong physical output (power …)". The energy per surface millimetre is 16-51 % of what the operator set, in a direction-dependent way. No warning reaches the operator. The inspector's shading is a visible result, not a warning (§3), and it shows only if the operator opens the inspector in energy mode. There is no reach clause. The default chuck preset and the default new roller (scaled, ADR-373 Amd 1) both hit it; only a surface-calibrated roller escapes.
  - **Against:**
    - LightBurn may behave the same; its docs do not say. The maintainer's rule is to copy LightBurn, so a refuter who finds a LightBurn source showing no feed conversion could argue the behaviour is parity.
    - ADR-315's raster warning says the rotary's "material response" is unqualified. But it fires only for raster, and raster is the case that is not affected.
- **Announced?** No. D3 (`docs/audits/2026-10-22-controller-v3/D3-ctl-rotary.md`, "Not verified") noted it and did not raise it for lack of an anchor. The repo's own inspector test is that anchor now.
- **Novelty:** new as a finding. No open PR touches `rotary-transform.ts`, `rotary-job.ts` or the emitters' feed handling (`gh pr list --search rotary`: none).
- **Fix direction:**
  - In `machineSpaceJob`, give each mapped cut or fill move the feed `F_layer × L_machine / L_surface`, the inverse of `burn-grid.ts`'s `surfaceFeed`, so the surface moves at the layer speed. Rows along X are unchanged, so images keep their bytes. The ETA already follows `machineSpaceJob`.
  - It needs an ADR amendment to ADR-127 (byte change for vector and angled-fill rotary jobs), and a test against the inspector's dose so the twins stay locked.
  - If parity research shows LightBurn does not convert, the minimum is a Job Review warning naming the slowest-to-fastest surface speed.
- **Refuter:** PENDING.

### X8-P2-1 — No dedicated rotary axis: KerfDesk emits Y only, while the maintainer's Falcon A1 Pro plugs its rotary into a side connector that LightBurn users drive as A or Z, and the A1 Pro is still offered the "Y port" preset

- **Kind:** missing feature, with one wording defect inside it (the preset offered to a CoreXY machine).
- **Where (`ffd9fe66b`):**
  - `src/core/job/rotary-transform.ts:141-155`: only Y is mapped. No laser emitter writes A, B or Z for a rotary (`axis-out.txt`: X, Y only, on GRBL and on the A1 Pro).
  - `src/core/devices/falcon-profiles.ts:12` (`machineFamily: 'creality-falcon'`), `:27` (`kinematics: 'corexy'`), `:62` (`'rotary'`).
  - `src/core/devices/rotary-presets.ts:19-28,30-36`: the Creality Rotary Kit Pro preset, "40 mm per rotation as a chuck **on the Y port**", is offered to the whole `creality-falcon` family, A1 Pro included.
  - ADR-315 Decision 3: command reachability "is not a claim of an A-axis or CNC rotary output contract".
- **Anchor:**
  - **Ground truth:** LightBurn's GCode rotary page: "Z Axis or A Axis" is used when the rotary plugs into a dedicated rotary port ([page](https://docs.lightburnsoftware.com/2.1/Reference/RotaryMode/RotaryModeGCode/)). The Move window jogs A in degrees ([Move window](https://docs.lightburnsoftware.com/1.7/Reference/MoveWindow/)).
  - **Ground truth, secondary:**
    - A1 Pro owners report that the Creality rotary plugs "into the side of the A1 Pro" ([Creality forum](https://forum.creality.com/t/falcon-a1-pro-rotary-issue/45961)).
    - In LightBurn, with Y or X selected, "the laser moves on the x and y-Axis. The rotary doesn't move"; users report success with A or Z ([LightBurn forum](https://forum.lightburnsoftware.com/t/rotary-setup-falcon-a1-pro/189774), user posts, no staff reply).
  - **Twin:** the preset's own text names a Y port. On the A1 Pro's CoreXY kinematics, Y drives both belts.
- **Scenario:** the maintainer fits the Creality chuck to the A1 Pro's side connector, enables the rotary, picks the offered preset and presses Start.
  - KerfDesk sends Y moves. If the firmware does not route Y to that connector (the forum reports say it does not), the gantry moves across the bed instead of the glass turning. The beam fires along a line off the glass.
  - Job Review's fact says "Chuck, Ø80 mm · Y ×0.16". Nothing says the rotary must be on a Y port, or that the A1 Pro's port is not one.
  - On any grblHAL or FluidNC machine with a 4th-axis rotary the result is the same: KerfDesk cannot drive it.
- **Evidence:**
  - REPRO, `zz-x8\axis.mts` → `axis-out.txt`: the A1 Pro is offered `creality-rotary-kit-pro-chuck` with its "Y port" text, and emits X and Y only.
  - SOURCE (secondary) for the A1 Pro hardware. The maintainer's own A1 Pro has not been checked (see Not verified).
- **Severity:** P2.
  - **For P2:** a core LightBurn rotary capability that the maintainer's own machine appears to need. Without it the goal cannot be met on that machine.
  - **For P1:** if the A1 Pro firmware leaves its rotary connector on a separate axis, a Start with the offered preset fires the beam along the gantry Y with no warning. That is wrong physical output. Only the firmware behaviour is unverified, and secondary sources say it is so.
  - **Against:** ADR-315 D3 announces that no A-axis contract exists. Y-swap rotaries on GRBL diodes (Ortur, Sculpfun, Atomstack, older Falcons) are fully covered. The A1 Pro evidence is forum posts, not Creality documentation (the manual page refused the fetch, HTTP 403).
- **Announced?** Partly: ADR-315 D3, and D3's table row "A axis … by scope". No user-facing text says the rotary must be on the Y motor port, and the preset text says "Y port" without saying the A1 Pro has none.
- **Novelty:** the scope limit is KNOWN (D3 table). New: the maintainer's machine appears to need A or Z, and the A1 Pro is offered a Y-port preset.
- **Build direction:**
  - Add a `rotaryAxis: 'Y' | 'A' | 'Z'` setting (LightBurn's three choices). For A, emit degrees (`360 × surface ÷ circumference`) with an inverse-time or converted feed, which grblHAL and FluidNC accept. The test rotation and jog follow the same axis.
  - Until then, either restrict the Creality preset to Y-port machines, or have Rotary Setup state that the rotary must replace the Y motor.
  - Ask the maintainer to read the A1 Pro's `$$` and `$I` with the rotary fitted.
- **Refuter:** PENDING.

### X8-P2-2 — No taper correction: a tapered tumbler or glass burns 11 % short at its narrow end, and nothing tells the operator; LightBurn has a Taper Warp tool

- **Kind:** missing feature.
- **Where (`ffd9fe66b`):**
  - `src/core/devices/rotary.ts:21-38`: one `objectDiameterMm`; the scale is constant along X (`:60-68`).
  - The app does name tapered parts. `RotaryMeasureHelper.tsx:1-5` ("calipers cannot do on a tapered cup"). The tutorial (`placement-tutorials.ts:196`) says "for a tapered or soft part, use Measure with a strip where the artwork goes". That measures one diameter at one place.
- **Anchor:**
  - **Ground truth:** LightBurn's [Taper Warp](https://docs.lightburnsoftware.com/2.1/Reference/TaperWarp/) adjusts graphics "to compensate for the difference in diameter" between the ends, from Top Ø, Bottom Ø and Length. The [Full Wrap Tumbler guide](https://docs.lightburnsoftware.com/2.1/Guides/FullWrapTumblers/) points tapered cups to it.
  - **Contract:** the maintainer's standing rule to copy LightBurn.
- **Scenario:** a tumbler that is Ø80 at the rim and Ø70 at the base over 100 mm, in the chuck, with the largest diameter (Ø80) entered as LightBurn advises.
  - A 20 mm square near the rim burns 19.75 mm round the part. The same square near the base burns 17.75 mm (−11.3 %). Text along the cup fans into a trapezoid.
  - Entering the middle diameter (Ø75) splits the error, +5.3 % / −5.3 %.
  - Focus also changes along the taper, which LightBurn's tool does not correct either.
- **Evidence:** REPRO, `zz-x8\taper.mts` → `taper-out.txt`. Same machine Y (3.183 mm) for both squares; surface lengths as above.
- **Severity:** P2.
  - **For:** the task's own example (tumbler taper, where the app talks about tapered parts). Drinking glasses and tumblers are commonly tapered, and the strip helper and tutorial invite them without saying the result will distort.
  - **Against (P3):** a straight-sided glass or bottle is unaffected; the output is exactly what the single diameter implies; LightBurn's own answer is a design-time warp, not an output setting.
- **Announced?** No. Neither ADR-373 nor the tutorial says tapered parts distort.
- **Novelty:** new. Not in D3 or pro-loop L10.
- **Build direction:**
  - A Taper Warp action on the selection, as in LightBurn: Top Ø, Bottom Ø, Length and which end is the top. It scales each point's Y by `D_ref / D(x)` about the job's Y anchor.
  - Until then, a note in Rotary Setup and the tutorial that a tapered part burns smaller at its narrow end.
- **Refuter:** PENDING.

### X8-P3-1 — The over-one-turn warning speaks in machine millimetres: a 270 mm design on a Ø80 glass is reported as "spans 42.972 mm in Y, more than one turn of the object (40.000 mm)"

- **Kind:** defect (wording).
- **Where (`ffd9fe66b`):** `src/core/preflight/rotary-bounds.ts:28-39` (`rotaryWrapIssue`) formats the emitted program's Y span against `rotaryYLimitMm`, both machine mm.
- **Anchor:** Twin with Rotary Setup's wrap preview (`RotaryWrapPreview.tsx`), which says "artwork up to 251.33 mm tall fits one revolution" in surface mm. The two name the same limit in different units.
- **Scenario:** the operator's artwork is 270 mm against a 251.33 mm circumference. Job Review says 42.972 against 40.000 mm, numbers that appear nowhere in their design. The warning still says to scale the artwork down, so it is not misleading about what to do.
- **Evidence:** REPRO, `acc-out.txt`, "oversize 270mm" rows (chuck 42.972/40.000; roller 137.510/128.000; unscaled 270.000/251.327).
- **Severity:** P3 (the warning fires and its advice is right).
- **Announced?** No. **Novelty:** new.
- **Fix direction:** divide both numbers by `rotaryYScale` and say "the artwork wraps 270.0 mm, one turn of the Ø80 mm part is 251.3 mm".
- **Refuter:** PENDING.

### X8-P3-2 — After an Abort on a rotary, the origin offer describes the cylinder's turn as "the head is N mm from it (Y … mm)"

- **Kind:** defect (wording).
- **Where (`ffd9fe66b`):** `src/ui/laser/unrestored-abort-origin.ts:75-115` (`headOffsetFromSavedMm`, `unrestoredOriginOfferPrompt`; the text at `:103-104`). No rotary branch; on a Y-port rotary, machine Y is the part's rotation in machine mm.
- **Anchor:** Contract: ADR-127 Amendment 1 and `head-move-dispatch.ts:105-108` ("no canvas or work Y names a rotation").
- **Scenario:** on a User Origin rotary job, an Abort followed by Frame offers "The head is 12.3 mm from it (X +0, Y +12.3 mm)". On the chuck preset, 12.3 machine mm is 111° of turn. The restore itself is right: machine Y counts rotation, so G92 brings the re-run back to the same angle unless the part slipped. Only the description is wrong.
  - With homing on, the offer homes first, which on a Y-port rotary spins the part looking for a Y switch (KNOWN D3-P2-2, see below).
- **Evidence:** READ.
- **Severity:** P3.
- **Announced?** No. **Novelty:** new (the offer is #1620/#1647's).
- **Fix direction:** on an active rotary, state the Y offset as degrees of turn (`360 × ΔY ÷ wrap`) and warn that a roller may have slipped.
- **Refuter:** PENDING.

### X8-P3-3 — One rotary preset: none for xTool, Ortur, Sculpfun, Atomstack or LaserPecker rotaries

- **Kind:** missing feature.
- **Where (`ffd9fe66b`):** `src/core/devices/rotary-presets.ts:19-28`: one entry, Creality, `creality-falcon` only. Every other machine opens Rotary Setup on the 360 mm / Ø25 placeholders (`rotary-setup-edit.ts:28-31`).
- **Anchor:** Contract: ADR-503 item 4 (published figures only). LightBurn ships none, so parity does not require more.
- **Scenario:** an Ortur YRR or Sculpfun roller owner starts from 360 mm per turn and a Ø25 roller, which are placeholders, and must find the maker's figures and run Test rotation. That is the LightBurn workflow too.
- **Evidence:** READ.
- **Severity:** P3 (nice to have; Test rotation covers it).
- **Announced?** ADR-503 says only published figures go in. **Novelty:** new.
- **Build direction:** add presets where the maker publishes mm per turn and roller Ø, each with its source URL, and verify the Creality entry's source (below).
- **Refuter:** PENDING.

### X8-P3-4 — No degree or surface-mm jog for the rotary

- **Kind:** missing feature.
- **Where (`ffd9fe66b`):** `src/ui/state/laser-jog-warnings.ts:93` (bounds `[0, wrap]` in machine mm); `head-move-dispatch.ts:105-115` (Move-to keeps Y). The jog pad's Y step is machine mm, so on the chuck preset 10 mm is 90°.
- **Anchor:** LightBurn parity, partial: [Move window](https://docs.lightburnsoftware.com/1.7/Reference/MoveWindow/) rotational arrows step A "degrees of movement" per click. That applies to A-axis rotaries, which KerfDesk lacks (X8-P2-1). For a Y rotary LightBurn's Y arrows are machine mm too.
- **Scenario:** turning the glass to put the seam at the back takes trial jogs.
- **Evidence:** READ.
- **Severity:** P3. **Announced?** No. **Novelty:** new. **Build direction:** with the rotary on, label the Y jog in degrees or surface mm and convert by `wrap / 360`.
- **Refuter:** PENDING.

## KNOWN (re-encountered, not raised)

- **D3-P2-2 (P3):** Home is not adapted to the rotary.
  - #1647 (X1-P1-1's fix) adds a route into it: with homing on, the Abort-origin offer now homes first after a controller restart (`unrestored-abort-origin.ts:56-61`). On a Y-port rotary that spins the part until ALARM:9.
  - Generic profiles still ship Home off. The A1 Pro has homing on, but its rotary is not on Y (X8-P2-1).
- **D3-P3-1, D3-P3-2:** no-go zones and positional checks read rotary Y as a bed position. `preflight.ts:236-272` is unchanged.
- **D3-P3-3:** the inspector's wrap ignores Reverse. `gcode-inspection-source.ts` still has no `reverseAxis`.
- **W4-P2-1 / #1641:** camera placement on a rotary (`start-job-readiness-policy.ts:126-162`).

## Refuted

Candidates dropped by the auditor:

- **"Rotary enabled with no diameter emits a flat-bed job."** Unreachable:
  - Rotary Setup's Apply is disabled while the measurements are invalid (`RotarySetupDialog.tsx:26,75`).
  - Machine Setup's fields have `min={0.1}` (`DeviceSetupRotaryFields.tsx:128-140`).
  - The loader refuses non-positive values (`project-device-profile-validator.ts:121-132`).
  - The Job Review fact for an enabled-but-invalid setup says "not applied" (`rotary-summary.ts:41-42`).
- **"Image rows on the chuck band, because 3-decimal Y rounding makes the pitch 0.094/0.100 mm."** Each row is within ±0.0005 machine mm (±3 µm on the surface) of its true place, far under the 0.08-0.1 mm spot (`acc-out.txt`).
- **"A rotary job rapids the part through several turns."** The largest Y rapid in every run was 28.6° (`acc-out.txt`). The finish is set aside on a rotary (`laser-finish.ts:38-40`).
- **"A diameter change after Frame keeps the old Frame."** A chuck's machine-space Frame bounds change with the diameter (`acc-out.txt` Ø80 → Ø60: 4.244 machine mm). The Frame check compares those bounds (`required-frame-readiness.ts:34-44,79-93`). A roller's object diameter does not change its output, so its Frame stays valid by design (ADR-565).
- **"A project saved with the rotary on opens differently on main."** 15/15 cases byte-identical (`ret-out.txt`).
- **"Opening a saved glass project on the same machine silently drops its rotary diameter."** It does keep the current machine's rotary (ADR-500 Amendment 2 Decision 1). Decision 2's info toast names "rotary setup", and LightBurn keeps the rotary setup in its Rotary Setup window, not in the job. Not raised.

## Verified clean

- **Scale law and wrap limit:** chuck, scaled roller and surface-calibrated roller on GRBL, grblHAL, Falcon A1 Pro (grblHAL CoreXY), FluidNC, Marlin and Smoothieware. Full wrap exact, aspect held, anchor held, raster pitch held, diameter rescale held, the over-one-turn warning fires (matrix).
- **Images on the rotary:** rows forced along X with a diagnostic when an angle was set (`compile-job-raster.ts:139-150`); bidirectional rows and overscan stay on X; the energy per mm equals a flat bed.
- **Returning user:** 1.0.29 saves → main, 15/15 byte-identical across five setups and three placements.
- **Frame, ETA and Job Review route through `machineSpaceJob`:** `frame-bounds-preview.ts:34`, `required-frame-readiness.ts:81`, `live-job-estimate.ts:178`, `prepared-job-metrics.ts:52`.
- **Abort and re-run on a rotary:** the restore puts back the machine-Y origin, which on a Y-port rotary is the same angle, unless a roller slipped. Wording is X8-P3-2; Home-first is KNOWN.
- **Local Vitest** (`zz-x8\vt-rotary.txt`): 29 files, 168 tests passed on `j18-main` with one worker and `--no-experimental-webstorage`. It was launched at 3.48 GB free. The 29 are every rotary test file listed under Scope, plus `burn-rotary-energy`, `use-frame-action.rotary`, `start-job-rotary-camera-placement` and `file-actions-rotary-raster`.

## Not verified

- **Physical rotary output.** ADR-127, ADR-315 and ADR-373 still mark it CLAIMED. No hardware was used, by instruction.
- **The Falcon A1 Pro's rotary connector.** Whether the firmware maps it to Y, A or Z is unverified. The Creality wiki pages returned 404 and the manuals.plus page returned 403. The forum posts cited in X8-P2-1 are user reports.
  - The Creality preset's source URL (`manuals.plus/asin/B0CMXCFNB2`) is titled "CREALITY FALCON Rotary Roller Pro" in search results, while the preset says "Rotary Kit Pro (4-in-1) … chuck". The page could not be read to settle which product and mode the 40 mm figure belongs to.
- **LightBurn's own feed handling on a Y rotary.** No LightBurn doc states whether it converts F, and the forum disagrees. X8-P1-1 rests on the twin, not on parity.
- **Glass on a 455 nm diode.** Whether a blue diode marks clear glass without a coating was not researched from a primary source. LightBurn's rotary pages give no glass guidance. The wet-paper and dish-soap tips are third-party (Epilog wiki, FacFox), so no anchor exists for a finding.
- **Browser:** no rendered UI (Rotary switch, Rotary Setup, Job Review text). The Job Review content was read from the functions that build it (`rotary-summary.ts`, `rotary-raster-qualification-warnings.ts`).
- **Ruida `.rd` rotary** (double scaling with the controller's own rotary settings): out of scope, as in D3.
- **GRBL soft limits (`$20`, ALARM:2) during a rotary job:** not traced, as in D3.

## Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-x8\`. Each runs with `node --import ./register.mjs <file>`. Nothing in the repo was touched except this report.

| File | What it does |
|---|---|
| `register.mjs`, `ts-resolve.mjs` | TS loader (copied from `zz-w4`) |
| `lib.mts` | Harness: real `j18-main` modules, rotary setups, controllers, a modal G-code simulator (absolute/relative, G0/G1, S, M3/M4/M5, F) |
| `acc.mts` → `acc-out.txt` | §2 matrix: 6 controllers × 3 setups × full wrap, aspect, raster, oversize, plus the Ø60 rescale |
| `spd.mts` → `spd-out.txt` | X8-P1-1: surface speed for line and fill at 0°, 90° and 45°, plus the inspector's own dose |
| `axis.mts` → `axis-out.txt` | X8-P2-1: axis words emitted, presets offered to the A1 Pro, Job Review rotary fact and warnings |
| `taper.mts` → `taper-out.txt` | X8-P2-2: tapered tumbler, squares at the rim and the base |
| `ret.mts` → `ret-out.txt` | 1.0.29 save → main open, emitted G-code compared |
| `dump.mts` | Prints the head of an emitted program (debugging) |
| `vt-rotary.txt` | Focused Vitest output |

```json
{
  "area": "X8",
  "id": "rotary-complete",
  "tree": "ffd9fe66b",
  "raised": 7,
  "findings": [
    {"id": "X8-P1-1", "severity": "P1", "kind": "defect", "area": "X8", "file": "src/core/job/rotary-transform.ts", "line": 71, "anchor": "Twin: emitted F vs burn-grid.ts:216-225 surfaceFeed (inspector dose); Contract ADR-127 single machine-space mapping", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "Rotary maps Y only; layer speed is written as machine F, so strokes round the part move the surface at F/scale: 6.3x on the Creality chuck preset (Ø80), ~2x on a stock roller; Y strokes get 15.9% of the X dose per the app's own inspector; 90° fill 16%; no warning"},
    {"id": "X8-P2-1", "severity": "P2", "kind": "missing feature", "area": "X8", "file": "src/core/devices/rotary-presets.ts", "line": 19, "anchor": "Ground truth: LightBurn GCode rotary 'Z Axis or A Axis' for a dedicated port; secondary: A1 Pro rotary on a side connector, Y moves the gantry", "evidence": "REPRO+SOURCE", "verdict": "PENDING", "known": false, "summary": "Y-only rotary output; no A/Z axis; the maintainer's Falcon A1 Pro (CoreXY, rotary on a side connector) is offered the Creality 'Y port' chuck preset and gets X/Y words only"},
    {"id": "X8-P2-2", "severity": "P2", "kind": "missing feature", "area": "X8", "file": "src/core/devices/rotary.ts", "line": 28, "anchor": "Ground truth: LightBurn Taper Warp; app names tapered parts (RotaryMeasureHelper, tutorial)", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "One diameter per setup, no taper warp: an Ø80→Ø70 tumbler burns a 20 mm square 17.75 mm round the narrow end (-11.3%), no note"},
    {"id": "X8-P3-1", "severity": "P3", "kind": "defect", "area": "X8", "file": "src/core/preflight/rotary-bounds.ts", "line": 35, "anchor": "Twin: wrap preview (surface mm) vs wrap warning (machine mm)", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "Over-one-turn warning says 'spans 42.972 mm … (40.000 mm)' for a 270 mm design on a 251.3 mm circumference"},
    {"id": "X8-P3-2", "severity": "P3", "kind": "defect", "area": "X8", "file": "src/ui/laser/unrestored-abort-origin.ts", "line": 103, "anchor": "Contract ADR-127 Amd 1 (rotary Y is rotation, not head position)", "evidence": "READ", "verdict": "PENDING", "known": false, "summary": "Abort-origin offer on a rotary describes the part's turn as the head's distance in Y mm"},
    {"id": "X8-P3-3", "severity": "P3", "kind": "missing feature", "area": "X8", "file": "src/core/devices/rotary-presets.ts", "line": 19, "anchor": "Contract ADR-503 item 4", "evidence": "READ", "verdict": "PENDING", "known": false, "summary": "Only one rotary preset (Creality chuck); none for xTool, Ortur, Sculpfun, Atomstack, LaserPecker"},
    {"id": "X8-P3-4", "severity": "P3", "kind": "missing feature", "area": "X8", "file": "src/ui/state/laser-jog-warnings.ts", "line": 93, "anchor": "LightBurn Move window rotational jog in degrees (A-axis)", "evidence": "READ", "verdict": "PENDING", "known": false, "summary": "No degree or surface-mm jog for the rotary; Y jog is machine mm (10 mm = 90° on the chuck preset)"}
  ]
}
```

## Refuter (2026-11-09)

- **When:** 2026-11-09 23:55 to 2026-11-10 01:40 +0800. **Tree:** `ffd9fe66b`. The repro tree `j18-main` matches it: six rotary, emit and raster files hash the same.
  - `git log ffd9fe66b..origin/main -- src` (origin/main = `308ad5456` in this checkout) shows only `cfbcc9663` (X6 relief tabs). It touches no rotary file.
- **Method:**
  - Own harness `zz-x8r\h.mts`. It builds and emits through the real `j18-main` modules, but its G-code reader and its rotary kinematics are its own. The kinematics are written from the hardware, not from `rotary.ts`:
    - chuck: surface per machine-Y mm = π·D_object ÷ mm per turn;
    - roller: π·D_roller ÷ mm per turn;
    - surface-calibrated roller: 1.
  - Nothing from `zz-x8` was imported.
  - Node only: no Vitest and no browser. Free memory was 2.4–2.6 GB.
- **Web:** LightBurn docs and forum, and Creality's forum, read on 2026-11-10. The Creality wiki rotary pages returned 404, and manuals.plus returned 403.

### Verdicts

#### X8-P1-1: CONFIRMED P1, with the direction corrected (the burn can be too light or too dark, depending on the setup)

- **Physics (own model, `r1-speed-out.txt`):**
  - The controller runs `F` as machine mm/min over the commanded XY vector. A rotary Y move of `s·d` machine mm turns the surface `d` mm. So the surface moves at `F / s`, where `s` is KerfDesk's Y scale (the inverse of the physical surface-per-machine-mm `k`).
  - Diagonals distort by `hypot(dx, dy·k) / hypot(dx, dy)`.

  | Setup (layer Line 1,500, Fill 3,000) | Y scale | Y-stroke surface speed | Y dose | 45° fill dose |
  |---|---|---|---|---|
  | Creality chuck 40 mm/turn, Ø80 glass | 0.159 | 9,425 | **15.9 %** | 71.6 % |
  | Same chuck, Ø150 bowl | 0.085 | 17,671 | **8.5 %** | 71.0 % |
  | Same chuck, Ø10 pen | 1.273 | 1,178 | **127 %** (overburn) | 114.5 % |
  | Roller 40 mm/turn, Ø25 (ADR-373 Amd 1 example) | 0.509 | 2,945 | 50.9 % | 79.4 % |
  | Geared roller 150 mm/turn, Ø26 | 1.836 | 817 | **184 %** (overburn) | 147.9 % |
  | Never-edited new roller (`NEW_ROTARY_SETUP`, 360 mm/turn, Ø25: `rotary-setup-edit.ts:28-31`, `rotary.ts:44-49`) | 4.584 | 327 | **458 %** (overburn) | 331.7 % |
  | Surface-calibrated roller | 1 | 1,500 | 100 % | 100 % |

  - The headline's "travels over the glass faster than the speed the operator set" holds only when the Y scale is below 1. A scale above 1 (small parts in the chuck, geared rollers, the untouched placeholders) slows the surface. That overburns. On glass, overburning risks chipping.
  - The finding stands either way: the dose per surface mm depends on stroke direction, and it is not what the operator set.
  - The same table held on the Falcon A1 Pro profile (identical bytes path). On that machine, however, Y is not the rotary (see X8-P2-1).
- **Reach:**
  - The default layer mode is Line (`src/core/scene/layer.ts:143`), so a name or outline typed onto a glass hits this by default.
  - Fill cross-hatch (`fillCrossHatch`, `layer.ts:161`): the 0° pass burns at 100 % and the 90° pass at 15.9 % on the chuck preset.
  - Fill at 0° and images: 100 %. Rows run along X at the layer feed, with no lit non-X move (`r3-raster-out.txt`). The auditor's raster claim holds for speed; see X8-P2-3 for row placement.
- **Twins:**
  - ETA, Frame and Job Review metrics route through `machineSpaceJob`, so the time agrees with the emitted program. Nothing contradicts the program.
  - The inspector is the only twin that models the surface. Its conversion is an ADR clause, not just a code comment. ADR-501 D1 (`docs/decisions/ADR-501-burn-preview-by-energy.md:19`): "On a rotary, one machine Y millimetre moves `pi * diameter / wrapY` surface millimetres."
  - So the project's own decision text says Y travel is not surface travel. The emitter still writes the layer speed as `F`.
- **Warning check (METHOD §3):**
  - Job Review's Rotary row is warning-toned (`src/ui/laser/job-review/job-review-live-rows.ts:138-145`, `'warning'` at :144). It reads "Enabled · Chuck, Ø80 mm · Y ×0.16, one revolution = 40 machine mm" (`r2-axis-out.txt`) and names no speed or dose.
  - ADR-315 D4 (`DECISIONS.md:19932-19936` at `ffd9fe66b`) deliberately gives vector-only jobs no rotary disclosure ("Vector-only, inactive, flat-bed, selected-without-raster, and CNC jobs receive no such warning").
  - No clear warning of the mismatch reaches the operator, so the P1 cannot be lowered.
- **LightBurn parity: UNVERIFIED, leaning "LightBurn does the same".**
  - No LightBurn doc or staff post says whether F is converted. [RotaryModeGCode 2.1](https://docs.lightburnsoftware.com/2.1/Reference/RotaryMode/RotaryModeGCode/) has no sentence on feed or surface speed (fetched 2026-11-10).
  - Users report the identical symptom under LightBurn. On a chuck, horizontal cuts were fine and vertical cuts barely cut: "I don't think Lightburn takes this into account." (user Michl73, [Chuck Rotary Speed](https://forum.lightburnsoftware.com/t/chuck-rotary-speed/187071), fetched 2026-11-10).
  - In a Marlin Y-port chuck thread, the speeds came right only after changing the Y steps/mm and mm-per-rotation ratio, which changes nothing if F were rescaled ([thread](https://forum.lightburnsoftware.com/t/rotary-engraver-burning-lighter-on-the-x-axis-than-on-the-y-axis/139773)).
  - These are user posts, not staff. Even if LightBurn behaves the same, METHOD §3 rates the physical output, and parity does not make it right. Parity only bears on the fix choice: convert F, or warn.
- **Fix note:**
  - `F_layer × L_machine ÷ L_surface` raises the machine feed when the Y scale is above 1 (pen: 1,910 for a 1,500 layer).
  - Clamp the result to the profile's `maxFeed` and the controller's `$111`. Say so when the clamp bites.

#### X8-P2-1: RE-RATED P2 → P1 (on the maintainer's Falcon A1 Pro, Start moves the gantry with the beam lit instead of turning the rotary; no warning)

The generic "no A or Z axis" gap stays inside this finding.

- **New ground truth: the controller's own axis report.**
  - A published A1 Pro `$I`/`$$` gives `[AXS:4:XYZA]`, `[KINEMATICS:CoreXY v2.02]`, `$103=8.900`, `$113=36000.000`, `$133=999.000` and `$376=0`. Source: [LightBurn forum topic 177926, post 3](https://forum.lightburnsoftware.com/t/several-errors-in-the-same-work-creality-falcon-a1-pro/177926/3), user serjforius, 2025-08-19, fetched 2026-11-10, quoted rows verbatim.
  - The same rows are pinned in the repo: `src/__fixtures__/controllers/falcon-a1-pro-dump.ts:17,29,81,85,93,130` at `ffd9fe66b`.
  - Z is the autofocus axis (`falcon-profiles.ts:42`, `autofocusCommand: '$HZ1'`; `$132=33`). The fourth axis, A, has its own steps, rate and a 999 travel. That is the side connector Creality's forum user describes ("the black 4-pin plug goes into the side of the A1 Pro", [Creality forum](https://forum.creality.com/t/falcon-a1-pro-rotary-issue/45961)).
  - LightBurn users on the A1 Pro report that A is "the only one that will actually spin it a full 360" ([Rotary Pro Set Up](https://forum.lightburnsoftware.com/t/rotary-pro-set-up/188587), user Sirbum).
  - A second thread says that with Y "the laser moves on the x and y-Axis" and the rotary does not turn ([Rotary setup Falcon A1 Pro](https://forum.lightburnsoftware.com/t/rotary-setup-falcon-a1-pro/189774)).
- **REPRO (`r2-axis-out.txt`):** A1 Pro profile (`kinematics: 'corexy'`, `falcon-profiles.ts:27`; `'rotary'` capability, `:62`). It is offered `creality-rotary-kit-pro-chuck` with its "on the Y port" text (`rotary-presets.ts:23-26`). Applying the preset through `editRotaryPreset` and enabling the rotary gives:
  - the program's axis words are **X, Y only**;
  - a 50 mm tall Line square emits lit Y strokes over **7.958 machine mm**;
  - `preflight.ok = true`, with 0 issues and 0 rotary warnings;
  - Test rotation's "Turn chuck once" plan is `dy ±40` (`rotary-test-rotation.ts:62-84`).
- **What the operator gets:**
  - On CoreXY, Y drives both belts, so the head travels 7.96 mm across the glass with the beam lit. A 16 %-height, unwrapped copy of the design is burned onto the top of the glass, partly out of focus, while the glass does not turn.
  - That is wrong physical output (position and scale) with no warning. METHOD §3 has no reach clause.
  - The Test rotation would show the gantry moving, but it is optional. Frame is not a warning (METHOD §3, G6 clarification).
- **Residual doubt (why this is not stronger than SOURCE):**
  - Nobody has run KerfDesk on an A1 Pro with the rotary fitted.
  - One forum user guesses Falcon Design Space "deactivates the Y-axis", which would mean a vendor rotary mode that KerfDesk does not send either.
  - Either way KerfDesk's program does not turn the A1 Pro's rotary.
- **Also:** the auditor's accuracy matrix lists "Falcon A1 Pro" as exact on every check. That holds only if Y turned the part, which on the A1 Pro it does not. See Challenges.
- **Minimum fix:**
  - Withdraw the rotary preset (or the `'rotary'` capability) from CoreXY / 4-axis profiles until a `rotaryAxis` setting emits A.
  - Have Rotary Setup say that the rotary must replace the Y motor.

#### X8-P2-2: RE-RATED P2 → P3 (missing feature; the output is what the entered diameter implies, and KerfDesk's own advice keeps the error small)

- **No claim is made.** Grep of `src/ui`, the tutorials and `core/devices`: "tumbler" appears nowhere in the UI. "Tapered" appears only in:
  - `RotaryMeasureHelper.tsx:3` ("calipers cannot do on a tapered cup");
  - `placement-tutorials.ts:196` ("for a tapered or soft part, use Measure with a strip where the artwork goes").

  No ADR claims taper support.
- **Magnitude with KerfDesk's advice, not LightBurn's.** The auditor's −11.3 % entered the largest diameter, which is LightBurn's advice. KerfDesk tells the operator to measure where the artwork goes. Own model (`r5-taper-out.txt`, Ø80→Ø70 over 100 mm):
  - a 30 mm logo is off by ±2.0 %;
  - a 60 mm name by ±4.0 %;
  - a full 100 mm wrap by ±6.7 %.
- **Focus is the bigger effect.** The surface drops 1.5 mm across a 30 mm logo unless the part is tilted level. LightBurn's Taper Warp does not fix that either.
- **Rating:** METHOD P2 needs wrong behaviour with a misleading result. The output is exact for the diameter entered, and the gap is a missing LightBurn tool. P3, plus a one-line tutorial note that a full-length design on a tapered part fans.

#### The P3s

- **X8-P3-1: CONFIRMED P3**, with a stronger example. Own input (`r4-wrap-out.txt`): a 40 mm design on a Ø10 pen (31.42 mm circumference) is reported as "spans 50.930 mm in Y, more than one turn of the object (40.000 mm)". Both numbers exceed the design and the part.
  - Correction to the auditor's matrix: this is a blocking preflight error (`ok=false`), not a warning. That matches ADR-127 ("a job taller than one revolution is refused").
- **X8-P3-2: CONFIRMED P3** (READ). The text is at `src/ui/laser/unrestored-abort-origin.ts:103`. It has no rotary branch.
- **X8-P3-3: CONFIRMED P3** (READ). It is still worth fixing that the one preset reaches a machine it does not fit (X8-P2-1). The preset's source stays UNVERIFIED: manuals.plus returned 403 again.
- **X8-P3-4: CONFIRMED P3** (READ, `head-move-dispatch.ts:105-115`).

### Challenges to "Verified clean" and the headline

- **"Images … the energy per mm equals a flat bed":** true along a row, false per area on the chuck. Rows land on the controller's step grid, not the line interval. See X8-P2-3.
- **"On every controller KerfDesk drives … the geometry holds" and the matrix's Falcon A1 Pro cells:** these are emitted-program checks. On the A1 Pro, Y is the gantry and the rotary is on A, so no cell describes what that machine does (X8-P2-1).
- **Headline "every stroke that runs round the part … travels faster":** the direction depends on the scale (X8-P1-1 table). Ø10 pens, geared rollers and the untouched placeholders overburn.
- **"Artwork taller than one turn is warned":** it is refused (preflight error), which is stricter. No change to severity.
- **Diameter change after Frame, and save → reopen (`r6-reopen-out.txt`, own inputs):**
  - The `.lf2` round trip keeps `device.rotary`.
  - Ø80→70 and Ø80→80.2 change both bytes and the Frame signature, under both placements.
  - Chuck→roller and Rotary off also change both.
  - Observation, not raised: toggling Reverse changes the bytes but not the Frame bounds signature (centre anchor under Current Position, and Absolute). A completed Frame therefore stays reusable (`framed-start-preparation.ts:100-116`).
    - The traced envelope is identical, so nothing physical is missed.
    - ADR-373's Consequences say "any change to the mapping … expires a completed Frame". That is a wording drift at most. Not traced through Start, so not raised.
- **Inch display units:** Rotary Setup's fields stay labelled `mm` (`RotaryObjectFields.tsx:34,43`). ADR-629 D3 and D5 say that is the honest first-increment state, so no finding. The jog step follows the preference in machine units (X8-P3-4).
- **Mirror (Reverse) on raster:** the row count and pitch are identical to forward (`r3-raster-out.txt`). The inspector's wrap ignoring Reverse is KNOWN (D3-P3-3).
- **Frame on the rotary:** Frame uses the profile's `framingFeedMmPerMin` with no rotary adjustment. On a Y-port roller (40 mm/turn, Ø25) a 10,000 mm/min Frame moves the surface about 19,600 mm/min. Whether a glass slips on rollers at that rate was not tested (see Not verified). LightBurn also takes Frame speed from device settings.

### New findings

#### X8-P2-3: On a chuck, image rows land on the controller's Y step grid, not the line interval: uneven pitch (banding), and rows burned twice on large parts; no warning

- **Kind:** defect, with a missing check.
- **Where (`ffd9fe66b`):**
  - `src/core/job/compile-job-raster.ts:139-151` forces rows along X but keeps the layer's line interval (default 10 lines/mm, `layer.ts:163`).
  - The rotary Y scale then shrinks each row step to `0.1 × s` machine mm (`rotary-transform.ts:123-129`).
  - KerfDesk already reads `$101` (`src/core/controllers/grbl/parse-settings.ts:344`). No rotary or raster check uses it.
- **Mechanism:**
  - GRBL plans in whole steps. One Y step on the Creality chuck turns the surface `π·D ÷ (40 × $101)`.
  - At `$101=80` that is 0.0785 mm on Ø80 and 0.147 mm on Ø150. The 0.1 mm rows cannot be placed evenly.
  - This is invisible on a flat bed (0.0125 mm steps divide 0.1 exactly).
- **REPRO** (`r3-raster.mts`): own step model, `lround(y × steps/mm)`, on the emitted rows of a solid 10 mm image, 100 rows at 10 lines/mm.

  | Setup | `$101` | Surface pitch (count of 99) | Rows on top of another row |
  |---|---|---|---|
  | Flat bed | 80 | 0.1000 (99) | 0 |
  | Chuck Ø80 | 80 | 0.0785 (72) and **0.1571** (27) | 0 |
  | Chuck Ø150 | 80 | 0.1473 (68) and **0.0000** (31) | **31**: double dose on those lines |
  | Chuck Ø80 | 100 | 0.0628 (41) and 0.1257 (58) | 0 |
  | Chuck Ø150 | 100 | 0.1178 (85) and 0.0000 (14) | 14 |
  | Chuck Ø80 | 160 | 0.1178 (54) and 0.0785 (45) | 0 |

  - The forward and reversed runs are identical (`r3-raster-out.txt`, `r3-raster-steps-out.txt`).
  - At `$101=80` every part over about Ø102 in the Creality chuck gets duplicate rows at 10 lines/mm.
  - The roller (40/Ø25) jitters less: 0.098 and 0.123 mm.
- **Scenario:** the maintainer engraves a photo on a Ø80 glass with the Creality preset at the default 10 lines/mm.
  - Every fourth gap is twice as wide as the rest (0.157 against 0.079 mm), with a 0.08–0.1 mm spot. That is a regular stripe about every 0.4 mm.
  - On a Ø150 bowl, about a third of the rows burn twice at full dose.
  - The preview and the inspector show even rows.
- **Anchor:**
  - Twin: the preview's even rows against the motion the controller can execute.
  - Contract: the line interval is the row pitch on the material. ADR-492 item 9 keeps rows along X so that they stay straight and evenly pitched on a rotary.
- **Evidence:** REPRO, with own model. The emitted machine Y is exact to 3 decimals. The defect is step quantisation, which the app can predict from `$101`. `$101` for a Falcon Y port with this chuck is assumed, so 80, 100 and 160 were all run, and the effect holds at each.
- **Severity: P2.**
  - **For P2:** an ordinary photo-on-glass job on the shipped preset, and the preview shows a uniform result.
  - **Against P1:** the program commands the right rows. The controller's step resolution sets what is physically possible, and the same rounding governs any flat-bed interval that is not a step multiple. The fault is the missing check.
  - **For P1 (left to the ledger):** METHOD §3 "power" covers the double-dosed rows on large parts.
- **Announced?** No. **Novelty:** new. It is not in D3, L10 or X1–X7. The auditor's "rows within ±3 µm" checked only G-code decimal rounding.
- **Fix direction:**
  - On an active rotary with a known `$101`, snap the image row pitch to a whole number of surface steps (on Ø80 at 80 steps/mm: 12.73 or 6.37 lines/mm). Name the change in Job Review.
  - When `$101` is unknown, warn that the rotary's step size may band rows.
  - LightBurn's handling is unverified.

### Not verified

- **No hardware**, by instruction: no rotary, no A1 Pro, no glass. Every physical figure comes from the own kinematic and step models.
- **The A1 Pro's rotary routing on the maintainer's machine.** The axis report and user posts point to A. Whether a vendor "rotary mode" command could route Y to the side port is unknown. Ask the maintainer for `$I` and `$$` with the rotary fitted, then try a beam-off `$J=G91 A10 F600`.
- **LightBurn's own F handling** on a Y rotary. Only user reports are available (above); there is no staff or doc statement.
- **Whether LightBurn snaps raster pitch to rotary steps** (X8-P2-3 parity).
- **`$101` for a Falcon2-class Y port** with the Creality chuck. The preset's 40 mm per turn source (manuals.plus) returned 403. The Creality wiki rotary-kit pages returned 404, so the "right-side interface" wording is from a search snippet only (UNVERIFIED).
- **Glass slip on rollers** at Frame and rapid feeds. **Whether a Reverse toggle after Frame** reaches Start without a new Frame (only the bounds signature was checked).

### KNOWN re-encountered (not raised)

- **D3-P3-3:** the inspector's wrap ignores Reverse.
- **D3-P3-1 / D3-P3-2:** positional checks read rotary Y as a bed position. `configuredMotionBounds` clamps rotary jogs to `[0, wrap]` machine mm (`src/ui/state/laser-jog-warnings.ts:92-94`).

### Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-x8r\`.
- Run each `.mts` with `node --no-experimental-webstorage --import ./register.mjs <file>`. `r3` takes `STEPS=<n>`.
- Run `r5` with plain `node`.
- Nothing in the repo was touched except this section.

| File | What it does |
|---|---|
| `register.mjs`, `ts-resolve.mjs` | TS loader (copied from `zz-w4`) |
| `h.mts` | Own harness: hardware kinematics, G-code reader, surface-speed conversion, project builder on real `j18-main` modules |
| `r1-speed.mts` → `r1-speed-out.txt` | X8-P1-1: 7 setups × Line, Fill 0°, 90°, 45° and cross-hatch; surface speed and dose per stroke class; GRBL and A1 Pro |
| `r2-axis.mts` → `r2-axis-out.txt` | X8-P2-1: A1 Pro axis report, preset offered and applied, Job Review fact, Test rotation legs, axis words, lit Y span, warnings |
| `r3-raster.mts` → `r3-raster-out.txt`, `r3-raster-steps-out.txt` | X8-P2-3: image rows through a step-quantising controller at 80, 100 and 160 steps/mm, forward and reversed |
| `r4-wrap.mts` → `r4-wrap-out.txt` | X8-P3-1: over-one-turn wording on Ø80 (300 mm) and the Ø10 pen (40 mm) |
| `r5-taper.mjs` → `r5-taper-out.txt` | X8-P2-2: taper error under KerfDesk's and LightBurn's advice, plus the focus shift |
| `r6-reopen.mts` → `r6-reopen-out.txt` | Save → reopen → diameter, Reverse, type and on/off: bytes against the Frame bounds signature |

```json
{"area":"X8","refuter":"2026-11-09","tree":"ffd9fe66b","verdicts":[
 {"id":"X8-P1-1","verdict":"CONFIRMED","severity":"P1","note":"direction is F/scale: underburn for scale<1, overburn for scale>1 (Ø10 pen 127%, geared roller 184%, NEW_ROTARY_SETUP 458%); ADR-501 D1 anchor; LightBurn users report same symptom (UNVERIFIED parity)"},
 {"id":"X8-P2-1","verdict":"RE-RATED","severity":"P1","note":"A1 Pro $I [AXS:4:XYZA] with A configured (forum 177926/3; fixture falcon-a1-pro-dump.ts:17); CoreXY; preset+rotary capability offered; emits X,Y only, 7.958 mm lit gantry Y, no warning"},
 {"id":"X8-P2-2","verdict":"RE-RATED","severity":"P3","note":"no taper claim; with KerfDesk's measure-where-the-art-goes advice error is ±2% (30 mm logo) to ±6.7% (full wrap)"},
 {"id":"X8-P3-1","verdict":"CONFIRMED","severity":"P3"},
 {"id":"X8-P3-2","verdict":"CONFIRMED","severity":"P3"},
 {"id":"X8-P3-3","verdict":"CONFIRMED","severity":"P3"},
 {"id":"X8-P3-4","verdict":"CONFIRMED","severity":"P3"},
 {"id":"X8-P2-3","verdict":"NEW","severity":"P2","file":"src/core/job/compile-job-raster.ts","line":139,"evidence":"REPRO","summary":"Chuck rotary image rows quantised to Y steps: Ø80 pitch 0.0785/0.157 (banding), Ø150 31% rows double-burned at $101=80; app reads $101 but never checks"}
]}
```

Refuter counts: raised 1, refuted 0, P1 2, P2 1, P3 5, known 2
