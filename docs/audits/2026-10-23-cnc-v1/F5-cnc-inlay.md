# CNC audit v1 — F5 Inlay pairs (`cnc-inlay`)

- **When:** 2026-10-23   **Tree:** worktree `claude/rolling-audit-20261021` @ `1f29a5700`. Its `src/core/cnc`, `src/ui/layers`, `src/core/min-feature`, `src/core/geometry`, `src/core/output` and `src/core/scene` are identical to origin/main `87ecb4f24` (fetched 2026-10-23, `git diff` empty).
- **Scope:** `src/core/cnc/inlay-pair.ts`, `inlay-pair-operation.ts`, `tapered-inlay.ts`, `tapered-inlay-geometry.ts`, `tapered-inlay-settings.ts`, `tapered-inlay-operation.ts`, `cnc-inlay-issues.ts`, the inlay wiring in `compile-cnc-operation-groups.ts`, and the UI in `src/ui/layers/CncInlayFields.tsx`, `CncTaperedInlayFields.tsx` and `tapered-inlay-value-patch.ts`. Also read: `vcarve-medial-floor.ts` (F1 root cause) and `src/core/min-feature/operation-targets.ts` (ADR-433 twin).
- **Governing:** ADR-155 (straight pair), ADR-312 item 5 (physical-right placement), ADR-540 Amd 6 (tapered = Pro), ADR-250 Amd 2/3, ADR-258 Amd 1/3, ADR-285, ADR-433. The 2026-10-08 leaders plan C09 (`docs/audits/2026-10-08-cnc-leaders/IMPLEMENTATION.md:124-134`) is the only design record for the tapered pair; no ADR governs its geometry. PROJECT.md H.17 and rule 7.
- **Lenses run:** L1, L2, L3, L4 and L7, each as a separate pass. L6 was light: failure flags reach `cnc-inlay-invalid` and the offset-ladder diagnostics. L5 was skipped: the only untrusted input is a project file, and `normalizeCncTaperedInlay` (finite, 0–1000, P = E + g) was read and is covered by the project-I/O areas.
- **Counts:** 5 raised → 0 refuted, 1 merged (F5-P2-2 into F1-P2-1) → P1 0 / P2 2 / P3 2 (+ 3 KNOWN re-observed). Refuter: 4 confirmed, 0 plausible, 0 refuted, 1 merged; no severity changes.

## Headline

An independent oracle compiled 14 pairs through the real path (`compileCncJob` → `cncGrblStrategy.emit`):
- tapered pairs: a heart, a 30 mm square with a 12 mm square island, and 40 mm Roboto "AB", each on 60° and 90° ½" V-bits with the default intent (pocket 3, engagement 2.5, glue 0.5, surface 1, radial 0.05), plus five variants;
- straight pairs: the same three designs with the default ⅛" end mill.

It parsed the G-code, swept an exact cone (V-bit) or flat cylinder (end mill) along every move, mirrored the plug, and dropped it into the pocket until first contact.

**The straight pair fits:** zero interference and a uniform gap at every corner (AC-1 holds).

**No tapered pair seats as designed.** Two independent causes:
1. **Floor fins (F5-P2-2, merged into F1-P2-1 by the refuter).** The F1-P2-1 floor fins in the pocket stand 0.53–0.91 mm, taller than the 0.5 mm glue gap. The plug face lands on them 0.37–0.67 mm short of wall contact, which leaves an open seam 0.22–0.66 mm wide around the whole inlay.
2. **The plug construction (F5-P2-1).** The plug is cut as an *opening* of the source: an eroded top that the V-bit regrows from Z0. The reference *start-depth* V-carve keeps the plug wall parallel to the pocket wall; this construction does not. As a result:
   - every convex corner is rounded by E·tan(θ/2)+c, leaving voids 0.60–1.08 mm wide even in a fin-free pocket;
   - every stroke narrower than 2(E·tan(θ/2)+c) (2.99 mm at 60°, 5.1 mm at 90°) is missing from the plug. 30 mm "AB" loses 80 % of its letters, and 25 mm (60°) or 40 mm (90°) "AB" is refused outright.

Job Review says this detail "cannot be reproduced". It can: the same bit swept along the outline at a start depth of E+c/tan(θ/2) leaves gaps of at most 0.03–0.15 mm.

The straight pair has a separate gap (F5-P2-3): it silently drops strokes narrower than the bit, such as the A's crossbar and the B's bars, from both halves. An ordinary pocket of the same text gets an ADR-433 warning; the inlay gets none.

## Measurements

**Method:** `f5-oracle.mjs`, 0.03 mm grid, exact per-move cone minimum, Felzenszwalb EDT.
- **Seat** = the depth of the plug face below the pocket top at first contact.
- **Wall contact** = E + c/tan(θ/2), where a clean pair would stop.
- **Seam** = (wall contact − seat)·tan(θ/2).
- **Gap** = the widest void at the visible glue line (Z −0.02), measured from the pocket wall to the plug.
- **Ideal pocket** = source eroded by z·tan(θ/2), flat at P.
- **Start-depth plug** = the same V-bit swept along the source outline with its tip at E + c/tan(θ/2), with the waste at E + S. This is the reference construction, simulated with the oracle's own sweep.

| Design / bit | Emitted pair: seat vs wall contact (interference) | Emitted pair: worst gap | Emitted plug in ideal pocket: worst gap | Start-depth plug in ideal pocket: worst gap | Expected | Source |
|---|---|---|---|---|---|---|
| Heart, V60 | 1.920 vs 2.587: stops 0.667 short on a 0.914 mm floor fin (heart notch) | 1.47 mm at the tip; 0.385 mm seam all round | 0.87 mm at the tip (seat 2.557) | 0.15 mm (seat 2.561) | Seat 2.587, gap ≈ 0 (c = 0.05 if held at E), glue 0.5 | Vectric Start Depth; UI glue-gap text |
| Heart, V90 | 1.887 vs 2.550: 0.663 short, 0.851 mm fin | 2.13 mm; 0.663 mm seam | 1.08 mm (seat 2.533) | 0.042 mm (seat 2.535) | Seat 2.55, gap ≈ 0 | same |
| Square + island, V60 | 2.213 vs 2.587: 0.374 short, 0.541 mm fin at island corners | 0.81 mm; 0.216 mm seam | 0.60 mm at the outer corners (seat 2.571) | 0.042 mm (seat 2.578) | Seat 2.587, gap ≈ 0 | same |
| Square + island, V90 | 2.182 vs 2.550: 0.368 short, 0.530 mm fin | 1.38 mm; 0.368 mm seam | 1.02 mm (seat 2.539) | 0.030 mm (seat 2.545) | Seat 2.55, gap ≈ 0 | same |
| "AB" 40 mm, V60 | 2.017 vs 2.587: 0.570 short, 0.580 mm fin | 0.91 mm; 0.329 mm seam | 0.63 mm (seat 2.531) | 0.067 mm (seat 2.561) | Seat 2.587, gap ≈ 0 | same |
| "AB" 40 mm, V90 | No output: "No source detail is wide enough…" | — | — | not simulated (no pocket G-code) | A plug exists (strokes ≈ 3.6 mm fill their grooves) | Carbide 3D start-depth method |
| "AB" 30 mm, V60 | 2.574 vs 2.587 (no flat floor, so no fins) | 11.83 mm: 232.7 of 295.8 mm² of the glue line is void | 11.86 mm (236.6 mm² void) | 0.042 mm (6.3 mm² hairline) | Plug fills every groove | same |
| "AB" 25 mm, V60 | No output (refused) | — | — | — | Plug exists | same |
| Heart, V60, S 0.3, g 0.2 | 1.920: 0.823 mm fin vs a 0.2 glue gap | 1.47 mm | 0.87 mm | 0.15 mm | Seat 2.587 | same |
| Square + island, V90, c 0.6 | Fin-free: plug bottoms at P = 3.000 before the walls (3.05) | Wall gap 0.05, not 0.6; glue gap 0, not 0.5 | — | — | UI: "independent" radial 0.6 + glue 0.5 | Cone geometry |
| Square + island, V60, c 0.3, g 0.2 | Fin-free: bottoms at P = 2.700 | Radial ≤ 0.185, not 0.3; glue 0 | — | — | UI: radial 0.3 + glue 0.2 | same |
| Heart / island / "AB", straight ⅛" | Interference 0 / 0 / 0 | 0.12 / 0.12 / 0.15 mm (grid 0.03) | — | — | 0.1 mm per side | ADR-155, Carveco |
| "AB" 40 mm, straight ⅛" | — | — | — | — | Crossbars present | ADR-433 twin |

In the "AB" 40 mm straight pair, 59.2 of 525.6 mm² of the source is pocketed in neither half. The missing area is the A's crossbar and the B's three bars, and the B insert comes out as separate pieces (F5-P2-3).

Further measurements:
- **Pocket wall over-cut** against the ideal pocket: 0.004–0.025 mm in every case, inside ADR-453's 0.025 mm flattening.
- **Contacts:** every emitted-pair contact was plug face on a floor fin; none was a wall.
- **Plug waste-floor fins:** up to 0.39 mm. They stayed clear of the pocket surface at S = 1 and on the heart at S = 0.3.

## Findings

### F5-P2-1 — The tapered plug is an opening of the source, not the pocket wall offset by the fit gap: convex corners and narrow strokes are missing, and Job Review calls them unreproducible when the reference construction reproduces them

- **Where:**
  - `src/core/cnc/tapered-inlay.ts:47`: `plugTop` = source inset by E·tan(θ/2)+c.
  - `:62`: waste = border − `plugTop`.
  - `src/core/cnc/tapered-inlay-operation.ts:47-52`: the waste is V-carved from Z0, so at plug depth d the plug is `plugTop` ⊕ d·tan(θ/2).
  - `tapered-inlay.ts:51`: the refusal.
  - `tapered-inlay.ts:114`: the message "…cannot be reproduced at the nominal engagement."
- **Anchor:**
  - **Ground truth.** Vectric V-Carve: "Start Depth (D) specifies the depth at which the V-Carving toolpath is calculated" ([Vectric V-Carve Toolpath](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/VCarve%20Toolpath%20Creator)). The Carbide 3D inlay method lowers Z so the plug's design lines sit at that depth ([community 20828](https://community.carbide3d.com/t/using-advanced-vcarve-in-carbide-create-461-to-make-inlays/20828)), and "The 'Start Depth' is the amount the inlay will insert into the pocket before the design matches up" ([community 28552/4](https://community.carbide3d.com/t/inlay-with-carbide-create-with-advanced-v-carv/28552/4)). A plug carved that way is the source eroded by (E−d)·tan(θ/2)+c at every level: the pocket wall offset by c, sharp convex corners kept, narrow strokes kept as ridges.
  - **Twin.** `taperedInlayContactAtDepth` (`tapered-inlay-settings.ts:81-91`) claims a constant radial gap c on every wall; the emitted plug breaks this at every convex corner.
  - **Contract.** C09 accepts disclosing *unreachable* details (`IMPLEMENTATION.md:134`); these details are reachable with the same bit.
- **Scenario (emitted plug in a fin-free ideal pocket, so F5-P2-2 is excluded):**
  - Default intent: corner voids at the glue line are 0.87/1.08 mm (heart tip, 60°/90°), 0.60/1.02 mm (square corners) and 0.63 mm ("AB", 60°). The start-depth plug cut with the same bit leaves 0.15/0.042, 0.042/0.030 and 0.067 mm.
  - 30 mm Roboto "AB" on a 60° bit: 236.6 of 295.8 mm² (80 %) of the letters has no plug material. Job Review reports "242.616 mm² … cannot be reproduced". The start-depth plug leaves a 0.042 mm hairline.
  - 25 mm "AB" (60°) and 40 mm "AB" (90°) produce no pair at all.
- **Evidence:** REPRO.
  - Compile: `node ../../../node_modules/vitest/vitest.mjs run src/core/cnc/zz-f5-inlay-dump.test.ts` (copy in `scratchpad/f5-repros/`).
  - Measure: `node f5-repros/f5-oracle.mjs f5-out <case> 0.03`, run from the scratchpad. The fields `surface_emittedPlug_idealFemale_atSeat` and `surface_startDepthPlug_idealFemale_atSeat` hold the results above.
  - The start-depth sweep matches the analytic eroded plug within 0.013–0.026 mm on the square and 40 mm "AB", and 0.083 mm on 30 mm "AB". At the heart's notch cusp it differs by 0.15–0.25 mm; that was not traced.
- **Refuter:** CONFIRMED, P2 kept. The refuter tried three ways to break it:
  - **A documented design that accepts the rounding.** There is none.
    - No ADR governs the tapered geometry. ADR-540 Amd 6 only classes the pair as Pro, and ADR-155 leaves tapered plugs to "a separate model".
    - C09 (`IMPLEMENTATION.md:124-134`) names VCarve's V-inlay as the workflow to match, and accepts disclosing only *unreachable* details.
    - `tapered-inlay.test.ts:94-102` locks in this construction; it does not cite any outside requirement.
  - **A different product.** It is not one. Both pieces are V-carves (`vcarveMedialPasses`, `tapered-inlay-operation.ts:41-52`), not a tapered (non-V-carved) pocket, and the fields copy VCarve Inlay's Pocket depth, Glue gap and Surface clearance. The refuter re-fetched the VCarve Inlay page (V12.0), Vectric's V-Carve "Start Depth" definition and Carbide 3D 28552/4: the quotes match, and the start-depth method is a fair baseline.
  - **An honest disclosure (P3).** It is only partly honest.
    - Job Review does print the area (`cnc-preflight.ts:139-143`), but it calls the detail unreproducible and adds "Adjust the inlay settings or choose another bit".
    - No setting with E > 0 removes the convex-corner loss.
  - **Independent repro.** Method:
    - The refuter's own designs, compiled through `compileCncJob` → `cncGrblStrategy.emit`.
    - Its own checker (`f5r-check.mjs` + `f5r-main.mjs`): 0.05 mm grid, exact per-move cone minimum, the plug blank trimmed inside its waste border, and a ±0.1 mm lateral shift search.

    Emitted plug in an ideal V pocket:
    - 30 mm square corners, 60°: 0.60 mm void.
    - Tips of a 5-point star (R 15 / 6.5 mm): 2.60 mm at 60° and 4.37 mm at 90° (13.5 / 38.4 mm² void).
    - 40 mm "AB", 60°: 0.60 mm.
    - 30 mm "AB", 60°: 232.5 of 292.8 mm² (79 %) void.
  - **Reachable with the same bit and the app's own engine.** The reference plug was built with the app's **own** `vcarveMedialPasses` on (border − source) at start depth E + c/tan(θ/2), then `offsetStartingPlane`.
    - In every case it seats at 2.544–2.584 mm.
    - Its worst gap is one grid cell (0.05 mm; 0.07 mm on 40 mm "AB" at 90°).
    - This includes the two pairs the app refuses: 25 mm "AB" at 60°, and 40 mm "AB" at 90°.
  - **Severity.** Every tapered pair with a convex corner, and all text, is affected, and the message blames geometry for the loss. P2 holds.
- **Fix direction:**
  - Carve the plug as a V-carve of (border − mirrored source) with the tip on the source outline at depth E + c/tan(θ/2), and the waste floor at E + S. This needs S ≥ c/tan(θ/2). The plug face stays the current `plugTop`.
  - Then limit the lost-detail finding to what the pocket itself cannot hold, and add an emitted-G-code seating test on corners and text.

### F5-P2-3 — The straight inlay pair silently drops strokes narrower than the bit from both halves, while an ordinary pocket of the same artwork gets an ADR-433 warning

- **Where:**
  - `src/core/cnc/inlay-pair.ts:90-96` closes then opens the design by the bit radius (canonical contour).
  - `src/core/cnc/cnc-inlay-issues.ts:43-48` reports only a total failure.
  - `src/core/min-feature/operation-targets.ts:109-118`: `CNC_SIDES` has no `inlay-pair`, and ADR-433 item 1 skips inlay.
- **Anchor:**
  - **Twin.** The ordinary-pocket width check (ADR-433) warns on this geometry. The tapered pair reports its lost area (`tapered-inlay.ts:112-115`).
  - **Contract.** ADR-155: offsets that erase geometry "block preflight instead of producing a partial pair".
- **Scenario:** 40 mm Roboto "AB", default ⅛" end mill, straight pair, pocket 3, insert 6:
  - The A's crossbar and the B's three bars (about 3.0 mm, under the 3.175 mm bit) are pocketed in neither half: 59.2 of 525.6 mm² (11 %).
  - The B insert comes out as separate pieces.
  - The same artwork as a plain pocket reports 3 narrow sites (min 2.57 mm). The inlay pair reports 0 min-feature sites and 0 inlay issues.
  - The tutorial says "Both pieces derive from the same outline".
- **Evidence:** REPRO.
  - `f5-straight-detail.mjs f5-out str-ab-em` gives `sourceNotPocketedMm2: 59.22` (blobs at the crossbar and bars).
  - `zz-f5-minfeature.test.ts` gives `{"pocket":[{"widths":3,"min":2.5676…}],"inlayReports":0,"inlayIssues":[]}`.
- **Refuter:** CONFIRMED, P2 kept, with a narrower anchor.
  - **Repro.** The refuter used its own test and its own flat-cylinder checker (0.03 mm grid), with the default machine bit `em-3175`, on 40 mm Roboto "AB": pocket 3, insert 6.
    - In the emitted program, 59.49 of 526.0 mm² of the source is uncut in the pocket and absent from the insert. At plan level, source minus female contours is 59.35 mm² in 14 pieces.
    - The insert's B comes out as two separate pieces: the stem (123.8 mm²) and the bowls (123.0 mm²).
    - `checkProjectMinimumFeatures` on the same artwork: as a pocket, 3 width sites, narrowest 2.568 mm against 3.175 mm; as an inlay pair, no report. `findCncInlayIssues` returns nothing.
  - **What the refuter tried, and why it does not refute.**
    - ADR-433 decision 1 lists "inlay" among the skipped operations. The missing `CNC_SIDES` entry is therefore documented scope, not twin drift on its own.
    - ADR-155's "offsets that erase either half" reads as erasing a whole half.
    - Neither accepts silent partial loss. The same operation's tapered mode reports its lost area (`tapered-inlay.ts:112-115`), so the finding stands on that twin.
    - The tutorial's Preview step shows the loss only if the user inspects the toolpaths.
  - **Fix.** The fix needs an ADR-433 or ADR-155 amendment.
- **Fix direction:** Report the canonical loss (source − canonical area) the way the tapered pair does, or run the ADR-433 width check on the pair's pocket and insert.

### F5-P3-1 — "Radial fit gap" is not independent of the glue gap: the plug sinks until it touches, so the gap turns into extra depth, and from c ≥ g·tan(θ/2) the plug bottoms on the floor

- **Where:**
  - `src/core/cnc/tapered-inlay-settings.ts:81-91`: `taperedInlayContactAtDepth` assumes the plug face stays at E.
  - `src/ui/layers/CncTaperedInlayFields.tsx:39-42`: "Independent per-side radial gap on reachable taper walls. This is not the axial glue gap."
- **Anchor:**
  - **Ground truth.** Two matching tapers seat by contact, and Vectric's glue gap is the assembled distance ([VCarve Inlay Toolpath](https://docs.vectric.com/docs/V12.5/VCarvePro/ENU/Help/form/VCarve%20Inlay%20Toolpath/)).
  - **Twin.** The contact model disagrees with the seat the emitted pieces reach.
- **Scenario (fin-free pocket):**
  - Default settings: the plug seats at 2.53–2.57 mm, 0.03–0.07 mm deeper than E (expected E + c/tan(θ/2) = 2.587 / 2.55). The walls touch, so the radial gap is 0, and the glue gap is 0.41 (60°) or 0.45 (90°) instead of 0.5.
  - Radial 0.6, 90°, glue 0.5: the plug bottoms at P = 3.000. The glue gap is 0, and the wall gap is 0.05, not 0.6.
  - Radial 0.3, 60°, glue 0.2: the plug bottoms at 2.700. The glue gap is 0, and the radial gap is at most 0.185.
  - Nothing warns.
- **Evidence:** REPRO (oracle fields `emittedPlug_idealFemale`, `idealPlug_idealFemale` and the `var-island-*` cases).
- **Refuter:** CONFIRMED (P3).
  - Mating cones seat at min(E + c/tan(θ/2), P). Refuter seats: the analytic start-depth plug at 2.587 / 2.55, and the emitted plug at 2.576–2.577 on the island and star at 60°. So the radial gap closes, and the glue gap becomes g − c/tan(θ/2).
  - One figure is corrected. At c 0.6, 90°, glue 0.5, the plug bottoms at P, and the horizontal wall gap is c − g·tan(θ/2) = 0.10 mm (0.07 mm normal to the wall), not 0.05.
  - The 60° case (c 0.3, g 0.2: 0.185 mm) checks out.
- **Fix direction:** State the real seat (E + c/tan(θ/2)) and the resulting glue gap (g − c/tan(θ/2)) in the fields. Add an inlay finding when c ≥ g·tan(θ/2), or redefine the radial gap as an axial insertion offset.

### F5-P3-2 — No test seats the emitted plug in the emitted pocket; the fit tests use circles and restate the construction

- **Where:**
  - `src/core/cnc/tapered-inlay.test.ts:49-73` checks the plan's own offsets on circles only. On a circle, opening equals erosion, so F5-P2-1 cannot show.
  - `:94-102` asserts that a 1 mm island is "lost", which locks in F5-P2-1.
  - `compile-cnc-tapered-inlay-text.test.ts` checks the join fraction at Z −0.1 only.
  - `tapered-inlay-operation.test.ts` checks pass shape and planes.
- **Anchor:** **Contract.** The C09 acceptance asks for "analytical wedge/angle fixtures [that] verify contact depth" (`IMPLEMENTATION.md:134`). The METHOD L7 lens asks whether the tests exercise the behaviour itself.
- **Scenario:** Both P2 tapered defects pass the whole suite. The 2026-10-09 "Tapered mating wall" lane checked four cross-sections against the 0.05 mm radial fit, which is the nominal engagement, not the seat the plug reaches.
- **Evidence:** READ (the test files), plus the REPRO above, which fails on every non-circular design.
- **Refuter:** CONFIRMED (P3). The refuter read the four test files that cover the tapered pair:
  - `tapered-inlay.test.ts`: circles at plan level, and `:94-102` asserts the loss.
  - `tapered-inlay-operation.test.ts`: pass shape, planes and regeneration.
  - `compile-cnc-tapered-inlay-text.test.ts`: the join fraction.
  - `project-cnc-tapered-rest.test.ts`: persistence.

  None of them seats the emitted plug in the emitted pocket. The refuter's checker reproduces both tapered effects on non-circular designs that this suite passes.
- **Fix direction:** Add an emitted-G-code seating oracle (cone sweep, mirror, first contact) on a heart, letters and an island. Assert the seat depth and the widest seam.

## Merged by the refuter

### F5-P2-2 — The pocket's flat-floor fins (F1-P2-1) are taller than the default glue gap, so the plug bottoms on them and leaves an open seam all round

- **Where:**
  - `src/core/cnc/tapered-inlay-operation.ts:41-46` and `:105` cut the pocket with `vcarveMedialPasses`, flat floor at the pocket depth.
  - The floor is inset with Miter joins in `vcarve-medial-floor.ts:33` (F1-P2-1).
- **Anchor:**
  - **Contract.** Glue gap is "Axial space between the plug top and pocket bottom at nominal engagement" (`CncTaperedInlayFields.tsx:28`), and `tapered-inlay-settings.ts:43` enforces P = E + g. Per F1, WORKFLOW F-CNC6 and ADR-285 §3 make the floor the mathematical core.
  - **Ground truth.** Vectric's glue gap is the distance between plug top and pocket bottom when assembled ([VCarve Inlay Toolpath](https://docs.vectric.com/docs/V12.5/VCarvePro/ENU/Help/form/VCarve%20Inlay%20Toolpath/)).
- **Scenario:** With default settings, fins stand 0.53–0.91 mm above the floor at the floor's inside corners:
  - the heart notch: 0.914 / 0.851 mm (60° / 90°);
  - the island corners: 0.541 / 0.530 mm;
  - the "AB" inside corners: 0.580 mm.
  The glue gap is 0.5 mm, so the plug face lands on the fins:
  - seat 1.89–2.21 mm, 0.37–0.67 mm short of wall contact;
  - the plug stands 0.29–0.61 mm proud of the designed engagement;
  - an open seam 0.22–0.66 mm wide runs around the whole inlay (36–102 mm² of void at the glue line).
  The heart with the repo's own fixture values (glue 0.2, surface 0.3) stops on a 0.823 mm fin. Nothing in Job Review or the inlay findings mentions it. Hard clamping may crush thin fins in soft wood; that was not tested.
- **Evidence:** REPRO.
  - Oracle fields `seat`, `contacts` (every contact is face-on-fin) and `femaleVsIdeal` (worst under-cut and its location).
  - The start-depth plug in the same emitted pocket stops at the same fins (seat 1.89–2.22 in the default cases), so this is independent of F5-P2-1.
- **Known:** the root cause is F1-P2-1 (fix card proposed). F1 deferred the inlay consequence to F5 ("Whether that affects seating is for F5"); that consequence is new here.
- **Refuter:** MERGE-INTO F1-P2-1. The consequence is reproduced, but it is not a separate defect:
  - Same root cause and fix: the pair cuts its pocket with `vcarveMedialPasses` (`tapered-inlay-operation.ts:41-46`), whose floor is F1's Miter inset.
  - The default glue gap is 0.5 mm (`cnc-tapered-inlay.ts:21`), and `CncInlayFields.tsx:24` copies the defaults when Tapered V-bit pair is chosen.

  Repro with the refuter's own checker, with the plug face landing on the fin:

  | Design, bit | Floor fin | Seat (vs 2.587) | Worst gap at the glue line | Void at the glue line |
  |---|---|---|---|---|
  | 30 mm square + 12 mm island, 60° | 0.50 mm (0.52 undercut), island corner | 2.213 (0.374 short) | 0.81 mm | 42.6 mm² |
  | 40 mm "AB", 60° | 0.56 mm | 2.046 (0.54 short) | 0.92 mm | 96 mm² |

  The start-depth plug built with the app's own V-carve engine stops on the same fins (seats 2.213 / 2.028), so this is independent of F5-P2-1.

  **Mechanism correction.** A fin taller than the glue gap is sufficient but not necessary.
  - On a 5-point star the floor fins are 0.31 mm, under the 0.5 mm glue gap.
  - Yet a 0.19 mm undercut on the reflex-corner cone, under the plug's edge, stops the plug 0.20 mm short: seat 2.387, and a 0.35 mm seam even with the start-depth plug.

  Fin crushing under clamps could not be tested here.

  **Recommendation.** Record the inlay consequence on F1-P2-1: the plug lands 0.2–0.54 mm short with an open seam all round. Add an emitted-pocket seating regression to its fix card.
- **Fix direction:**
  - F1-P2-1's arc-join fix applies unchanged, because the pair calls `vcarveMedialPasses`.
  - Add an inlay seating regression: seat within 0.02 mm of E + c/tan(θ/2) on a design with inside corners.
  - Until then, a Job Review note when the fin height can exceed the glue gap.
  - The coordinator may merge this into the F1-P2-1 fix card, or raise it if fins do not crush.

## Refuted (by the auditor before filing)

- **Straight "AB" interference of 0.27 mm.** This was an oracle alignment artefact: the oracle took the centre from the source box, while the app mirrors about the canonical box. With a shift search, interference is 0 and the worst gap is 0.15 mm.
- **Tapered heart, 0.085 mm wall interference when held at E.** This came from a 0.15 mm oracle shift. Aligned on the fin-free pocket (shift 0, 0), there is none.
- **Island V60 with c 0.3: 0.269 mm of extra plug material at the island corner** (the centre of the V-carve arc in the plug's counter hole). It does not set the seat (the plug bottoms first) and belongs to F1's depth law, so it was not raised; see Not verified.

## KNOWN (re-observed, not re-raised)

- **F1-P2-1** (flat-floor fins, Miter inset) is the root cause of F5-P2-2. It still occurs on this tree.
- **2026-09-29 WA-7:** round-join offsets use clipper2's default arc tolerance. `kerf-offset.ts:33-48` is unchanged. At the inlay offsets here (≤ 2.6 mm) the sag is negligible.
- **2026-09-27 CNG-T01:** no preview shows the plug seated in the pocket. That remains true: `src/ui/cnc-viewer3d` and `src/core/sim` have no inlay-specific code, and nothing predicts the seam.
- **Fixed and confirmed holding:**
  - 2026-09-24 AC-1 (straight plug corners);
  - AC-9 (fields visible);
  - 2026-07-25 1.12 (insert lead): `applyProfileLeadPasses` with kept walls, no ramp;
  - 2026-10-09 tapered nonzero text: the "AB" counters and joins compile correctly;
  - rolling-v2 02-P2-2: `pro-operation-policy.ts:24-27` classes the tapered pair as V-carve.

## Verified clean

- **Mirroring and islands.** The plug and insert are mirrored in machine X about their own centre and placed toward physical right (ADR-312 item 5, `jogAxisSignsForOrigin`). Evidence:
  - The asymmetric "AB" and the square with an island seat in a fin-free pocket at zero lateral offset (tapered) and with zero interference (straight).
  - So text reads correctly after a left-right flip, and counters map to islands.
  - Multi-letter designs mirror as one set, because one run per operation collects every object (`artwork-order.ts:36-49`).
- **Straight-pair fit (ADR-155):**
  - same tool and a single canonical contour;
  - pocket before insert, in both groups and in emission order;
  - zero interference and a 0.12–0.15 mm worst gap against 0.1 mm per side;
  - pocket floor at full depth (0 cells short) for the heart, island and "AB";
  - insert lead without ramp (ADR-250 Amd 2).
- **Tapered pocket walls:** over-cut 0.004–0.025 mm, inside ADR-453. No arcs. The only rapids below Z0 are pure Z retracts.
- **Plug waste floor:** fins up to 0.39 mm, clear of the pocket surface at S = 1 and S = 0.3 (heart). No shoulder contacts.
- **Axial relationships:**
  - P = E + g is enforced on load (`normalizeCncTaperedInlay`), at plan time (`tapered-inlay-settings.ts:43`) and by the UI patch.
  - Plug depth = E + S.
  - Start planes shift whole pieces and are disclosed.
  - Bit-angle mismatch is impossible: one `layerCncTool` cuts both pieces.
  - Flat-tip bits, bits too small for the depth, and an insufficient border are refused with named reasons.
- **Diagnostics:** `findCncInlayIssues` uses the same tool and contours as compile. Its findings are advisory (`cnc-inlay-invalid`, `cnc-preflight.ts:141`, is not in `COMPILE_INTEGRITY_PREFLIGHT_CODES`), which matches PROJECT.md rule 7.
- **Twin, preview and 3D viewer:** both read the compiled groups the emitter cuts (`cncGroupForPasses`). No viewer or Design Studio path special-cases inlays; F1 measured the stamp-versus-program agreement for these pass kinds at ≤ 0.0125 mm.

## Not verified

- **Physical behaviour:** whether clamping crushes the fins in F5-P2-2; actual glue behaviour; any hardware or air cut.
- **The 0.269 mm V-carve shortfall** at an arc-centre medial vertex: the plug's island hole with c = 0.3. It belongs to F1; it was not traced.
- **Twin, source-only Job Review fallback:** `ui/laser/cnc-relief-planning-warnings.ts:238` counts any `inlay-pair`, tapered included, as using stepover. When no compiled evidence exists, a tapered pair could get a stored-stepover warning it never uses. When that fallback runs was not checked.
- **Straight pairs with tabs on:** the default tabs also hold counter slugs in the insert. This is standard practice and was not measured.
- **Start-depth plug on "AB" 40 mm / 90°:** not simulated by the auditor, because the pair is refused and there is no pocket G-code. *Refuter:* simulated against the ideal V pocket using the app's own `vcarveMedialPasses` at start depth 2.55: it seats at 2.544 with a 0.07 mm worst gap; 25 mm "AB" at 60° seats at 2.575 with a 0.05 mm gap.
- **Refuter note, plug-blank rim (not raised, P3 at most):** the plug waste is V-carved from Z0, so its wall rises to the stock top at the waste-border line. An untrimmed plug blank seats at 0.04 mm. The operator must cut the plug free at least about (E + S)·tan(θ/2) ≈ 2.0 mm (60°) or 3.5 mm (90°) inside the border. Neither the fields nor a tutorial say so. Vectric's Vector Offset boundary has the same property, and the operator finds out before gluing, so it was not raised. The refuter's seat figures assume a blank trimmed (E + S)·tan(θ/2) + 0.2 mm inside the border.
- **Two-board setup:** whether separate boards with different thicknesses are handled beyond the start-plane fields.

## Repro files

These are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\f5-repros\`:
- `zz-f5-inlay-dump.test.ts`: compiles and dumps G-code and source. Place it in `src/core/cnc/`. The base-case `it` is set to `it.skip` after its run, and the variants `it` is active.
- `zz-f5-minfeature.test.ts`: the ADR-433 twin. Place it in `src/core/min-feature/`.
- `f5-oracle.mjs`: the independent sweep, mirror, seat and EDT, with no app code.
- `f5-straight-detail.mjs`: the source area not pocketed.

Outputs (`*.nc`, `*.json`, `r-*.json`) are in `scratchpad\f5-out\`. The temporary `zz-f5-*` files were removed from the worktree.

**Refuter files.** These are independent of the auditor's oracle and are in the same scratchpad:
- `f5r-tools\f5r-check.mjs` and `f5r-tools\f5r-main.mjs`: G-code parser, exact cone and flat-cylinder sweep, ideal pocket, mirror from the plug G-code extents, seat with a shift search, and glue-line void with EDT. Run `node f5r-tools/f5r-main.mjs f5r-out <case> 0.05`.
- `f5r-out\`: G-code and JSON from a temporary `src/core/cnc/zz-f5r-dump.test.ts`, now deleted. Cases: `tap-star-v60/v90`, `tap-island-v60`, `tap-ab40-v60/v90`, `tap-ab30-v60`, `tap-ab25-v60`, `str-ab40-em`, and `twin.json`. Each `*-sd.nc` is the start-depth plug from the app's own V-carve engine.

```json
[
  {"id":"F5-P2-1","severity":"P2","area":"cnc-inlay","file":"src/core/cnc/tapered-inlay.ts","line":47,"anchor":"Ground truth: Vectric V-Carve 'Start Depth (D) specifies the depth at which the V-Carving toolpath is calculated'; Carbide 3D start-depth inlay method; Twin: taperedInlayContactAtDepth (tapered-inlay-settings.ts:81-91)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Tapered plug = eroded top regrown by the V-bit from Z0 (an opening), not the pocket wall offset: convex-corner voids 0.60-1.08 mm in a fin-free pocket vs 0.03-0.15 mm for a same-bit start-depth plug; 30 mm 'AB' 60deg loses 80% of the letters, 25 mm/60deg and 40 mm/90deg 'AB' refused; Job Review says the detail 'cannot be reproduced'"},
  {"id":"F5-P2-2","severity":"P2","area":"cnc-inlay","file":"src/core/cnc/tapered-inlay-operation.ts","line":41,"anchor":"Contract: glue-gap definition CncTaperedInlayFields.tsx:28 and P=E+g (tapered-inlay-settings.ts:43); WORKFLOW F-CNC6 via F1-P2-1; Ground truth: Vectric glue gap = assembled plug-top to pocket-bottom distance","evidence":"REPRO","verdict":"MERGE-INTO F1-P2-1","known":"root cause F1-P2-1; inlay consequence new","summary":"Pocket flat-floor fins 0.53-0.91 mm exceed the 0.5 mm default glue gap; the plug face lands on them 0.37-0.67 mm short of wall contact, leaving a 0.22-0.66 mm open seam around every tested design; no warning"},
  {"id":"F5-P2-3","severity":"P2","area":"cnc-inlay","file":"src/core/cnc/inlay-pair.ts","line":90,"anchor":"Twin: ADR-433 pocket width check (operation-targets.ts:109-118 skips inlay-pair) and tapered lost-detail report (tapered-inlay.ts:112-115); Contract: ADR-155 no partial pair","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Straight pair silently drops strokes narrower than the bit from both halves (40 mm Roboto 'AB', 1/8in: A crossbar and B bars, 59.2 of 525.6 mm2, B insert in pieces); same artwork as a pocket gets 3 ADR-433 sites, the pair gets none"},
  {"id":"F5-P3-1","severity":"P3","area":"cnc-inlay","file":"src/core/cnc/tapered-inlay-settings.ts","line":81,"anchor":"Ground truth: mating tapers seat by contact, Vectric glue gap is assembled distance; Twin: contact model vs emitted seat; UI CncTaperedInlayFields.tsx:39-42","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"'Independent' radial fit gap becomes extra insertion c/tan(theta/2): default glue gap 0.41/0.45 not 0.5 with zero wall gap; c>=g*tan(theta/2) bottoms the plug (c0.6/90deg: glue 0, wall 0.10 (refuter; report said 0.05); c0.3 g0.2 60deg: glue 0, radial <=0.185)"},
  {"id":"F5-P3-2","severity":"P3","area":"cnc-inlay","file":"src/core/cnc/tapered-inlay.test.ts","line":49,"anchor":"Contract: C09 acceptance (IMPLEMENTATION.md:134); METHOD L7","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"No test seats the emitted plug in the emitted pocket; fit tests use circles at plan level (opening == erosion), a test enshrines narrow-detail loss, so F5-P2-1 and F5-P2-2 pass the suite"}
]
```
