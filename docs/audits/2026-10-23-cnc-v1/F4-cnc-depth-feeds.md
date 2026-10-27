# CNC audit v1 — F4 Depth passes and feeds (`cnc-depth-feeds`)

- **When:** 2026-10-23   **Tree:** origin/main @ `17f4d6b68` (worktree `claude/rolling-audit-20261021` @ `cd34ce012`, whose `src/` is origin/main `ca3dbeb79`; `git diff HEAD origin/main -- src` touches 33 files, none in this area's scope or its twins)
- **Scope:**
  - Core: `src/core/cnc/depth-passes.ts`, `feeds-calculator.ts`, `nominal-chipload.ts`, `drill-peck.ts`, `cutting-preset.ts`, `cutting-preset-normalize.ts`, `cnc-head-feeds.ts`, `cnc-material-catalog.ts`, `cnc-machine-catalog.ts`, `cnc-machine-starter-catalog.ts`, `resolve-cnc-machine-starter.ts`, `machine-starters/resolve-cnc-auto-settings.ts`, `cnc-stage-settings.ts`, `compile-cnc-pass-group.ts` (feed/RPM capping).
  - Bit catalog: `src/ui/machine/cnc-bit-*.ts`.
  - Cut-settings UI: `CncLayerFields.tsx`, `CncLayerAdvancedFields.tsx` (Feed/Plunge/Spindle/Depth per pass), `CncLayerPrimitives.tsx`, `CncOperationToolFields.tsx`, `FeedsCalculatorRow.tsx`, `CncStageRecipeFields.tsx`, `CncFeedPresetRows.tsx`, and the state transforms behind them (`cnc-startup-setup.ts`, `cnc-feed-provenance.ts`, `cnc-project-material.ts`, `cnc-auto-seeding.ts`).
  - Twins followed into: the emitter `src/core/output/cnc-grbl-strategy.ts`, `cnc-grbl-entry-descent.ts`; Job Review `job-review-detail-facts.ts`, `job-review-effective-operations.ts`; `cnc-bit-change-advisory.ts`; `cnc-machine-limit-warnings.ts`; `cnc-preflight.ts`.
  - Governing: ADR-103 G5 / WORKFLOW F-CNC24 (calculator), ADR-111/112 (material), ADR-256 (starter), ADR-457 (stage recipes), ADR-481 + its 2026-09-22 amendment (Artwork operation bit/material choices; DECISIONS.md ~17240), ADR-491 (stay-down links), ADR-489/520 (air floors), ADR-140 (finish allowance), ADR-258 (tabs), DECISIONS.md ~8871 ("Set to stock thickness" adds no hidden overcut), ADR-629 (inch display), PROJECT.md rule 7.
- **Lenses run:** L1, L2, L3, L4, L7 as separate passes. L6 lightly (calculator error/null paths). L5 skipped: the only untrusted input here is imported cutting presets and `.lf2` stage recipes, which belong to project I/O (area 13); noted under Not verified.
- **Counts:** 3 raised → refuter: 3 confirmed, 0 plausible, 0 refuted; no severity changes → P1 0 / P2 1 / P3 2 (+ 9 KNOWN re-observed)

## Headline

The depth and feed arithmetic is sound. An independent G-code parser checked 360 compiled programs: 2 profiles × 2 spindle maxima × 6 bits × 5 materials × 3 operations (outside profile, pocket, drill). The checks were:
- every cutting level is at most the depth per pass below the one before it;
- the deepest level is exactly the requested depth;
- every descent into stock runs at or below the plunge rate;
- S equals the RPM;
- F equals RPM × flutes × chart chipload, rounded and capped exactly as documented.

There were no failures except the ADR-491 stay-down links, which pockets run at the plunge feed by design.

**The one P2 is a state bug in the Artwork operation card:**
1. Choose a Material on an operation. Its feeds become a material recipe.
2. Hand-edit any one value, such as Depth per pass. The recipe provenance is dropped, but the Material binding stays.
3. Change the Bit.

The old bit's feed, plunge and depth per pass are kept silently. Yet the card still says Material "Hardwood" and its tooltip promises "a new bit refreshes them". With a 1/4" → 1/16" change, the 1/16" bit gets 2.5× its chart chip load and 3.3× its chart depth per pass (1.26 × D). Machine Setup's tool plan runs the identical transform and does warn ("Bit changed. … were kept"); the Artwork card, Job Review and preflight do not.

**Chart values.** The chipload chart is not a vendor chart. For wood and plastic it sits at 0.33–0.94× the minimum of Amana's industrial charts. For hard wood it sits up to 2× above the hobby (Shapeoko A-to-Z) maximum. This is the KNOWN July wording/tuning item; WORKFLOW F-CNC24 still says "industry-typical mid-range".

## Bit / material matrix: emitted vs formula vs vendor

**How the table was made:**
- **Real path:** `resolveCncMaterialFeedPatch` (the calculator behind the card), then `compileCncJob`, then `cncGrblStrategy.emit`.
- **Setup:** Default profile; CNC Max feed 5000; layer RPM 18,000 with Spindle maximum 24,000 (or 12,000 where stated); 2 flutes unless noted; profile-outside 6.35 mm deep.
- **Measured from the program:**
  - F is the G1 XY word.
  - Plunge is the F on each Z-down move.
  - Stepdown is the largest drop between successive cutting levels.
- **Formula:** F = RPM × flutes × chart chipload, rounded to 10 mm/min and capped at Max feed. Every row matched exactly.
- **Vendor columns, all chipload per tooth:**
  - **Shapeoko A-to-Z:** [Feeds and speeds basics](https://shapeokoenthusiasts.gitbook.io/shapeoko-cnc-a-to-z/feeds-and-speeds-basics). Hobby guide; it groups "Soft wood & hard plastics" and "Hard wood & metals".
  - **Amana wood:** [2-flute solid carbide spiral, DLC, 24,000 RPM, DOC 1×D](https://www.amanatool.com/pub/media/productattachments/Solid-Carbide-Spiral-Plunge-Solid-Wood-DLC-Coated-Speed-Chart.pdf).
  - **Amana plastic:** [single O-flute plastic chart v2, 18,000 RPM](https://www.amanatool.com/pub/media/productattachments/Plastic-O-Flute-Speed-Chart-v2.pdf).
  - **Amana aluminium:** [single O-flute aluminium chart v6, 18,000 RPM](https://www.amanatool.com/pub/media/productattachments/Aluminum-O-Flute-Speed-Chart-v6.pdf). The catalog's O-flute entries cite this chart.

| Bit | Material | Emitted F / plunge F / S | Stepdown (levels) | Chart chip (mm/tooth) | Shapeoko A-to-Z | Amana | Verdict |
|---|---|---|---|---|---|---|---|
| 1/8" 2FL `em-3175` | Softwood | F1800 / F720 / S18000 | 1.6 (−1.6…−6.35) | 0.05 | 0.025–0.063 | 0.152–0.203 | Inside hobby range; 0.33× Amana min |
| 1/8" `em-3175` | Hardwood | F1440 / F580 / S18000 | 1.3 | 0.04 | 0.013–0.025 | 0.076–0.127 | 1.6× hobby max; 0.53× Amana min (KNOWN chart tuning) |
| 1/8" `em-3175` | Plywood/MDF | F2160 / F860 / S18000 | 1.6 | 0.06 | 0.025–0.063 (soft wood row) | 0.127–0.178 (MDF) | Inside hobby; 0.47× Amana |
| 1/8" `em-3175` | Acrylic | F1800 / F540 / S18000 | 1.0 | 0.05 | 0.025–0.063 (hard plastics) | 0.102–0.152 (O-flute) | Inside hobby; 0.49× Amana |
| 1/8" `em-3175` | Aluminium | F720 / F110 / S18000 | 0.3 | 0.02 | 0.013–0.025 (metals) | 0.076–0.152 (O-flute) | Inside hobby; 0.26× Amana |
| 1/4" 2FL `em-6350` | Softwood | F3960 / F1580 / S18000 | 3.2 | 0.11 | 0.025–0.127 | 0.178–0.229 | Inside hobby; 0.62× Amana |
| 1/4" `em-6350` | Hardwood | F3600 / F1440 / S18000 | 2.5 | 0.10 | 0.025–0.05 | 0.127–0.178 | 2× hobby max; 0.79× Amana (KNOWN) |
| 1/4" `em-6350` | Plywood/MDF | F3960 / F1580 / S18000 | 3.2 | 0.11 | 0.025–0.127 | 0.152–0.203 | Inside hobby; 0.72× Amana |
| 1/4" `em-6350` | Acrylic | F3600 / F1080 / S18000 | 1.9 | 0.10 | 0.025–0.127 | 0.203–0.305 | Inside hobby; 0.49× Amana |
| 1/4" `em-6350` | Aluminium | F1800 / F270 / S18000 | 0.6 | 0.05 | 0.025–0.05 | 0.102–0.203 | At hobby max; 0.49× Amana |
| 3/8" `em-9525` | Softwood | F5000 (capped from 6840) / F2000 / S18000 | 4.8 | 0.19 → 0.139 achieved | — | 0.203–0.254 | Cap applied and disclosed ("below the chart starting value") |
| 1/16" `em-1588` | Softwood | F1800 / F720 / S18000 | 0.8 | 0.05 (1/8" band) | 0.025–0.04 | — | KNOWN FS-5 (1.588 mm falls in the ≤ 3.175 band) |
| 1/8" O-flute 1FL | Aluminium | F360 / F50 / S18000 | 0.3 | 0.02 | 0.013–0.025 | 0.076–0.152 (55–110 IPM) | Inside hobby; 0.26× the chart the catalog cites |
| 1/8" `em-3175`, 12k max | Hardwood | F960 / F380 / S12000 | 1.3 (−1.3, −2.6, −3.9, −5.2, −6.35) | 0.04 | 0.013–0.025 | 0.076–0.127 | Formula exact |
| any bit, Neotronics 4040 | any | F300 (or less) / F≤120 / S12000 | ≤ 0.75 | 0.0125 achieved | ≥ 0.0127 floor | — | KNOWN FS-2 (09-24) |

**Depth per pass, as a fraction of diameter:**
- softwood/MDF 0.5, hardwood 0.4, acrylic 0.3, aluminium 0.1;
- Shapeoko A-to-Z: "10–50% for softer materials", 5–10% for metals.

**Plunge, as a fraction of feed:**
- wood 0.4, acrylic 0.3, aluminium 0.15;
- Shapeoko A-to-Z: woods 30–40%, plastics 40–50%, metals 10–30%.

**Reading.** Every value is inside or at the edge of the hobby guide except hard wood. Every wood and plastic value is below Amana's industrial minimum, so the chart is a between-sources starter, not a vendor chart. That disagreement between sources is the July low-confidence chart-tuning item (KNOWN, see K-1); it is not raised again here.

## Findings

### P2-1 — Changing the Bit in the Artwork card silently keeps the old bit's feeds after any one hand edit, while the card still shows the material recipe

- **Where:**
  - `src/ui/state/cnc-startup-setup.ts:79-96`. On a primary-bit change with an unchanged material, `settingsAfterPrimaryToolChange` re-derives feeds only when `feedSource.kind === 'material-recipe'`. Otherwise, `:96` `return withoutCncFeedSource(settings)` keeps every number.
  - `src/ui/state/cnc-feed-provenance.ts:11-28`. Any hand edit of feed, plunge, spindle or depth per pass drops `feedSource` but deliberately keeps `materialKey` ("without changing the Startup material binding").
  - `src/ui/layers/CncOperationToolFields.tsx:41-55` (the card's Bit commit, through the same transform) and `:117` (the Material tooltip).
  - The retained-feeds advisory `src/ui/common/cnc-bit-change-advisory.ts:48-68` is called only from `src/ui/laser/device-setup/use-machine-setup-save.ts:76` and `CncLibraryPanels.tsx`, never from the Artwork card.
- **Anchor:**
  - **Contract.** ADR-481 item 3: the Material tooltip "says that choosing one applies starting values and a new bit refreshes them". The 2026-09-22 amendment (DECISIONS.md ~17257) says **Manual** "clears the material recipe", and "Changing a bit refreshes material-recipe feeds, while manual cutting values remain exact". Here the operation is manual in behaviour but still presents itself as the material recipe:
    - the Material select reads "Hardwood";
    - the Feeds calculator badge reads "Hardwood" (`FeedsCalculatorRow.tsx:53`);
    - Job Review reads "Hardwood (general) feeds (legacy/unscoped)" (`job-review-detail-facts.ts:477`).
  - **Twin.** The amendment says "Both surfaces edit the same persisted operation bindings". Machine Setup's tool plan applies the identical `sceneWithCncStartupOperationDrafts` transform and then toasts `CNC_RETAINED_FEEDS_WARNING`. The Artwork card applies it with no notice.
- **Scenario:** default profile, Spindle maximum 12,000, an outside profile 6 mm deep.
  1. Bit 1/4" end mill (`em-6350`), Material **Hardwood**: 2400 / 960 / 12000 RPM / 2.5 mm per pass.
  2. Type Depth per pass **2**.
  3. Change Bit to the 1/16" end mill (`em-1588`).
  - **Result:** the layer keeps feed 2400, plunge 960 and 2.0 mm per pass. The 1/16" hardwood recipe is 960 / 380 / 0.6 (`calculateFeeds`), so this is 2.5× the chip load (0.1 against 0.04 mm/tooth; the Shapeoko A-to-Z 1/16" hard wood maximum is 0.025) and 3.3× the depth per pass (1.26 × D).
  - The Material select still shows Hardwood, and re-selecting Hardwood is a no-op, because `operationDraftMatches` sees no change.
  - Nothing warns:
    - `detectCncDefaultFeedWarnings` is silent because `materialKey` is set (`cnc-default-feed-warnings.ts:25`);
    - no Job Review detector compares chip load or depth to the bit;
    - the chip-load line needs a flute count, which the shipped bits lack.
  - Control: without step 2, the same bit change recalculates to 960 / 380 / 0.6.
- **Evidence:** REPRO.
  - Command: `node ../../../node_modules/vitest/vitest.mjs run src/ui/state/zz-f4-bitchange.test.ts`. The file is temporary and now deleted; a copy is in the session scratchpad at `f4-repros/src_ui_state_zz-f4-bitchange.test.ts`.
  - Output, `after bit change`: `{"depthPerPassMm":2,"feedMmPerMin":2400,"plungeMmPerMin":960,"spindleRpm":12000,"materialKey":"hardwood","toolId":"em-1588"}` (no `feedSource`).
  - Output, `material select shows hardwood`.
  - Output, `job review detail … Hardwood (general) feeds (legacy/unscoped)`.
  - Output, `Machine Setup advisory ["Bit changed. Feed, plunge, spindle RPM, and depth/pass were kept. Verify them for the selected bit before cutting."]`.
  - Output, `control (no hand edit) … "depthPerPassMm":0.6,"feedMmPerMin":960,"plungeMmPerMin":380`.
  - Emitted program (`f4-repros/bitchange.nc`): header `; cnc tool: end-mill; diameter-mm: 1.588`, then `F2400`, plunge `F960`, levels `Z-2.000 … Z-6.000`.
  - **L7:** `cnc-startup-setup.test.ts:92-114` ("preserves manual numbers when the operation bit changes") pins the retention. No test covers the card's notice.
- **Severity reasoning:** it needs one ordinary hand edit before a bit change, which is a common sequence. The UI presents the recipe as still in force, the result is a likely broken small bit, and the twin surface warns. It is not P1: the numbers are the operator's own retained values, and the program reflects them exactly.
- **Refuter:** **CONFIRMED, P2 kept.**
  - **What would have refuted it:**
    - a written rule that hand-edited values survive a bit change *and* a card notice;
    - a guard on the card's commit path (store action, toast, note);
    - a vendor chart under which the retained values are normal for a 1/16" bit.
  - **The rule exists, but the notice does not.**
    - The retention is deliberate. The anchor is ADR-306's 2026-09-22 amendment, not ADR-481 (ADR-481 is dated 2026-09-27; the amendment sits under ADR-306 at DECISIONS.md:17248). It says "manual cutting values remain exact" on a bit change (:17259), and ADR-306 decision 7 says the same (:17337-17341). `cnc-startup-setup.test.ts:92-114` pins `materialKey: 'hardwood'` with no `feedSource` surviving a bit change on purpose. Retention alone is not the bug.
    - The bug is the card's silence and its self-description. The tooltip text is verbatim at `CncOperationToolFields.tsx:117`: "…and a new bit refreshes them. Manual keeps your numbers." The Material select still reads Hardwood, which is not Manual.
    - A further contract line conflicts with the kept label. ADR-233 decision 5 (DECISIONS.md:11016-11018) says a feed/plunge/spindle/depth edit "clears automatic provenance and any stale material label". The `withoutCncFeedSource` comment ("without changing the Startup material binding", added in #663) keeps it.
  - **REPRO through the real component.** I drove `CncLayerFields` in jsdom, with the store and `setLayerParam`, not the transform:
    - **Steps:** select Material = hardwood, type Depth per pass 2 and blur, then select Bit = `em-1588`. The run used a temporary `src/ui/layers/zz-f4r-cardbitchange.test.tsx`, now deleted.
    - **Store after the bit change:** `depthPerPassMm 2, feedMmPerMin 2400, plungeMmPerMin 960, spindleRpm 12000, materialKey "hardwood", toolId "em-1588"`, with no `feedSource`.
    - **Card after the bit change:** the Material select value is `hardwood`, and no toast was pushed. The only role=note text on the card is the profile-leads note, and the card has no "kept" or "Verify" text.
    - **Passive cue only:** the same card's Feeds calculator section, collapsed by default (`RailSection` is a `<details>`) with the badge "Hardwood (general)", does show the right values. It reads: "at 12,000 RPM → chart chipload 0.040 mm: machine-aware feed 960, plunge 380 mm/min, 0.60 mm/pass".
    - **Job Review** labels the operation "feeds (legacy/unscoped)", not "recipe" (`job-review-detail-facts.ts:471-477`). That is a faint hint, and it does not name the bit.
    - **Twin:** `hasRetainedFeedsAfterEffectiveToolChange` is called only from `CncLibraryPanels.tsx:56` and `use-machine-setup-save.ts:76`.
  - **Vendor check** (fetched myself, chip load per tooth for a 1/16" bit in hard wood):
    - **Shapeoko A-to-Z:** 0.013–0.025 mm, and depth of cut 10–50 % of D for soft materials. The retained 0.10 mm/tooth at 1.26 × D is 4× the chip load and 2.5× the depth guidance.
    - **Onsrud hard-wood cutting data** (WoodWeb `Chipload_Hardwood.pdf`, text extracted): the most generous 1/16" row is .002–.004" (0.05–0.10 mm) at 1 × D, and "2 x D Reduce chip load by 25%". Another row is .0005–.0015" (≤ 0.038 mm). So on a rigid industrial router 0.10 mm at 1.26 × D sits at or just above the top of the most aggressive row, and it is 2.6× the conservative row.
    - **Amana's 2-flute DLC wood chart** has no 1/16" column. Its smallest is 1/8" hard wood, .003–.005" at 1 × D.
    - **Reading:** "likely to snap" is overstated for industrial machines. On the hobby GRBL routers this app targets, a broken bit or a ruined cut is plausible but not certain.
  - **Severity:** P2 stands. An ordinary user hits it through a misleading UI (Material and tooltip promise a refresh, and the twin surface warns), and the physical risk is plausible. It is not P1, because the card's own Feed, Plunge and Depth fields show the kept numbers and the program matches them.
- **Fix direction:**
  - When a hand edit drops `feedSource`, also show the operation as Manual or "Hardwood, edited". Otherwise, run `cncRetainedFeedAdvisoriesAfterSetupChange` on the card's bit commit, as Machine Setup does.
  - Either way, keep a Job Review fact naming the bit the values were set for.

### P3-1 — Job Review's "N passes" ignores the tab-top level, so the same card shows two different pass counts

- **Where:**
  - `src/ui/laser/job-review/job-review-detail-facts.ts:327` counts `zPassDepths(depth, depthPerPass).length`.
  - The compiler adds a level at the tab top for tabbed profiles: `src/core/cnc/compile-cnc-layer-passes.ts:361-362` (`depthsWithTabTopPass`).
- **Anchor:** **Twin.** The comment at `job-review-detail-facts.ts:215-218` says to "Read the pass count from the same helper the compiler steps with" (July 1.8 fixed an off-by-one this way). The compiled summary on the same card (`job-review-effective-operations.ts`, "Partial compiled summary") reports the emitted count.
- **Scenario:** an outside profile 6 mm deep, 2.5 mm per pass, tabs 2 mm.
  - The program cuts levels −2.5, −4 (tab top), −5 and −6.
  - The card detail says "3 passes"; the compiled summary says "4 passes".
  - With 6.35 mm at 1.5 mm per pass, the program cuts 6 levels (including a 0.15 mm level, −4.35 → −4.5), the detail says 5 and the summary says 6.
- **Evidence:** REPRO.
  - Command: `node ../../../node_modules/vitest/vitest.mjs run src/ui/laser/job-review/zz-f4-passcount.test.ts` (temporary; copy at `f4-repros/src_ui_laser_job-review_zz-f4-passcount.test.ts`).
  - Output: `emitted levels [-2.5,-4,-5,-6]`, `detail: 3 passes · … tabs 4 per shape`, `summary: … · 4 passes · …`.
  - Without tabs: 3 / 3 / 3.
- **Refuter:** **CONFIRMED, P3 kept; the twin evidence is corrected.**
  - **The undercount is real.**
    - `cncDepthParts` counts `zPassDepths` alone (`job-review-detail-facts.ts:327`).
    - For closed tabbed contours the compiler steps `depthsWithTabTopPass` (`compile-cnc-layer-passes.ts:362, 393-401`). That is the helper the :215-218 comment says to follow.
  - **The compiled-summary twin is coincidental.** The summary prints `group.passes.length` (`job-review-effective-operations.ts:214`), which counts pass records (levels × contours), not depth levels.
  - **REPRO, two rectangles.** I ran a temporary `src/ui/laser/job-review/zz-f4r-passcount.test.ts` (the auditor's repro with a second contour), now deleted. Each row gives the emitted levels, the detail count and the summary count:

    | Case | Emitted levels | Detail | Summary |
    |---|---|---|---|
    | Tabbed, 6 mm at 2.5 mm | `[-2.5,-4,-5,-6]` | 3 passes | 8 passes |
    | 6.35 mm at 1.5 mm | 6 levels | 5 passes | 12 passes |
    | No tabs, 6 mm at 2.5 mm | 3 levels | 3 passes | 6 passes |

  - **So:** the detail undercounts the emitted depth levels by one with tabs. The detail and summary disagree for any multi-shape operation, tabs or not. Anchor this on the :215-218 comment and the emitted ladder, not on the summary.
- **Fix direction:** derive the detail count from the compiled group's distinct levels, or apply `depthsWithTabTopPass` when tabs are on.

### P3-2 — The drill group's "feed" (min(feed, plunge)) is never emitted; a drill runs every move at the plunge feed, so the header and Job Review name a feed the program never uses

- **Where:**
  - `src/core/cnc/compile-cnc-pass-group.ts:25-28` sets `cutFeed = min(feed, plunge)` for drill.
  - The emitter sends every pure-vertical `path3d` segment at the plunge feed (`src/core/output/cnc-grbl-strategy.ts:423`), and a peck cycle is all vertical (`drill-peck.ts:41-54`).
- **Anchor:** **Twin / doc drift.**
  - The emitted header says `; cnc motion: feed-mm-min: 800; plunge-mm-min: 2000`, and Job Review says "800 mm/min feed · 2,000 mm/min plunge", while the cycle runs at F2000.
  - `drill-peck.ts:7-10` says compile "pins the drill group's cut feed" to the plunge feed. Prior audits restate this as fact: 2026-07-25 1.17, 2026-09-24 ("Drill layers always send the lower of feed and plunge"), and controller-v4 E3 ("a peck group's feed is `min(feed, plunge)`").
- **Scenario:** drill layer, feed 800, plunge 2000. Every peck runs at `G1 … Z-2.000 F2000` and retracts at F2000. The program header and Job Review row show feed 800. When plunge ≤ feed the two agree, so the pin only matters for display.
- **Evidence:** REPRO.
  - Command: `node ../../../node_modules/vitest/vitest.mjs run src/core/cnc/zz-f4-drill.test.ts` (temporary; copy at `f4-repros/src_core_cnc_zz-f4-drill.test.ts`).
  - Output (`f4-repros/drill.txt`): `; cnc motion: feed-mm-min: 800; plunge-mm-min: 2000` / `G1 Z0.000 F2000` / `G1 X50.000 Y350.000 Z-2.000 F2000`.
- **Severity reasoning:** no physical difference from the configured plunge (JR-8 already covers plunge faster than feed). It is a misleading label and a stale contract in three audit reports.
- **Refuter:** **CONFIRMED, P3 kept.**
  - **Code reading:**
    - `compile-cnc-pass-group.ts:25-28` sets the group feed to `min(feed, plunge)` for drill.
    - The peck is one `path3d` with constant XY (`drill-peck.ts:41-54`).
    - `path3dSegmentFeed` returns `plunge` for every pure-vertical segment (`cnc-grbl-strategy.ts:423`).
    - Entry descent is at plunge too (`cnc-grbl-entry-descent.ts:30`).
  - **REPRO:** a temporary `src/core/cnc/zz-f4r-plunge.test.ts`, now deleted. Drill layer, `em-3175`, depth 6 mm, 2 mm per peck, feed 800, plunge 2000:
    - group `feedMmPerMin 800`, `plungeMmPerMin 2000`;
    - emitted lines read by hand:
      ```
      ; cnc motion: feed-mm-min: 800; plunge-mm-min: 2000
      G1 Z0.000 F2000
      G1 X50.000 Y350.000 Z-2.000 F2000
      ```
      then Z0 / Z-4 / Z0 / Z-6 with no new F;
    - the only F word in the program is 2000.
  - **Novelty:** this is not KNOWN as stated. The 2026-07-25 survivors verifier noted that drill rows show a feed the program does not use. That was about stored versus `min()` values, which 1.17 fixed. The 2026-09-24 sentence "Drill layers always send the lower of feed and plunge" is factually wrong whenever plunge > feed.
- **Fix direction:** report only the plunge feed for drill groups, or pin the group feed to the plunge feed. Correct the `drill-peck.ts` comment.

## KNOWN (re-observed on this tree, not re-raised)

- **K-1 — chart sourcing and wording** (2026-07-25 table row `feeds-calculator.ts:5-8`, "the wording overclaims"; 2026-07-25 "Not verified": chart comparison low-confidence). The code comment now says "PROVISIONAL conservative". WORKFLOW F-CNC24 Success 3 still says "industry-typical mid-range"; against Amana every wood and plastic band is below the industrial minimum. The July verified-clean line ("all bands sit inside the Shapeoko hobby ranges") does not hold for hard wood: 0.04 against 0.025 at 1/8", and 0.10 against 0.05 at 1/4". Recorded here as a correction to that note, not as a new finding.
- **K-2 — FS-5 band edges** (2026-09-24). 1/16" (1.588 mm) takes the 1/8" chipload. Re-observed: `em-1588` softwood = 0.05 mm/tooth.
- **K-3 — FS-6 chip thinning not modelled** (2026-09-24; 2026-09-29 "Still open"). Adaptive keeps the slotting chipload; there is no thinning factor anywhere in `src/core/cnc`.
- **K-4 — July 2.2 / F-CNC24 Edge: V-bits, engraving and tapered ball-nose bits are banded by full diameter.** Disclosed by `cnc-angled-tool-feed-advisory.ts`. Re-observed: `vb90` 12.7 mm hardwood = 3600 / 1440 / 5.1 mm per pass.
- **K-5 — FS-2 Neotronics starter ceiling** (300 mm/min, 0.75 mm, S12000 for every bit and material: 0.0125 mm/tooth). Re-observed for all 35 bit × material pairs on the 4040 profile.
- **K-6 — FS-1 / FS-4.** A secondary bit inherits the primary values unless a stage recipe exists (disclosed by the `cnc-secondary-tool-feed-retained` preflight). Nothing checks chipload or depth against the cutting bit. P2-1 is a specific path that FS-4 does not describe (the twin advisory exists, but not on this surface).
- **K-7 — AC-8 / CW-04 drilling.** One bit-sized hole at the bounding-box centre. Pecks retract to Z0 and return at the plunge feed through air. Re-observed in `drill.txt`.
- **K-8 — JR-8.** No warning for a plunge faster than the feed, or for an RPM below `$31` (there is no spindle-minimum field). Re-observed: plunge 2000 with feed 800 compiles silently.
- **K-9 — 2026-09-29 P2-advcam-1.** A tiled helix becomes a `path3d` with no `lateralFeed` (`tile-plan.ts:202-203`), so its descending segments run at the cutting feed. READ only.

## Refuted (self-checked before raising)

The refuter refuted none of the three raised findings. The entries below are the auditor's own pre-raise checks.


- **Pocket XY moves at the plunge feed:** ADR-491 stay-down links (`pocket-stay-down-links.ts:204`, `lateralFeed: 'plunge'`). By design. This was the only class of "failure" in the 360-program matrix.
- **Feed above CNC Max feed silently capped:** compile caps it (`capFeed`), and `runCncPreflight` reports `cnc-settings-invalid` "feed … is outside (0, max]" as an advisory (`cnc-preflight.ts:292-305`). The calculator row says "below the chart starting value" when the cap lowers the chipload.
- **RPM above Spindle maximum silently capped:** Job Review `spindleVsConfiguredCeiling` warns offline (`cnc-machine-limit-warnings.ts:84-95`). The card's Spindle field clamps to [1000, max].
- **A through-cut should add spoilboard overcut:** no CNC overcut setting exists, by decision. DECISIONS.md ~8871 says "It adds no hidden overcut", and WORKFLOW ~6925 agrees. `overcutMm` is laser-only (ADR-415).
- **The live controller `$30` caps automatic RPM without rescaling the feed:** removed. `cnc-controller-caps.ts` passes only `$110/$111/$112`.
- **Stage-recipe fields ignore the inch preference:** ADR-629 §5 limits the first increment to Cut depth, Depth per pass, Feed and Plunge. The stage fields keep an honest `mm` label.

## Verified clean

- **Depth ladder** (`zPassDepths`):
  - full passes at exactly the depth per pass, then a shallower remainder;
  - final level exactly at −depth;
  - never a step deeper than the depth per pass, including imperial and rounding-hostile ratios;
  - `DEPTH_EPS` error is ≤ 1e-9 × step;
  - the tab-top insertion only splits a step.
  - Matrix: 360/360 programs passed `maxStep ≤ dpp + 0.0011` and `deepest = −depth`.
- **Feeds math** (`calculateFeeds`):
  - mm/min = RPM × round(flutes) × mm/tooth;
  - rounded to 10 mm/min, floored at 50;
  - plunge = feed × factor, floored at 25, ≤ feed;
  - depth per pass = D × factor, rounded to 0.1, floored at 0.1;
  - capped by CNC Max feed, live `$110/$111` and the starter; plunge also by live `$112`.
  - It matched the independent formula on all 140 calculator rows. The capped case (3/8" softwood → 5000) is disclosed in the card ("below the chart starting value").
- **Emission:** F, S and plunge match the layer values after `capFeed` / `capSpindle`, in all 360 programs. Every descent into stock (entry plunges, drill pecks, contour levels) is at or below the plunge rate.
  - **Refuter spot-check.** The matrix measured the Z component of each descent, but it ran with tabs off and with no ramp or helix entries. I re-ran it as a temporary `src/core/cnc/zz-f4r-plunge.test.ts` (now deleted), with feed 2400 and plunge 960, on ten cases:
    - profile ramps at 5°, 30° and 45° (tabbed, and on a 3 mm circle);
    - an inside profile ramp at 10°, a pocket ramp at 5° and an engrave ramp at 15°;
    - tabs with no ramp;
    - helical pocket entry at 3° and 20°;
    - an adaptive pocket.
  - **Result:** every in-stock descent has a Z rate at or below the plunge rate, worst exactly 960 (the vertical entry plunges).
    - Ramp moves are `z-rate-capped`. They run at an F up to the full XY feed (2400), with the Z component held at or below plunge.
    - Helix G2/G3 arcs run at F = plunge along the path.
    - Rectangular tab rises and falls are pure vertical, so they run at plunge.
    - "At or below the plunge rate" therefore means the Z component, not the F word.
- **Drill on GRBL:** explicit `G1` peck motion, with no G81/G83 canned cycle (stock GRBL has none). Peck = depth per pass. A peck cannot exceed the flute length unless the whole depth does, and `cnc-tool-reach.ts:106-112` flags that.
- **Calculator inputs:**
  - Spindle RPM is the lesser of the layer RPM, Spindle maximum, `cncSubProfile` and the starter.
  - Flute count comes from the bit, else the recipe's evidence, else 2. The O-flute catalog entries carry `fluteCount: 1`, and their feed halves accordingly.
- **Material change in the card or Machine Setup** re-derives feed, plunge, RPM and depth per pass for the operation's own bit (`settingsWithMaterialBinding`). Stage recipes stay manual, as documented.
- **Card field ranges:**
  - Feed and Plunge [1, CNC Max feed];
  - Spindle [1000, Spindle maximum], so typing 0 no longer reaches `M3 S0`;
  - Depth per pass [0.05, 50] mm; Cut depth [0.05, 200] mm.
  - Inch display converts at the edge only, and the emitted F floors.
- **Job Review compiled summary:** reads F, plunge and S from the compiled group (`effectiveGcodeFeedMmPerMin`, rounded S). July 1.17 (stored, not compiled, values) is fixed.
- **Machine and bit catalogs:** every machine preset carries sourced bed size and RPM rows. The bit catalog stores no feeds; flute counts appear only where a listing supports them.

## Not verified

- **Chart truth against the full set of vendor charts.** Onsrud and Whiteside PDFs were not fetched. Amana's three charts and the Shapeoko A-to-Z table disagree with each other by 3–6× for wood, so a single "correct" chart value cannot be asserted without a maintainer choice of target machine class.
- **Relief, inlay, V-carve and helix depth ladders.** These belong to F6, F5, F1 and F3. Only their use of `zPassDepths` was confirmed.
- **Imported cutting presets and `.lf2` stage recipes.** A positive but tiny depth per pass (no lower bound in `cutting-preset-normalize.ts` or `project-cnc-stage-validator.ts`) could make a very long ladder. This is project-I/O territory and was not run.
- **The rendered UI.** It was not driven in a browser. P2-1 was reproduced through the same pure transform the card calls, plus the Job Review detail helper. The refuter then drove the real `CncLayerFields` component in jsdom (store, `setLayerParam`, toast store). That is still not a browser.
- **Hardware behaviour.** No hardware was operated, including the actual spindle RPM against the S word.

```json
[
  {"id":"F4-P2-1","severity":"P2","area":"cnc-depth-feeds","file":"src/ui/state/cnc-startup-setup.ts","line":96,"anchor":"Contract ADR-481 item 3 tooltip + ADR-306 2026-09-22 amendment (DECISIONS.md:17248) + ADR-233 D5 stale material label; Twin cnc-bit-change-advisory.ts via use-machine-setup-save.ts:76 / CncLibraryPanels.tsx:56","evidence":"REPRO zz-f4-bitchange.test.ts: 1/4in hardwood 2400/960/2.5 -> hand-edit dpp 2 -> bit 1/16in keeps 2400/960/2.0, Material still 'hardwood', Machine Setup advisory fires, card silent; emitted F2400 Z-2 steps on 1.588 mm bit. Refuter REPRO zz-f4r-cardbitchange.test.tsx drove CncLayerFields + store: same 2400/960/2.0, Material select hardwood, no toast or note","verdict":"CONFIRMED","known":false,"summary":"Artwork-card bit change after any hand edit keeps the previous bit's feed/plunge/depth per pass with no notice while the card still shows the material recipe; Machine Setup's identical transform warns"},
  {"id":"F4-P3-1","severity":"P3","area":"cnc-depth-feeds","file":"src/ui/laser/job-review/job-review-detail-facts.ts","line":327,"anchor":"Twin compile-cnc-layer-passes.ts:362 depthsWithTabTopPass vs Job Review detail; comment :215-218","evidence":"REPRO zz-f4-passcount.test.ts: emitted levels [-2.5,-4,-5,-6], detail '3 passes', compiled summary '4 passes'. Refuter REPRO (two contours): levels [-2.5,-4,-5,-6], detail 3, summary 8 (summary counts pass records, not levels)","verdict":"CONFIRMED","known":false,"summary":"Job Review pass count omits the tab-top level the compiler adds, so the detail undercounts emitted depth levels by one on tabbed closed profiles (the compiled-summary twin is coincidental: it counts levels x contours)"},
  {"id":"F4-P3-2","severity":"P3","area":"cnc-depth-feeds","file":"src/core/cnc/compile-cnc-pass-group.ts","line":27,"anchor":"Twin cnc-grbl-strategy.ts:423 (vertical path3d at plunge) vs group feed min(feed,plunge); drill-peck.ts:7-10 comment","evidence":"REPRO zz-f4-drill.test.ts: feed 800 plunge 2000 -> header feed-mm-min 800, every peck G1 ... F2000. Refuter REPRO zz-f4r-plunge.test.ts: group feed 800, only F word in program F2000","verdict":"CONFIRMED","known":false,"summary":"Drill group's displayed feed min(feed,plunge) is never emitted; the whole cycle runs at the plunge feed"}
]
```
