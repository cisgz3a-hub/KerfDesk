# N6 — CNC review truth (CNC audit v3, `cnc-review-truth`)

**Question.** Does Job Review tell a router operator the truth about the job, and does it warn wherever it should? The checks cover:
- every CNC warning source: the condition it fires on, whether its text (numbers, names, advice) is true, and the sibling conditions that should warn but do not (spindle over the machine, feed over the machine, Z travel, stock and travel, depth per pass, plunge, coolant, spindle on/off);
- the material and bit catalogue: chip load = feed / (RPM × flutes) for every bit size × material through the real automatic-feed resolver, against the references the repo records;
- the starter machine catalogue's limits against the output (clamped, warned, or neither);
- the Job Review ETA against an independent acceleration-aware clock with the Z axis's own rate and acceleration;
- output precision (decimals, rounding, closure, fractional words, inch);
- CNC rotary and wrap against the flat twin.

**Tree.** `origin/main` @ `9a0b1a80b` (read-only export `j38-main`).
- main is now `4ac0d1475`. `git diff --stat 9a0b1a80b origin/main -- src/core/cnc src/ui/laser src/core/job src/core/gcode-time src/core/output src/core/preflight src/core/scene src/io/cnc src/ui/state/machine-actions.ts` lists 18 files: the N2 relief fixes (`compile-cnc-relief*`, `cnc-compiled-depth-warnings.ts` thin-floor rule, `cnc-relief-*-warnings.ts`) and the N3 pocket fixes (`pocket-freed-islands.ts`, a new `cnc-through-pocket-island-warnings.ts`, `min-feature-warnings.ts`, `collect-cnc-contours.ts`, `adaptive-pocket-islands.ts`, `pocket-paths.ts`). None of the files cited by a finding below changed (`cnc-machine-limit-warnings.ts`, `compile-cnc-pass-group.ts`, `compile-cnc-helpers.ts`, `cnc-preflight.ts`, `resolve-cnc-auto-settings.ts`, `cnc-machine-catalog.ts`, `machine-actions.ts`, `src/core/gcode-time/**`, `src/core/cnc/wrap/**`).

**Method.**
- **Real paths only.** Every job is a project built in `zz-n6/n6-lib.ts` and run through `prepareOutput` → `emitPreparedGcode` (the Save path, with its preflight) and `detectMachineJobWarnings(project, live$$, null, prepared)`, the seam Save and Start share. A live controller snapshot is passed where a case needs one. Node scripts only, ≤ 650 MB each; no Vitest, no browser.
- **W series (`n6-warn.ts`, plus `n6-w1b.ts`, `n6-z.ts`, `n6-fa.ts`, `n6-cool.ts`).** One job per condition (table below). The emitted F and S words were read from the program, not from the settings.
- **Catalogue (`n6-cat.ts`).** 410 rows: 5 material families × every end-mill and ball-nose size in `DEFAULT_CNC_TOOLS` and `MODELED_CNC_BIT_CATALOG` (0.5–12.7 mm, 1 and 2 flutes), through `resolveCncMaterialFeedPatch` on the default profile and on the Neotronics 4040 profile (starter-capped). Emitted chip load = feed / (RPM × flutes). References recorded in the repo (nothing downloaded): the Shapeoko A-to-Z rubbing floor 0.0254 mm (2026-09-24 FS-2), and the per-diameter hobby rule 0.025·D for wood/MDF, 0.03·D for plastics, 0.0125·D for aluminium (2026-07-25 survivors, Sienci).
- **ETA (`n6-clock.ts`, `n6-eta.ts`).** My own GRBL 1.1 clock, sharing no code with KerfDesk: per-axis rate and acceleration (`limit_value_by_axis_maximum`), junction deviation, `mc_arc` chords at 0.002 mm, dwell rounded up to 50 ms, a planner stop at every M3/M5/M7/M8/M9/G4/M0, and **unlimited lookahead**, so it is a lower bound on GRBL's time. Job Review's number is `estimateJobDuration(prepared.job, deviceForActiveHead(...), { gcode })`, the call `prepared-job-metrics.ts` makes. Self-check: with Z limits equal to XY (KerfDesk's own assumption) my clock agrees with Job Review to −1.9…−0.2 % on all six jobs.
- **Precision (`n6-precision.ts`), wrap (`n6-wrap.ts`, `n6-wrap2.ts`).**

## Headline

**Job Review's warnings are true where they fire, and the ETA is faithful to its own model. The gaps are in what the review does not say about chip load.**
- **Warnings measured true:** spindle over the configured ceiling, over `$30`; feed over `$110/$111`; plunge over `$112`; stock past reported travel; toolpaths off the stock; the Z-travel span (47.8 mm against 45 mm, from the deepest cut and the safe-Z lift); on-path size change; finish allowance (rough 1.5875 mm proud, finishing steps of 1.5 mm, both measured in the program); coolant M7/M8 with M9 before every bit-change M0 and the coolant restarted after spin-up.
- **ETA:** within 2 % of my clock when Z is timed like XY. With the Z axis's own limits it is 0–8 % short at `$112=1000, $122=100`, up to 16 % short at the repo's GRBL CNC fixture (600/50), and **24–42 % short** for profile, relief and drilling at stock GRBL Z defaults (500/10). This is KNOWN PV-1, re-measured.
- **Output precision is clean:** 0.0005 mm worst against the compiled path on a 3,600-vertex circle, closure gaps 0, depth ladder exact, fractional feeds and spindle words valid. CNC output is metric only (`G21`).
- **CNC wrap** is an offline study (`machineOutputAvailable: false`). Its surface length equals the flat twin's to the micron, and its G93 timing is right for the tip.

**New: one P2 and four P3s.**
1. **N6-P2-1. When a layer asks for more RPM than the machine allows, KerfDesk lowers S and keeps F, so the chip load rises by that ratio, and the warning does not say so.** It advises "Verify the controller-to-spindle scale".
   - Example: a 1/16" bit at 24,000 RPM and F1440 (0.030 mm/tooth) on a 9,000 RPM machine emits `S9000 F1440`: 0.080 mm/tooth, 2.67×.
   - It is reached by applying a machine preset, which keeps manual layers' RPM by design. Two of the catalogue's presets sit below the 12,000 RPM layer default: Genmitsu 3018 (10,000) and 4040-PRO (9,000).
2. **N6-P3-1.** A stage recipe's feed or plunge above CNC Max feed is capped silently. The same value on the layer gets the preflight advisory.
3. **N6-P3-2.** The machine-limit warnings read every Output-on layer's stored values, including layers with no artwork and a drill layer's feed that is never sent, so they warn about values no program carries.
4. **N6-P3-3.** The machine presets cite Z travel (3018: 45 mm; 4040-PRO: 78 mm; Neotronics: 75 mm) but do not record it, so the Z-travel check stays silent offline on a 44 mm-deep job in 44 mm stock.
5. **N6-P3-4.** The CNC wrap study maps a design taller than one circumference onto itself with no note: 40 mm on a 5 mm radius is 458°.

## Warning sources (CNC)

Seam: `machine-job-warnings.ts` (Save + Start), plus Job Review-only sources in `job-review-model.ts` and the CNC preflight (`cnc-preflight.ts`, shown as advisories).

| Source | Condition | Text true? (REPRO case) | Missing sibling |
|---|---|---|---|
| `cnc-machine-limit-warnings.ts` `spindleVsConfiguredCeiling` (offline) | max output-layer or recipe RPM > `spindleMaxRpm` | Numbers true (W1, W1b). The consequence is not stated: S is lowered and F kept, so the chip load rises by that ratio, and the advice to verify the scale is beside the point | **N6-P2-1**. Also fires for values no program sends (**N6-P3-2**) |
| same, `spindleVsMax` (live `$30`) | RPM > `$30` | True (W4): "S above $30 uses maximum PWM" | — |
| same, `feedVsMax` (live `$110/$111`) | layer/recipe feed > slower of `$110/$111` | True (W4, 4000 > 3000) | Fires on a drill layer's feed, which is never sent, and on empty layers (N6-P3-2) |
| same, `plungeVsZMax` (live `$112`) | plunge > `$112` | True (W4, 800 > 500) | The Z rapid rate and Z acceleration feed no warning and no ETA (KNOWN PV-1) |
| same, `stockVsBed` (live) | stock far edge > reported travel | True (W4: "X reaches 100 mm > 70 mm") | — |
| `cnc-preflight.ts` `appendFeedIssue` | layer feed/plunge outside (0, CNC Max feed] | True (W2). The wording names the layer id and does not say the program sends 6000 (KNOWN JR-7) | Stage recipe feed/plunge are never checked (**N6-P3-1**, W3) |
| `cnc-preflight.ts` RPM ≤ 0, depth ≤ 0, V-carve without a V-bit | as named | True | — |
| `cnc-z-travel-warnings.ts` | deepest cut + highest lift > `$132` or profile `zTravelMm` | True (W7: "22.8 mm … Z-19 … Z3.8 … 20 mm"; n6-z: 47.8 > 45) | Silent when no travel is recorded, and the presets never record it (**N6-P3-3**). Live WCO against the top of travel: KNOWN JR-3 (partly fixed) |
| `cnc-stock-warnings.ts` | emitted XY bounds outside the stock footprint (machine frame) | True (W5, W6) | Bit edge vs stock (centre-line bounds); KNOWN CO-4 |
| preflight `out-of-bed` | motion outside the bed | True (W6). Five raw "Line N" rows (KNOWN JR-7) | — |
| `cnc-default-feed-warnings.ts` | untouched 1000 mm/min and 1.5 mm/pass, no material | True. Names the layer id (KNOWN JR-7), and fires for empty layers too | — |
| `cnc-angled-tool-feed-warnings.ts` | material recipe on a V-bit/engraver/tapered ball | True (K-4 disclosure) | — |
| `cnc-unmodeled-bit-layout-warnings.ts` | narrowing bit without usable geometry | READ, consistent with `layout-cut-widths.ts` | — |
| `cnc-missing-primary-tool-warnings.ts` | layer bit id not in the library | READ, true | — |
| `cnc-on-path-size-warnings.ts` | on-path closed shape, depth ≥ stock | True (OP1: 6.4 mm for the 60° 1/4" V-bit) | — |
| `cnc-finish-allowance-warnings.ts` | allowance ≥ wall radius | True (FA1: roughing ring 1.5875 mm proud, finishing levels 1.5 mm) | — |
| `cnc-through-cut-tab-warnings.ts`, `cnc-full-tab-coverage-warnings.ts` | through profile with tabs off / tabs never below the tab top | True (FA1, OP1). Tab cases: N1 | N1-P2-2 (open outline): N1 |
| `cnc-compiled-depth-warnings.ts` | relief and V-carve at, past or within 0.2 mm of the stock bottom | Changed on main (N2 fix), not re-run | — |
| `cnc-relief-planning-warnings.ts`, `cnc-relief-roughing-reach-warnings.ts`, `cnc-relief-projection-order-warnings.ts`, `cnc-two-sided-stock-warnings.ts`, `cnc-projection-stock-warnings.ts` | relief planning | N2 (changed on main) | — |
| `cnc-offset-ladder-warnings.ts`, `min-feature-warnings.ts`, `cnc-through-pocket-island-warnings.ts` (new on main) | pocket/feature | N3 (landed after this tree; not audited here) | — |
| `cnc-contour-precision-warnings.ts` | sub-quantum contour | READ; F8 | — |
| `cnc-park-set-aside-warnings.ts` | configured park dropped by placement | READ, true | — |
| `cnc-raster-warnings.ts` | raster on an output layer | READ, true | — |
| `stale-catalog-bit-warnings.ts`, `job-review-cnc-reach.ts` | stale catalogue copy; flute/holder reach | READ; F7 and N4 | JR-5: no catalogue bit has a flute length |
| `m7-air-assist-warnings.ts` (machine-agnostic) | M7 without verified `$I` M option | True for CNC mist coolant: the text names "flood/none for CNC coolant" | — |
| `window-stream-lit-stop-warnings.ts` | window stream with M3 | Laser wording on a router job | KNOWN N5-P3-1 |
| Job Review operation summary (`job-review-effective-operations.ts`) | — | Shows the emitted feed, plunge and RPM (JR-6 is **fixed**). Chip load is shown only when the bit has a flute count, and no starter bit has one | N6-P2-1 |
| **Conditions with no warning** | plunge > feed (W9), RPM < `$31` | — | KNOWN JR-8 |
| | depth per pass 2 × D (W8); 40 mm deep with a 1/8" bit (W8b); a 1/4" recipe on a 1/16" bit (W12) | — | KNOWN JR-5 / FS-4 (K-6) |
| | bit shank vs collet range | not modelled (no collet field) | not raised |
| | spindle on/off | M3 S before every section, M5 before every M0 and at the end, RPM 0 refused by preflight | none needed |

## Catalogue (chip load = feed / (RPM × flutes), 12,000 RPM, 2 flutes unless stated)

Default profile (no starter). Full table: `out/catalogue.json` (410 rows).

| Material | 0.5 mm | 1 mm | 1/16" | 1/8" | 1/4" | 1/2" | dpp / D | Against the hobby rule (×) |
|---|---|---|---|---|---|---|---|---|
| Softwood | F720, 0.030 | F720, 0.030 | F1200, 0.050 | F1200, 0.050 | F2640, 0.110 | F4560, 0.190 | 0.5–0.6 | **2.4** (0.5 mm), 1.2 (1 mm), 1.26, 0.63, 0.69, 0.60 |
| Hardwood | F480, 0.020 | F480, 0.020 | F960, 0.040 | F960, 0.040 | F2400, 0.100 | F3600, 0.150 | 0.4 | 1.6, 0.8, 1.01, 0.50, 0.63, 0.47 |
| Plywood/MDF | F720, 0.030 | F720, 0.030 | F1440, 0.060 | F1440, 0.060 | F2640, 0.110 | F4320, 0.180 | 0.5–0.6 | **2.4**, 1.2, 1.51, 0.76, 0.69, 0.57 |
| Acrylic | F720, 0.030 | F720, 0.030 | F1200, 0.050 | F1200, 0.050 | F2400, 0.100 | F3600, 0.150 | 0.25–0.4 | 2.0, 1.0, 1.05, 0.52, 0.52, 0.39 |
| Aluminium | F240, 0.010 | F240, 0.010 | F480, 0.020 | F480, 0.020 | F1200, 0.050 | F1920, 0.080 | 0.1–0.2 | 1.6, 0.8, 1.01, 0.50, 0.63, 0.50 |

- **Plunge** is 0.4× the feed for wood, 0.3× for acrylic and 0.15× for aluminium, never above the feed. No row has a depth per pass above D (largest 0.6·D, the 0.5 mm bit). The O-flute 1FL entries halve the feed and keep the chip load.
- **Flags, default profile:** 4 overload rows, all at 0.5 mm: 0.030 mm/tooth is 2.4× the per-diameter rule, because the ≤ 1.5 mm band gives a 0.5 mm bit the same chip load as a 1.5 mm one. 25 rows fall below the 0.0254 mm floor: small-band hardwood and aluminium, a chart-tuning matter (KNOWN K-1). The 0.5 mm overload is a new facet of KNOWN FS-5 (bands, not interpolation). Recorded as KNOWN, not re-raised.
- **Neotronics 4040 profile:** 205 of 205 rows at or below 0.0125 mm/tooth. Every material and bit is capped at the starter's 300 mm/min at 12,000 RPM, down to 0.04× the hobby rule at 1/2". This is KNOWN FS-2 / K-5, unchanged.
- **Machine catalogue against the output:**

  | Limit | Clamped? | Warned? | Notes |
  |---|---|---|---|
  | Spindle max (9,000–30,000) | yes (`capSpindle`) | yes | wording is N6-P2-1 |
  | Bed | — | yes (preflight `out-of-bed`) | — |
  | Max feed | none in the catalogue (KNOWN FS-9) | layer feed over CNC Max feed: preflight advisory | the program is capped at CNC Max feed; a recipe gets neither (N6-P3-1) |
  | Z travel | cited in sources, not recorded | — | N6-P3-3 |
  | Acceleration | not in the catalogue | — | the ETA uses the device profile's single 500 mm/s² |

## ETA (seconds; my clock is a lower bound; XY 6000 mm/min, 500 mm/s², `$11`=0.01)

| Job (real compile) | Lines | Job Review | Mine, Z = XY | Z 1000/100 | Z 600/50 (repo fixture) | Z 500/10 (GRBL defaults) |
|---|---|---|---|---|---|---|
| E1 profile: outside 2 rects + Ø20 through 6.35, tabs, MDF recipe | 1,088 | 206.4 | 205.2 (−0.6 %) | 217.9 (**5.3 % short**) | 229.9 (10.2 %) | 271.0 (**23.8 %**) |
| E2 pocket, offset 60 × 40 × 3 | 298 | 343.6 | 343.0 | 344.5 (0.3 %) | 345.9 (0.7 %) | 350.1 (1.8 %) |
| E3 pocket, adaptive 80 × 50 × 4, 1/4" | 133 | 189.4 | 189.1 | 190.2 (0.4 %) | 191.3 (1.0 %) | 194.3 (2.5 %) |
| E4 V-carve, two stars, 60° 1/4" | 11,355 | 924.8 | 920.2 | 924.9 (0.0 %) | 932.2 (0.8 %) | 973.3 (5.0 %) |
| E5 drill, 12 holes × 6 mm pecks | 188 | 114.8 | 114.3 | 125.4 (8.4 %) | 137.1 (16.3 %) | 198.9 (**42.3 %**) |
| E6 relief, Ø40 dome 4 mm, 1/8" | 272 | 52.9 | 51.9 | 56.3 (6.0 %) | 60.3 (12.3 %) | 73.4 (**27.9 %**) |

- **Optimism above 25 %:** only where Z is slow: drill and relief at GRBL's default Z (500 mm/min, 10 mm/s²), with the profile just under at 23.8 %.
- **At realistic router Z settings:** at most 8.4 % short. Pocket, adaptive and V-carve stay within 5 % at every setting.
- **The cause is KNOWN PV-1** (2026-09-24; E6-K-1; rolling-v2 18 K-2):
  - `deviceMotionLimits` passes one rate and one acceleration for every axis (`program-timing-options.ts:42-51`);
  - Job Review ignores the live `$112`/`$122` the snapshot already parses (`zMaxFeed`, `zAccelMmPerSec2`).
  - It is not re-raised.

## Findings

### N6-P2-1 — An RPM above the machine's ceiling is lowered while the feed is kept, so the chip load rises by that ratio; the warning names the cap but not the consequence

- **Where:**
  - `src/core/cnc/compile-cnc-pass-group.ts:38-40`: `feedMmPerMin: capFeed(cutFeed, device.maxFeed)` against `spindleRpm: capSpindle(settings.spindleRpm, config.params.spindleMaxRpm)`. Relief does the same (`cnc-relief-group.ts:42-44`), and so do tile registration bores (`tile-registration.ts:55-60`).
  - The warning: `src/ui/laser/cnc-machine-limit-warnings.ts:84-95` (`spindleVsConfiguredCeiling`): "the compiled spindle setting is limited to N RPM; actual spindle RPM is not measured. Verify the controller-to-spindle scale."
  - Reach:
    - `src/ui/state/machine-actions.ts:175-188` (`applyCncMachinePreset`: "manual/legacy layer values remain explicit operator intent");
    - `src/core/scene/machine.ts` `DEFAULT_CNC_LAYER_SETTINGS.spindleRpm: 12000`;
    - `cnc-machine-catalog.ts`: `genmitsu-3018` 10,000 and `genmitsu-4040` 9,000.
  - Twin: `resolve-cnc-auto-settings.ts:139-151` (`materialSpindleRpm`) computes material feeds at min(layer RPM, machine max), so automatic layers keep their chip load; only hand-set layers drift.
- **Anchor:**
  - *Contract:* `feeds-calculator.ts:3` "feed (mm/min) = RPM × flutes × chipload". The layer's feed is a chip-load decision made at its RPM.
  - *Comment:* `cnc-preflight.ts:284-291` says lowering Spindle maximum "put every hand-tuned layer over it at once. Job Review now warns that the job will run at the ceiling instead". The warning stops at the RPM.
  - *Twin:* when the live `$30` caps automatic RPM, the feed is re-derived (F4 refuted list).
- **Evidence:** REPRO (`n6-w1b.ts`, `out/W1b-*.json/.nc`; `n6-warn.ts` W1) and READ.
  - **Case 1.** 1/16" end mill, layer 24,000 RPM, F1440 (0.030 mm/tooth). With Spindle maximum 9,000 the program sends `M3 S9000` and `F1440`: 1440 / (2 × 9000) = **0.080 mm/tooth, 2.67×**.
    - The only warning is the one quoted above.
    - Job Review's operation line shows "1,440 mm/min feed · 9,000 RPM". It adds "0.0800 mm/tooth programmed nominal chipload" only if the bit has a flute count, and no shipped starter bit does (`cnc-tool-starters.ts`).
  - **Case 2 (W1).** 1/8" bit, F2880 at 24,000 (0.06) on 12,000 → `S12000 F2880`: 0.12 mm/tooth, 2×.
  - **Everyday case.** An untouched layer (12,000 RPM, F1000) on the Genmitsu 4040-PRO preset sends S9000 F1000: 0.056 against the 0.042 its own comment states (`machine.ts` "about 0.04 mm chip load per tooth"). Every such layer carries the spindle warning.
- **Scenario:** A maker tuned a 1/16" detail layer at 24,000 RPM on a trim router, then moved the project to a Genmitsu 4040-PRO and picked its preset (9,000 RPM).
  - Job Review says the spindle is limited to 9,000 and to verify the controller scale; the scale is right.
  - The bit takes 2.67× its chip load at F1440 and snaps in the first pass, or deflects and gouges the wall.
- **Severity: P2.** It is a real defect, and the harm (an overloaded or broken small bit) depends on the ratio. A warning does fire on the condition, but it names the wrong consequence and the wrong remedy. Not P1: the cap is announced, and the feed is visible in the operation line.
- **Announced?** The RPM cap, yes. The chip-load rise, no.
- **Novelty:** new.
  - F4's refuted list covers "RPM above Spindle maximum silently capped" (it is warned), and the `$30` cap (removed).
  - FS-4 (2026-09-24) asks for a chip-load check per group but does not name this mechanism.
  - Neither covers keeping F while lowering S.
- **Fix direction:**
  - Say it in the warning: "the program keeps F1440, so each tooth takes 2.7× the chip load planned at 24,000 RPM; lower the feed to 540 mm/min or reapply the material."
  - Or scale F (and plunge) by the RPM ratio when S is capped, as the material path does.
  - Give starter bits a flute count so Job Review's chip-load line appears.
  - On a preset or ceiling change, offer to rescale hand-set layers.

### N6-P3-1 — A stage recipe's feed or plunge above CNC Max feed is capped silently; the same value on the layer gets an advisory

- **Where:**
  - `src/core/preflight/cnc-preflight.ts:282-283`: `appendFeedIssue` runs on `layer.cnc` only.
  - `cnc-stage-settings.ts:13-29` substitutes the recipe's values, and `compile-cnc-pass-group.ts:38-39` caps them.
  - `cnc-machine-limit-warnings.ts` compares recipes only with a live `$110`.
  - The recipe field's tooltip says "Machine limits still apply to output" (`CncStageRecipeFields.tsx`).
- **Evidence:** REPRO W3: a wall-finishing recipe at F9000 / plunge 8000 sends `F6000`, with no preflight issue and no warning. In W2 the layer twin gets "feed 8000 mm/min is outside (0, 6000]".
- **Severity: P3.** The harm is a slower feed than planned (chip load −33 % here), and the operation line shows 6,000. It is a twin inconsistency.
- **Novelty:** new (ADR-457 recipes postdate JR-6/JR-7).
- **Fix direction:** run `appendFeedIssue` over the recipes the job runs, named as the machine-limit warning names them ("The Wall finishing recipe on layer …").

### N6-P3-2 — The machine-limit warnings report stored values that no program sends

- **Where:**
  - `cnc-machine-limit-warnings.ts:114-134` (`maxOutputValue`): every `layer.output` layer counts, with or without artwork.
  - For a drill layer, `feedMmPerMin` counts although the drill group sends the plunge (`compile-cnc-pass-group.ts:28`).
  - `cnc-default-feed-warnings.ts:13-33` likewise skips the bound-artwork check its siblings make (`cnc-angled-tool-feed-warnings.ts:19`).
- **Evidence:** REPRO W11. An Output-on layer "Op2" with no artwork, at 30,000 RPM and F5900, produces two warnings: "Layer "Op2" requests spindle 30000 RPM …" and "requests feed 5900 mm/min, above the machine's reported max rate 3000". The program has S12000 and F1000 only.
- **Severity: P3.** These are false positives that dilute the list. Nothing is cut wrong.
- **Novelty:** new.
- **Fix direction:** take the values from the compiled job's groups when it is available (`job` is already passed in), as `recipeRuns` does for recipes; skip layers with no bound artwork otherwise.

### N6-P3-3 — Machine presets cite the Z travel but do not record it, so the Z-travel check is silent offline

- **Where:**
  - `cnc-machine-catalog.ts`: `CncMachinePreset` has no Z field. Its own sources say "300 x 180 x 45 mm travel" (3018), "400 x 400 x 78 mm" (4040-PRO) and "400 x 400 x 75 mm envelope" (Neotronics).
  - `machine-actions.ts:182-187` patches `bedWidth`, `bedHeight` and `spindleMaxRpm` only.
  - `cnc-z-travel-warnings.ts:23-25` returns nothing without live `$132` or profile `zTravelMm`, and `DEFAULT_DEVICE_PROFILE` has none.
- **Evidence:** REPRO `n6-z.ts`, a 44 mm-deep profile in 44 mm stock (needs 47.8 mm of Z):
  - no Z warning without a recorded travel;
  - with `zTravelMm: 45` (the 3018's cited travel): "This job needs 47.8 mm of Z … 45 mm of Z travel".
- **Severity: P3.** A configuration gap: the warning exists and works once a controller is connected (`$132`).
- **Novelty:** new facet. JR-3 asked for the check, and it was added (09-29 P2-gcode-1); the presets were never wired to it.
- **Fix direction:** add `zTravelMm` to `CncMachinePreset` from the cited sources, and patch it with the bed.

### N6-P3-4 — The CNC wrap study wraps a design taller than one circumference onto itself with no note

- **Where:** `src/core/cnc/wrap/cnc-wrap-reference-plan.ts:52-110`. There is no check of the circumferential span against 2πr.
  - Twin: the laser rotary's one-revolution wrap limit (ADR-127, `emit-gcode.ts:286-291` `boundsHeightOverrideMm`).
- **Evidence:** REPRO `n6-wrap2.ts`. A 60 × 40 mm on-path rectangle (40 mm circumferential) on a 5 mm radius (31.4 mm circumference) spans 458° of A; on a 6 mm radius, 382°. Five generic warnings appear, none about the overlap.
- **Severity: P3.** This is offline reference output only (`machineOutputAvailable: false`). The gap is structural for the future rotary post.
- **Novelty:** new.
- **Fix direction:** refuse, or warn, when the circumferential extent exceeds 2πr, naming both.

## KNOWN status (re-observed on this tree, not re-raised)

| Item | Status |
|---|---|
| JR-3 Z travel (2026-09-24) | **Partly fixed:** the span warning is true (W7, n6-z). Live WCO against the top of travel is not checked here. N6-P3-3 is the preset facet |
| JR-5 flute length / deep passes | Open: W8 (6.35 mm in one pass with a 1/8" bit) and W8b (40 mm deep) get no depth warning, and no catalogue bit has a flute length |
| JR-6 stored vs sent values | **Fixed:** the operation line uses the group's emitted F, plunge and S (`job-review-effective-operations.ts:244-266`) |
| JR-7 layer ids, no outcome | Open: "Layer L1 uses the generic starter feeds", "Layer L1: feed 8000 mm/min is outside (0, 6000]", raw out-of-bed rows |
| JR-8 plunge > feed, RPM < `$31` | Open (W9: plunge 2000 with feed 800, silent) |
| FS-1 secondary bit inherits | Partly fixed (stage recipes, opt-in) |
| FS-2 / F4 K-5 Neotronics 300 mm/min cap | Open: 205/205 rows at 0.0125 mm/tooth |
| FS-4 / K-6 no chip-load or depth-to-bit check | Open (W12: a 1/4" MDF recipe on a 1/16" bit, 2640 mm/min and 3.2 mm per pass, no warning) |
| FS-5 / K-2 band edges | Open. New measurement: a 0.5 mm bit gets 2.4× the per-diameter rule in soft wood and MDF |
| FS-6 / K-3 chip thinning | Open (no thinning anywhere in `src/core/cnc`) |
| FS-9 presets set no max feed | Open |
| K-1 chart sourcing | Open (25 default rows under the 0.0254 mm floor) |
| PV-1 Z rate/accel in the ETA | Open (table above: up to 42 % short at GRBL defaults, 8 % at 1000/100) |
| F8-P3-3 exponent S/P words | Open on read: `cnc-grbl-transitions.ts:114` `M3 S${Math.round(rpm)}` |
| N5-P3-1 window-stream laser wording on CNC | Open (N5) |

## Verified clean

- **Warning truth:** every number in the fired warnings matches the program or the settings it names:
  - W1, W2, W4, W5, W6, W7;
  - FA1: roughing ring 1.5875 mm proud, finishing steps of 1.5 mm;
  - OP1;
  - n6-z: 47.8 mm against 45.
- **Coolant:** M7/M8 after spin-up, and M9 after M5 before every bit-change M0 and at the end. The M7 readiness text covers CNC.
- **Spindle on/off:** M3 S at safe Z with a G4 spin-up before every section; RPM ≤ 0 refused.
- **Precision:**
  - absolute words, no accumulation;
  - 0.0005 mm worst against the compiled path on a 3,600-vertex Ø300 circle;
  - closure gap 0 on every loop;
  - loop radius 151.5858–151.5885 against 151.5875;
  - depth ladder exact (deepest −6.351 for 6.3505, no step over 0.7);
  - `F914` for 914.4, `F0.5` kept, `S10000` for 9999.6.
  - Inch output: not supported (always `G21`). The inch preference converts inputs only.
- **Catalogue arithmetic:** feed = RPM × flutes × chart, plunge ≤ feed, depth per pass ≤ 0.6·D on every row. The O-flute 1FL counts are used.
- **ETA model:** Job Review equals an independent clock to −1.9…−0.2 % under its own assumptions. It lists dwell, and it counts manual pauses (N5).
- **CNC wrap:**
  - surface length = flat length (525.641 mm, ratio 1.00000);
  - G93 time = tip length / feed (0.981× flat at r 25, 0.992× at r 60, as the tip radius predicts);
  - G94 restored before every rapid and plunge;
  - every G93 move carries F.

## Not verified

- The rendered Job Review dialog (no browser); warnings were read at the shared seam.
- Real `$$` dumps of the catalogue machines: the ETA's Z settings are the repo's own fixtures, not measured machines.
- Physical chip-load outcomes. The references are the two hobby rules recorded in the repo; no vendor chart was downloaded.
- Live WCO against Z travel; `$20` soft-limit tone (JR-3 remainder).
- The N3 warnings that landed on main after this tree (`cnc-through-pocket-island-warnings.ts`, `min-feature-warnings.ts` exact-width): READ only.
- Laser rotary interplay. CNC never applies the device rotary (`rotary-job.ts:22-28`), and the rotary switch is hidden for CNC (`RotaryModeSwitch.tsx:29-30`), so a CNC job with a rotary still set up on the device runs flat. Not probed further.

## Repro files

All in `…\scratchpad\zz-n6\`:
- library: `n6-lib.ts`;
- warning cases: `n6-warn.ts`, `n6-w1b.ts`, `n6-z.ts`, `n6-fa.ts`, `n6-cool.ts`;
- catalogue: `n6-cat.ts`;
- ETA: `n6-clock.ts`, `n6-eta.ts`;
- precision: `n6-precision.ts`;
- wrap: `n6-wrap.ts`, `n6-wrap2.ts`;
- outputs: `out/` (`W*.json/.nc`, `W-report.json`, `catalogue.json`, `eta.json`, `E1–E6*.nc`, `P*.nc`, `WR-*.nc`).

Run with `node --no-experimental-webstorage --import ./register.mjs <file>`.

## Counts

| Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|
| 5 | 0 | 0 | 1 | 4 | 15 |

## Refuter (2026-11-13)

**Tree and harness.** Same read-only export `j38-main` (`origin/main` @ `9a0b1a80b`). `origin/main` is now `4ac0d1475`. `git diff --stat 9a0b1a80b origin/main -- src/core/cnc src/ui/laser src/core/job` lists the same 18 N2/N3 files the auditor named. A second diff over every file this section cites (`compile-cnc-pass-group.ts`, `cnc-machine-limit-warnings.ts`, `resolve-cnc-auto-settings.ts`, `cnc-machine-catalog.ts`, `machine-actions.ts`, `src/core/scene`, `src/core/preflight`, `src/core/cnc/wrap`, `src/core/gcode-time`) is empty. Every result below stands on current main.

My files are in `zz-n6r\`. I read `n6-lib.ts` and `n6-w1b.ts` for API shape only; nothing imports a `zz-n6` file.
- **Different entry path.** For N6-P2-1 I drove the **real store** (`useStore`: `setMachineKind('cnc')`, `importSvgObject`, `applyCncMachinePreset`, `applyCncStockMaterial`), so fresh-layer seeding and the preset's provenance refresh ran as in the app. I did not hand-build the project.
- **Own measures.** A modal G-code reader that records the modal F and S on every G1 that moves XY below Z0, then computes chip load = F / (S × flutes) per cutting move. It does not collect unique F and S words.
- **Own ETA check.** A bracket, not a clock: the lower bound is infinite acceleration (length / feed + dwell); the upper bound is a full stop at every block with a trapezoid at the profile's acceleration.
- **Own precision check.** The radius of every emitted vertex of a 3,600-vertex Ø300 on-path circle against the analytic 150 mm.
- **Runs.** Node only (≤ 650 MB), one process at a time, with 1.7 GB free. No Vitest, no browser, no hardware, no pnpm.

### Verdicts

| Finding | Verdict | Severity | Evidence (own) |
| --- | --- | --- | --- |
| N6-P2-1 | **CONFIRMED** through the store path. It is wider than stated in three ways: hardwood and aluminium reach 2.67× the repo's own chart; it reaches through a stage recipe and the remote/MCP `update_operation`; and a live `$30` produces the same rise with the same advice. Novelty narrowed: the mechanism appeared in passing in 2026-07-25 §3.3 | **P2** (borderline; see note) | `r1-store.ts` → `out/D*`, `E-*`; `r2-compile.ts` → `P21-*`; `r3-remote.ts` |
| N6-P3-1 | **CONFIRMED** on a different stage (pocket roughing, 1/4") | P3 | `r2-compile.ts` → `P31a/P31b` |
| N6-P3-2 | **CONFIRMED** (empty layer; a drill layer's never-sent feed) | P3 | `P32a/P32b` |
| N6-P3-3 | **CONFIRMED with a correction.** The Neotronics *device profile* does record `zTravelMm: 75`, and the check fires from it offline. Only the CNC *presets* never patch Z travel. A manual "Z travel" row exists in the device profile | P3 | `P33a–P33d`; READ `device-profile.ts:507`, `DeviceProfileRows.tsx:42` |
| N6-P3-4 | **CONFIRMED (READ + arithmetic).** The plan's own warning "The angular coordinate is unwrapped continuously" half-discloses it but does not name the overlap | P3 | READ `cnc-wrap-reference-plan.ts:33-44,100-106` |

**N6-P2-1: CONFIRMED, P2.**

The store path, my reader, 2 flutes:

| Case (store actions) | Layer as stored | Emitted on cuts | Chip load sent | Planned | Warning |
| --- | --- | --- | --- | --- | --- |
| A: preset 3018, then import, no material | no `cnc` block (default 12,000 / F1000, 1/8") | F1000 S10000 | 0.050 | 0.042 | spindle-ceiling line on **every** job |
| A: preset 4040-PRO, then import | same | F1000 S9000 | 0.0556 | 0.042 | same |
| B: import, then preset (3018 / 4040-PRO) | same | as A | as A | — | same |
| A: Neotronics / Shapeoko 3 | same | F1000 S12000 | 0.042 | 0.042 | none |
| C: MDF material, then 4040-PRO | material recipe, re-derived to 9000 / F1080 | F1080 S9000 | 0.060 | 0.060 | none (twin works) |
| D: Shapeoko, 1/16" hand-set 24,000 / F1440 (MDF), then 4040-PRO | kept 24,000 / F1440 | F1440 S9000 | **0.080** | 0.030 | ceiling line only |
| D: same, F960 (aluminium chart at 24k) | kept | F960 S9000 | **0.0533** | 0.020 | same |
| D: same, F1920 (hardwood chart at 24k) | kept | F1920 S9000 | **0.1067** | 0.040 | same |
| E: as D (MDF), the 1/16" given `fluteCount: 2` | kept | F1440 S9000 | 0.080 | 0.030 | same. The operation line adds "0.0800 mm/tooth programmed nominal chipload" and compares it with nothing |

- **Out of the box.** A fresh layer on the default profile is not seeded: there is no material and no starter, so `resolveCncAutoLayerSettings` returns null. It keeps 12,000 RPM whatever the preset says.
  - With the two Genmitsu presets, the default bit gets 0.050 and 0.056 mm/tooth: 1.2× and 1.33× the 0.042 the default's own comment states. Both are under the repo chart's 0.06 for 1/8" MDF, so this case is harmless.
  - Every job on those presets carries the ceiling warning until each layer is edited. That trains the operator to dismiss the one line that would carry the harmful case. I fold this into N6-P2-1. It is not a separate finding: the design acknowledges it in the `cnc-preflight.ts:284-291` comment and in `cnc-machine-preset.test.ts`.
- **What the trigger needs.** A hand-set RPM above the new ceiling. The layer card's Spindle field is capped at the current Spindle maximum (`CncLayerAdvancedFields.tsx:167-170`), so such a value can only come from:
  - a ceiling lowered after the value was set (preset, Machine Setup, or Use detected values);
  - an opened project or saved feed from another machine;
  - a stage recipe, whose fields have no maximum (`CncStageRecipeFields.tsx:123-132`). REPRO `P21-recipe-capped`: a wall-finishing recipe at 24,000 / F2880 on a 9,000 machine sends `F2880 S9000`, 0.16 mm/tooth on a 1/8" bit, under the same ceiling line;
  - remote/MCP `update_operation`, whose schema allows `spindleRpm` up to 100,000 (`design-validation.ts:40`, `electron/mcp/design-schemas.ts:50`). REPRO `r3-remote.ts`: 24,000 on the 4040-PRO is stored and sent as `S9000` with F1440 kept.
- **Live `$30` sibling (`P21-live-s30`).** Spindle maximum 30,000, live `$30` 9000, layer 24,000 / F1440. The program sends `S24000 F1440`, and GRBL runs full PWM, which is 9,000 RPM on a correctly scaled spindle. That is the same 0.080 mm/tooth. The warning ("S commands above $30 use maximum PWM … Verify the controller-to-spindle scale") points at the same wrong remedy. The fix should cover both lines.
- **Severity against the repo's own references.**
  - The chart (`feeds-calculator.ts:46-52`) gives a 1/16" bit (band ≤ 3.175) 0.06 mm/tooth in MDF, 0.04 in hardwood and 0.02 in aluminium.
  - FS-5 records the Shapeoko guide's 1/16" maximum in MDF as two thirds of the chart, about 0.04.
  - The per-diameter rule (0.025·D wood, 0.0125·D aluminium) gives 0.040 and 0.020.
  - So the auditor's MDF case (0.080) is 1.33× the chart and 2× the guide maximum. Hardwood (0.107) and aluminium (0.053) are **2.67×** the chart and the rule, at 0.5·D per pass.
  - A 1/16" bit at 2.7× in hardwood or aluminium plausibly snaps. The MDF case more likely overloads, deflects and gives a poor wall.
- **Why P2 and not P1.** Under METHOD §3:
  - The emitted F is exactly the operator's F, and the emitted S is exactly the operator's stated ceiling. No power, position, depth or scale word is wrong.
  - A warning fires on the exact trigger before output, naming both numbers ("requests spindle 24000 RPM … limited to 9000 RPM").
  - It satisfies "a clear warning reaches the operator before the output", though it misnames the consequence.
  - **Borderline.** If the maintainer reads "harms a job" to include a snapped bit, and the misdirecting remedy to mean the warning is not "clear", the hardwood and aluminium cases argue P1. I recommend P2, with the wording fix as the priority.
- **Novelty.** The auditor's "new" needs narrowing. 2026-07-25 §3.3 (`cnc-full-chain-audit.md:204`) already wrote "Every layer is then `capSpindle`'d to S1000 while its feed still assumes 12000 RPM — a 12× chipload increase". That finding was the `$30`/`$32` source, not the feed-keeping mechanism, which was never raised on its own. Call this a **new finding, with the mechanism previously noted in passing**.

**N6-P3-1: CONFIRMED, P3.**
- A pocket-roughing recipe on the 1/4" at F9000 / plunge 7000 sends `F6000`, with **no** advisory and **no** warning (`P31a`).
- The same values on the layer get two `cnc-settings-invalid` advisories (`P31b`).
- The recipe card's hint already says "nominal chipload … before machine feed limits" and the tooltip "Machine limits still apply to output", so P3 stands.

**N6-P3-2: CONFIRMED, P3.**
- An Output-on layer with no artwork, at F4500 and plunge 900 (live `$110/$111` 3000, `$112` 500), yields two false lines. The program sends only F1000.
- A drill layer at feed 4500 and plunge 300 warns "requests feed 4500 … above … 3000". The program has no XY cutting move at all (`cutsFS: []`).

**N6-P3-3: CONFIRMED P3, with a correction to the text.**
- `P33a` (default device, 44 mm deep): silent.
- `P33b` (Neotronics device profile, 44 mm): silent, correctly, since 47.8 < 75.
- `P33d` (Neotronics, 74 mm): "needs 77.8 mm of Z … the machine profile records 75 mm".
- `P33c` (typed 45): fires, matching the auditor.
- So "Neotronics: 75 mm … not recorded" is true of the `CncMachinePreset` only. The device profile the owner actually uses records it. The Z travel can also be typed in the device profile (`DeviceProfileRows.tsx:42`), or taken from `$132` via Use detected values (`DetectedSettingsBanner.tsx:49`).
- The 3018 and 4040-PRO presets remain the gap.

**N6-P3-4: CONFIRMED (READ), P3.**
- `mapCncWrapPoint` gives angle = Δc · 180 / (π r). For 40 mm at r 5 that is 458.4°, at r 6 it is 382.0°. Nothing compares the span with 2πr.
- The fixed warning list says the angle "is unwrapped continuously", which is consistent with the overlap but does not name it. The study is offline only.

### Challenges to "Verified clean"

- **"Spindle on/off: … RPM ≤ 0 refused by preflight": wrong.**
  - `cnc-preflight.ts:293-297` pushes `cnc-settings-invalid`. That code is **not** in `COMPILE_INTEGRITY_PREFLIGHT_CODES` (`blocking-codes.ts:32-50`), so `prepareOutput` returns ok, Save writes the file, and Start lists it as a warning (`start-job-readiness-policy.ts:319-331`).
  - REPRO `G1-rpm0`: the program emits `M3 S0`, then cuts with `F1000 S0`. `capSpindle` returns 0 for ≤ 0 (`compile-cnc-helpers.ts:78-80`).
  - The comment two lines above ("Only a non-positive RPM is a compile-integrity failure") contradicts the code. The reach is new finding N6r-P2-1 below.
  - Feed 0 or plunge 0 likewise only advise. `capFeed` substitutes the 1 mm/min floor (`G2-feed0`: `F1`). Neither is reachable today: the card's min is 1, the remote min is 1, and load uses `positiveOr`.
- **Warning numbers match emitted programs: holds** wherever I checked:
  - the ceiling line (24,000 / 9,000 against `S9000`);
  - `$30`, `$110`, `$112` (`P21-live-s30`, `P32*`);
  - Z span 47.8 / 77.8 against my reader's Z range −44…3.81 and −74…3.81.
- **Coolant around a bit change: holds** (`G5`): `M3 S12000 G4 P3 M8 … M5 M9 M0 M3 S10000 G4 P3 M8 … M5 M9`. Coolant starts after spin-up, and M9 comes after M5 before the M0 and at the end.
- **ETA: holds on my bracket.**

  | Job | Job Review | Lower | Upper |
  | --- | --- | --- | --- |
  | Profile with tabs | 105.8 s | 100.9 | 109.8 |
  | Offset pocket | 197.6 s | 192.3 | 199.8 |
  | Ø300 circle | 69.4 s | 68.7 | 177.6 |

  This checks consistency only. PV-1 (Z rate/accel) was not re-measured.
- **Precision: holds.** On the 3,600-vertex Ø300 circle, the worst vertex radius error is 0.00066 mm against the analytic circle, which is consistent with 3-decimal words: ±0.0005 per axis gives at most 0.0007 radial. That compares with the auditor's 0.0005 against the compiled path. `G21` appears in every program and `G20` never does.
- **Wrap length = flat twin: holds by construction (READ).** `cncWrapSegmentLength` at `radialZ` 0 gives Δangle·π·r/180 = Δc exactly. I did not re-run it.

### KNOWN re-observations (METHOD §3, no reach clause)

| Item | Re-observed | Rating under METHOD |
| --- | --- | --- |
| FS-2 (09-24 "High") | `r5-known.ts`: on the Neotronics profile every wood row from 1/16" up is F300 / S12000 = 0.0125 mm/tooth, 0.31× → 0.04× the 0.025·D rule and half the 0.0254 rubbing floor. Aluminium 0.5 mm stays at F240 | **P2.** Rubbing, heat and dulling are a real harm, but not wrong power, position, depth or scale, and the cap is a visible F. It should not be read as P1. Still open |
| FS-5 | Default profile: 0.5 mm bit at 0.030 in softwood and MDF, 2.40× the 0.025·D rule; 1/16" in MDF at 0.060, 1.51×. On the Neotronics profile the 300 cap happens to bring 0.5 mm wood rows to 1.00× | **P2.** Micro-bit breakage is plausible, but the chart is labelled provisional ("verify with a test cut"). No change |
| JR-5 | READ: `CncTool` still has no flute length (N4 re-observed the same) | P2. A buried shank snaps the bit, but the depth sent is the depth asked. No change |
| JR-8 | READ: no plunge > feed or RPM < `$31` warning exists in `cnc-machine-limit-warnings.ts` | P3. Plunge > feed is advice; `$31` runs a *lower* chip load (rubbing, not breakage). It could stay "Low" |
| FS-4 / K-6 | E case: with a flute count, Job Review prints 0.0800 mm/tooth and compares it with nothing | Open. N6-P2-1's fix is the natural first step |

### New findings

**N6r-P2-1: The remote/MCP `update_operation` accepts `spindleRpm: 0` for a CNC operation, and the job then saves and starts with `M3 S0`, cutting with the spindle commanded off. Preflight only advises, despite its comment saying a non-positive RPM is a compile-integrity failure.**
- **Where:**
  - `src/ui/remote-control/design-validation.ts:40`, `spindleRpm: z.number().min(0).max(100_000)`, the renderer copy of `electron/mcp/design-schemas.ts:50`;
  - `design-operations.ts:174-191` (`cncUpdate` → `withManualCncFeedPatch`) and `:247-272` (`setLayerParam`): no clamp;
  - `compile-cnc-helpers.ts:78-80`: `capSpindle` returns 0;
  - `cnc-grbl-transitions.ts:114`: `M3 S${Math.max(0, …)}`;
  - `cnc-preflight.ts:284-297`: the comment says compile-integrity, but the code is `cnc-settings-invalid`, which is advisory (`blocking-codes.ts:32-50`; `prepare-output.ts:189-199`; `start-job-readiness-policy.ts:319-331`).
- **Anchor.**
  - Twin: the layer card's Spindle field minimum is 1000 (`CncLayerAdvancedFields.tsx:167-170`), and F4 (2026-10-23) recorded "Spindle [1000, Spindle maximum], so typing 0 no longer reaches `M3 S0`".
  - Contract: the preflight comment at `cnc-preflight.ts:284` says "Only a non-positive RPM is a compile-integrity failure".
  - Twin: project load replaces 0 (`normalize-layer.ts:122`, `positiveOr`), and stage recipes require a positive value (`project-cnc-stage-validator.ts:23`).
- **Evidence:** REPRO `r3-remote.ts`. The real store, an imported rectangle, then `operationPatchSchema.safeParse({ cnc: { spindleRpm: 0 } })` (accepted), then `updateOperationFull(useStore, layer.id, …)` (receipt ok).
  - Stored `spindleRpm: 0`.
  - `prepareOutput` is ok. The program contains `M3 S0`, then `G1 Z-1.000 F300`.
  - Start-blocking issues: none. Start warnings: "Layer operation-r: spindle RPM must be greater than 0."
- **Scenario:** An AI client connected over KerfDesk's MCP server sets an operation's spindle to 0, for example to "disable" it, or as a unit slip. The operator presses Start. Job Review lists one line, which names the layer by id. If Start goes ahead on a PWM spindle, the stationary bit plunges 1 mm into the stock at F300 and is dragged through the profile: a snapped bit and a gouged part. A manually switched trim router is unaffected.
- **Severity: P2.** A warning naming the exact condition reaches the operator before output. This matches the 2026-07-25 rating of the same sink through the Job Review cell (P2, "the Job Review warnings list already names the exact condition"). It is not P3, because the input path is reachable today.
- **Announced?** Yes, as the generic settings line, with a layer id (JR-7 style), and not as a block.
- **Novelty:** this is a new input path to a known sink. The sink (`M3 S0` from RPM 0) was 2026-07-25 "Job Review spindle cell allows 0 RPM" (P2). F4 closed the card and cell paths; the MCP/remote schema was never aligned. The preflight comment/code drift is new.
- **Fix direction:**
  - Give both schemas `min(1000)` (or `.positive()`) to match the card. Applying the card's [1000, Spindle maximum] would also close the above-ceiling reach of N6-P2-1.
  - Either add a separate code for a non-positive RPM to `COMPILE_INTEGRITY_PREFLIGHT_CODES`, as the comment intends, or correct the comment.
  - Add a test that drives `update_operation` with `spindleRpm: 0`.

### Probes with no gap (new-gap search)

- **A layer with RPM 0 / feed 0 / plunge 0 (`G1`–`G3`).** Not reachable through the card, project load or stage recipes. They only advise (see challenge). RPM 0 is reachable through MCP (N6r-P2-1).
- **Presets switching mid-project (R1 B, C, D).** Automatic material layers re-derive feed and RPM together (C: 12,000 / F1440 → 9,000 / F1080, 0.060 held). Manual layers drift (N6-P2-1). Observation (READ): an automatic layer re-derived down to 9,000 keeps 9,000 when switched back to a 30,000 machine, because `materialSpindleRpm` takes the layer's stored RPM as its upper bound. The chip load is held and the job is only slower, so this is not raised.
- **A bit with a flute count (E).** The nominal chip-load line appears and is arithmetically right (0.0800), but nothing compares it with the chart or the planned value. There is no chip-load warning at all (KNOWN FS-4 / K-6).
- **Spin-up dwell against an RPM change (`G4`).** Two layers on one bit at 6,000 then 18,000 RPM: `M3 S6000 G4 P4.000 … M3 S18000 G4 P4.000`. Every S change gets the full dwell, which is conservative. There is no RPM-scaled ramp, and none is needed.
- **Inch.** `G21` appears in every program, and inch bits are stored as mm (1/16" = 1.588). I did not exercise an inch-reporting controller (`$13=1`).

### Not verified

- The rendered Job Review dialog and the Machine Setup preset UI: I used the store actions, not clicks.
- Whether the MCP design server is enabled by default, or gated behind a Pro or settings switch. N6r-P2-1's reach assumes an operator who has connected an MCP client.
- PV-1 ETA with Z limits, the wrap G93 timing, and the catalogue's 410 rows: not re-run (FS-2 and FS-5 rows were spot-checked in R5).
- Physical chip-load outcomes. Severity uses the repo's own chart, FS-5's recorded Shapeoko maximum, and the per-diameter rule; no vendor chart was fetched.

### Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-n6r\`. Run with `node --no-experimental-webstorage --import ./register.mjs <file>`. `r3-remote.ts` keeps the store alive after printing, so stop it once its output appears. Nothing in the repo or in `j38-main` was touched.

| File | Covers | Output |
| --- | --- | --- |
| `r1-store.ts` (+ `sum-r1.cjs`) | N6-P2-1 through the store: out-of-box presets, order, material twin, hand-set 1/16" ×3 materials, flute count | `out-r1.txt`, `out/A-*`, `B-*`, `C*`, `D*`, `E-*` |
| `r2-compile.ts` | N6-P3-1/2/3, live `$30` and stage-recipe facets, RPM/feed/plunge 0, spin-up dwell, coolant around a bit change, `G21` | `out-r2.txt`, `out/P3*`, `P21-*`, `G*.nc` |
| `r3-remote.ts` | N6r-P2-1, MCP `update_operation` RPM 0 and RPM 24,000 on the 4040-PRO | `out-r3.txt` |
| `r4-eta-precision.ts` | ETA bracket, Ø300 radius precision | `out-r4.txt` |
| `r5-known.ts` | FS-2 / FS-5 re-observation | `out-r5.txt` |

```json
{
  "area": "N6",
  "role": "refuter",
  "verdicts": [
    {"id": "N6-P2-1", "verdict": "CONFIRMED and wider (stage recipe, MCP, live $30); novelty narrowed (07-25 §3.3 noted mechanism)", "severity": "P2"},
    {"id": "N6-P3-1", "verdict": "CONFIRMED (pocket-rough stage)", "severity": "P3"},
    {"id": "N6-P3-2", "verdict": "CONFIRMED", "severity": "P3"},
    {"id": "N6-P3-3", "verdict": "CONFIRMED with correction: Neotronics device profile records 75 mm; presets only", "severity": "P3"},
    {"id": "N6-P3-4", "verdict": "CONFIRMED (READ)", "severity": "P3"}
  ],
  "new": [
    {"id": "N6r-P2-1", "severity": "P2", "summary": "MCP/remote update_operation accepts spindleRpm 0; Save/Start emit M3 S0 and cut with the spindle off; preflight comment claims integrity refusal but code only advises"}
  ],
  "counts": {"raised": 6, "refuted": 0, "P1": 0, "P2": 2, "P3": 4, "known": 17}
}
```

Refuter counts: raised 6, refuted 0, P1 0, P2 2, P3 4, known 17. That is the auditor's 5 plus 1 new (N6r-P2-1). Known: the auditor's 15, plus 2026-07-25 §3.3 (the feed-keeping mechanism noted in passing, which narrows N6-P2-1's novelty) and 2026-07-25 "Job Review spindle cell allows 0 RPM" (the sink N6r-P2-1 reaches by a new path).
