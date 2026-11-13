# N7 — CNC fix verification (CNC audit v3, `cnc-fix-verify`)

## Question

Do the fixes and decisions merged after the N1–N6 round (#1878, #1884, #1885, #1887, #1889, #1891, #1892, #1893, #1894, #1895) do what the ledger says, on main, measured from the emitted programs and the real recovery flow, and did any of them break something that held before?

## Tree

- **After:** read-only export `j39-main` = `origin/main` @ `54b67e3ad` (fetched 2026-11-14; no newer commit on main, no open PR).
- **Before:** `j38-main` = `9a0b1a80b` (the N1–N6 tree; the prior auditors' and refuters' stored outputs in `zz-n1…zz-n6r\out` were produced on it). For byte comparisons across a single PR I extracted `src` (+ `node_modules` junction) of:
  - `t-pre1892` = `751c8b146` (main just before #1892);
  - `t-pre1894` = `2d8a32384` (main just before #1894);
  - `t-pre1889` = `f8c17f8c4` (main just before #1889, after #1885; `public/` added).
- `git log 9a0b1a80b..54b67e3ad --first-parent` confirms every fix in scope lies between the two exports.
- **FS-2 option A ("Keep 300, lower RPM", 3,000 RPM floor and starter seed) is NOT on main.** #1895's ADR-233 Amd 2 says the cap change "waits for the maintainer's choice". Reported as pending, not as a finding.

## Method

- **Re-runs.** Every N1–N6 auditor and refuter repro was copied into `zz-n7\a-<area>` (pointed at `j39-main`; `b-<area>` copies point at `j38-main`) and run one Node process at a time (`--max-old-space-size=450`) through a sequential queue (`qrun.sh`, `runlog.txt`). New output was compared with the stored N1–N6 output from the same script, and emitted programs were compared byte for byte with comment lines stripped.
- **Readers.** I used the prior areas' independent readers unchanged: N1 `n1-reader`, N1r min-cut / free-part reader `r-reader`, J1's oracle (`r-oracle`), N2 exact heightfield sweep, N2r 0.04 mm grid, N3 2.5D grid, N3r polygon booleans, N4/N4r G-code readers, N6r modal chip-load reader.
- **New probes (mine):**
  - `n7-small.ts`: 41 small holes and parts, ⅛" and ¼", both trees, holding cross-section by min-cut;
  - `n7-free.ts`: a flood fill that finds any piece not connected to the board;
  - `n7-open.ts`: open outlines from 0.5 to 4.5 mm short of their start, Tabs on and off;
  - `n7-transform.ts`: manual tabs under transforms, with a wall pairing that does not assume the old seam;
  - `n7-stock.ts`: `thicknessSet`, run on `j39` and `t-pre1892`;
  - `n7-spindle.ts`: S/F, the capped comment and preflight, run on `j39` and `t-pre1894`;
  - `n7-guide.ts`: FS-2 and JR-5 warnings through `prepareOutput`;
  - `n7-passes.ts`: the pass kinds a profile compiles to;
  - `r-reg-noleads.ts` and `r-reg-notabs.ts`: registration variants, also on `t-pre1889`.
- **Recovery** ran on the GRBL simulator only, through the real store, rail and rendered `CncPassRecoveryWizard`. I re-ran the refuter's `r-holdabort.r.test.tsx` (A, A0, B, C, E, G, H) and `r-reconnect.r.test.tsx` (D, D2), plus the auditor's `s5-holdabort.n5.test.ts`. Vitest ran only when free RAM was at least 2.4 GB, with one file, one worker and port 5201.
- No hardware, browser, pnpm or build; no live service; no file in the repo or in `j39-main` was touched.

## Headline

Most of the round's fixes hold under the prior auditors' own measures. Corner tabs, small holes, seam leads, through-pocket islands, script-text joins, bit-width channels, tiled entries, the capped spindle, spindle 0, the stock mark, the slot refusal and all three recovery P1/P2s are fixed. Uncapped layers, untabbed plain pockets and non-overlapping text programs are byte-identical to before. Two P1s remain:

1. **N7-P1-1: #1885 does not keep registration bores out of parts cut with the default lead-in.** An Outside or Inside profile with the default arc leads compiles to open `path3d` passes. The bore placement only counts `closed` passes (or ramped `path3d`) as part loops. A 600 × 300 panel in 3 × 2 tiles still gets **11 of 14 bores drilled through it**, and a coaster sheet gets one bore 3.65 mm inside a coaster. The same jobs with leads off get every bore in the waste, or a named seam with no bore. This was the same before #1889, so it is the fix's gap, not a regression.
2. **N7-P1-2: an outline that stops just over one cut width short gets neither tabs nor a warning.** It is held only by a sliver of gap − D: 0.025 mm at 3.2 mm on the ⅛" bit. #1889 tabs the loop only when the gap is under the cut width. The Tabs-off twin of the same outline warns that the part comes free.

One P2: **N2-P2-1 is only partly fixed.** Tapered balls are fixed. The 60° V-bit and the 30° engraver still take up to 3.1 mm and 2.7 mm under the tip along about 100 mm of the refuter's pyramid edge band. The note says one depth per pass, which is 1.5 mm.

Three P3s:
- the new tab-hold warning says small holes hold "by as little as 0 mm" when they hold by 3.0–3.7 mm;
- a short new overload on the plain 1 mm ball;
- the surfacing panel's capped RPM still keeps its feed.

## Fix tables

### #1889 tabs (ADR-258 Amd 5)

| Finding | Verdict | Numbers (before → after) |
|---|---|---|
| J1-P1-1 small holes and parts swallowed | **fixed** | Refuter `r-j1`: holes Ø8–14.8 through 0.000 → 0.495–0.608; parts 6–8.6 mm 0 → 0.38–0.51. `n7-small`: Ø8–14 holes now reach Z−6.35 with 1–3 tabs and a named warning. A Ø6 hole stays at the tab top, named by size. `n7-free`: **no freed piece** in 13 small-loop programs. |
| N1-P2-1→P1 corner tabs | **fixed** | Square 60: 3.31 → **6.00** mm bridges (auditor, refuter and J1 oracle). Rectangles 70×60…200×190: 4.17 → 6.00. Triangle: 1.40 → 5.97. `sq60-w1`: freed → held (1.0 mm). `sq60-w2.5` ¼": freed → held (2.45). ¼" plate: 4.86 → 6.00. Hexagon: 4.75 → 5.97. |
| N1-P2-2→P1 near-closed outlines | **fixed for gap < D; residual N7-P1-2** | 0.3, 0.5, 1, 2, 3, 3.15 mm gaps, On path and Outside: 1 piece → 4 tabs of 12 mm², warning names the outline. 3.2–4.5 mm: no tab, no warning. |
| N1-P2-3 leads thin seam tabs | **fixed** | Ø16 default lead 6.68 → 10.49 mm² (= leads off). Ø18 r4: 1.47 → 10.83. Ø18 r5 (erased a tab): 2 → 4 bridges of 10.83. Ø25 r5: 6.04 → 11.47. |
| J1-P3-1 tab-top relap | **fixed** | The 10 mm square now gets 2 tabs and cuts through (levels −1/−2/−3); no loop is lapped. |
| N1-P3-1 split loops | **fixed** | Neck shape: 8 → 4 tabs in all. One dragged anchor lands on its own lobe; the other lobe keeps automatic tabs, both slugs held. |
| N1-P3-2 Edit positions | **fixed** | Seeded tabs = automatic tabs (12.0 = 12.0 mm²). |
| N1-P3-3 wording | **fixed** (READ) | `CncTabFields.tsx:45`, `cnc-detail-tutorials.ts:82`. |
| **Regression side** | **clean, plus N7-P3-1** | 46-case sweep: tab count, height, levels, kept material (0) and rapids into stock (0) unchanged. Every set width now emitted exactly (6.05 → 6.00). Manual tabs under three transforms: anchor-to-tab 1.59 mm on both trees. Tiles: nothing dropped. Only narrower bridge found: 5-point star with 4 tabs, 4.80 → 4.65 mm (above half the set width). |

### #1892 (ADR-258 Amd 6) decision "6.35 mm counts as set"

| Check | Verdict | Numbers |
|---|---|---|
| Marked 6.35, 7 mm Outside | **correct** | Tab tops at Z−4.35 (2 mm above the bottom); before, Z−5.00. |
| Marked 6.35, 3 mm groove | **correct** | No tab rises. "Skips its holding tabs … 3.4 mm floor holds the part". Program hash = the 6.36 mm program on `t-pre1892`. |
| Old project (6.35, no mark) | **byte-identical** | 7 programs (depth 3/5/6.35/7, 12 mm, 6.36) equal to `t-pre1892` once #1894's `; cnc tool-flutes: 2` comment is stripped. `normalizeCncStock` keeps only an exact `true` (`"true"` and `false` are dropped). |

### #1878 (ADR-421 Amd 4) relief, and J1-P2-1

| Finding | Verdict | Numbers |
|---|---|---|
| N2-P2-1 narrowing finishing bits | **partly (N7-P2-1)** | Auditor cone/steps/dome: tapered balls and engraver ≤ 1.48 under the centre, lenOverDpp 0 (was 2.3–4.3 / up to 33 mm). Refuter pyramid: 1 mm-tip tapered fixed (2.79 → 1.50). 0.5 mm tip: 3.39 / 47 mm → 1.66 / 9.2 mm. **Engraver 4.75 / 126 mm → 2.74 / 100 mm. V-bit 3.87 / 118 mm → 3.12 / 107 mm.** Auditor cone V-bit: 2.20 / 11.9 → 1.99 / 11.7 mm. |
| N2-P2-2 1/16" rest after 1/4" | **fixed** | Auditor dome `bn-1588`: 3.72 → 0.90; cone 4.68 → 0.62, 2–3 levels. Refuter ellipse 1/16" rest: max 1.500, nothing over one pass. |
| N2-P2-3 thin floor | **fixed** | 0.001–0.15 mm floors in 6.35, 6, 12 mm stock now warn "leaves only … under its floor". 0.35 mm stays silent. |
| N2r-P2-1 interior wall | **fixed** | 1 mm ball, 4 bar phases: 9.97 mm at Z−3, up to 3.0 under the centre → 0 mm over 1.55. Plaque: 16.5 → 0.49 mm. |
| N2-P3-1 rest scallop | **fixed** (READ) | `compile-cnc-relief-rest.ts:106-109` defaults to the finish's scallop. |
| J1-P2-1 V-carve at stock bottom | **fixed** | 6.35 in 6.35 warns; 6.35 in 6.5 warns "leaves only 0.15 mm". |
| **Regression side** | **N7-P3-2** | Plain 1 mm ball on the refuter's ellipse dome: a new 1.5 mm stretch at up to 2.88 under the centre (was 1.62 max). Pyramid: 0.6 mm at 1.62 (was 1.50). Plaque and bars improved. |

### #1887

| Check | Verdict | Numbers |
|---|---|---|
| Test support only? | **yes** | Diff touches only `prepare-relief-n2-step-down.test.ts` and `relief-gcode-stock.test-support.ts`. No product file. |

### #1884 pockets

| Finding | Verdict | Numbers |
|---|---|---|
| N3-P1-1 through pocket frees islands | **fixed** | All 31 auditor and refuter pocket programs that free an island (offset, raster, adaptive, rest, lifted, "D", 12 mm stock, two islands, plaque plus outline) each name it: "pockets through the stock … round 2 islands (16 × 20 mm and 11.99 × 12 mm)". 0.05 and 0.15 mm floors get the skin variant. The tabs-off profile twin is unchanged. |
| N3r-P2-1 script joins | **fixed** | Pacifico "Hello": 18.7 → 0.0 mm² left. Great Vibes "Anna": 10.1 → 0.0. |
| N3r-P2-2 bit-width channel | **fixed** | 6.35 slot and 25 mm arm on the ¼" bit, and 3.175 slot on the ⅛": silent → "1 area no wider than the 6.35 mm bit — no tool path enters it". 6.351 still cut. |
| P3s | **fixed** | N3-P3-1: island-adaptive seam pass. N3-P3-2: raster capped at 100 %, with a message. |
| **Regression side** | **clean** | 63 of 75 N3/N3r programs byte-identical (moves). All 12 differences are intended: island adaptive, raster 110 %, tabbed profiles, overlapping text. Roboto "BOAR" (no overlaps) identical. |

### #1891 (ADR-154 Amd 7) decision "refuse slots at 50 %"

| Check | Verdict | Numbers |
|---|---|---|
| L and 44 × 30 at 50 % | **refused** | Both fall back to offset rings with "Adaptive verification simulated a full-width slot". |
| 32 mm square at 50 % | **still adaptive** | Max ae 5.59 mm, slot length 0. |
| 10 % unchanged | **yes** | Adaptive matrix 16 of 18 programs byte-identical; the two that differ are the 50 % L and rectangle. AC-6 measures at 10 % unchanged (sq32 p99 0.87, max 1.87). |

### #1885 tiling

| Finding | Verdict | Numbers |
|---|---|---|
| N4-P1-1 registration bores | **partly: fails at the default lead-in (N7-P1-1)** | Refuter R1–R4. Off-board bores: 6 → 0. Seams with no clear spot are named. But the R3 panel has **11 of 14 bores inside the part** (3.9–121.6 mm from its edge), and R2 has 1 of 2 inside a coaster (3.65 mm). With leads off: 0 in parts. `t-pre1889` gives the same. |
| N4-P2-1 seam entries | **fixed** | Helical pocket tiled: stock under the bit at plunge 93 → 0 of 126. Helix at F300, max descent 11 mm/min. Profile with arc lead: plunges into stock 6 → 3 (= untiled). Notice names the operation. |
| N4-P3-1 overlap repeat | **disclosed** | Ratio 1.081 / 1.090 / 1.155, with an advisory; none at overlap 0. |
| **Regression side** | **clean** | Untiled → tiles: dropped cut max 0.000 mm. The auditor's "extra … Infinity" is its own reader excluding the bores at the old fixed positions. |

### #1893 recovery (ADR-215 Amd 3, 4)

| Finding | Verdict | Numbers (refuter wizard, GRBL simulator) |
|---|---|---|
| N5-P1-1 Abort at a Zero-Z hold | **fixed** | A, B, G: "Position retained" disabled; Start refused before any write ("the reset cleared the Zero Z (G92) set for 6.35 mm (1/4") end mill…"). Wire count 0. A0 (not zeroed): "no Z zero is on record for the bit in the spindle". Auditor V-bit case: retained refused with the bit named, 0 lines cut (was 112). E (probe zero): re-zeroed recovery now starts at the new bit's group (op 3 pass 1, commanded −2.0) instead of op 1 pass 3 with the old bit. |
| N5r-P1-1 resetting reconnect | **fixed** | D and D2: "A reconnect after the stop did not show that the controller kept running…". Retained not offered. D (at a hold) also refuses for the missing zero. |
| N5-P2-1 default across the bit change | **fixed** | A/A0/G default = group 2 pass 0, 7 passes proven (was group 0 pass 2). Auditor: group 1 pass 0, `heldAtToolChange: true`. |
| N5-P3-1, N5r-P3-1 | **fixed** (READ) | `window-stream-lit-stop-warnings.ts:16-17,126-127`; `merge-cnc-recovery-warnings.ts:22`. |
| **Regression side** | **clean (GRBL)** | C (Pause, lift, Abort, no bit change, probe zero): retained still offered, ran to the next hold, deepest 3.00 mm, identical to before. H (Abort during the park): unchanged (alarm, refused). grblHAL not run (see Not verified). |

### #1894 (ADR-233 Amd 1)

| Finding | Verdict | Numbers |
|---|---|---|
| N6-P2-1 capped spindle | **fixed** | 1/16" 24,000 on 9,000: `F1440 S9000` → `F540 S9000` (plunge 300 → 112), chip 0.030 = planned. Store path (refuter): hardwood 0.107 → 0.040; aluminium 0.053 → 0.020; out-of-box 3018/4040 0.050/0.056 → 0.042. Stage recipe `F2880` → `F1080`. Program carries `; cnc spindle-capped:`. |
| N6r-P2-1 spindle 0 | **fixed** | `cnc-spindle-off` (compile integrity) on the emitted job; MCP and remote schemas `min(1000)`. |
| N6-P3-1 / N6-P3-2 | **fixed** | Recipe F9000 / plunge 7000 now advised. A layer with no artwork and drill XY feed no longer warn. |
| **Regression side** | **byte-identical** | Default profile, pocket, drill and uncapped 9,000-on-9,000 programs equal `t-pre1894` once the new `; cnc tool-flutes: 2` comment is stripped (connected-script snapshot: +84 bytes = 4 × that line). Residual sibling: N7-P3-3. |

### #1895 (ADR-233 Amd 2)

| Finding | Verdict | Numbers |
|---|---|---|
| FS-5 continuous chart | **fixed; ⅛" and ¼" unchanged** | 50 catalogue rows at 3.175 / 6.35 mm identical to `j38`. 1/16" hardwood F960 → F510 (0.021 mm/tooth). |
| JR-5 depth guide | **works** | 2 mm per pass on 1/16" warns. 10 mm with ⅛" warns; 9.5 mm (2.99 D) silent. V-carve exempt. |
| FS-2 low chip load | **works** | Recipe ¼" F300 S12000: "0.0125 mm/tooth, 11 % of 0.1100". ⅛": 21 %. Hand-set: silent. |
| FS-2 option A (cap / RPM change) | **pending, not on main** | Note for the decision: at its 3,000 RPM floor a ¼" plywood recipe at 300 mm/min sends 0.050 mm/tooth, 45 % of the chart, and still gets this warning. |

## Findings

### N7-P1-1 — Registration bores are still drilled through parts cut with the default lead-in (N4-P1-1 fix incomplete)

- **Where:** `src/core/cnc/tile-registration-placement.ts:373-401`.
  - `addPassObstacles` adds a loop only when `isLoop(pass)`.
  - `isLoop` returns true for `pass.closed`, or for a `path3d` with `entryRamp`.
  - An Outside/Inside profile with the default arc leads (ADR-250) compiles to open `path3d` passes: lead-in + ring + lead-out. `n7-passes.ts`: a 600 × 300 panel gives `{"path3d/open":4}` with leads (5 with tabs), and `{"contour/closed":4}` with leads off.
  - So the part's outline counts only as cut segments: a bore more than R + r + 2 mm from them is "clear" even in the middle of the part.
- **Anchor:** ADR-433 amendment (#1885) decision 1: "outside every closed cut loop (a part, a pocket or a hole)". Twin: the same jobs with `profileLead.shape: 'none'` put every bore in the waste or name the seam.
- **Evidence (REPRO, `r-reg.ts`, `r-reg-noleads.ts`, `r-reg-notabs.ts`, `n7-passes.ts`):**

  | Case | Default leads | Leads off |
  |---|---|---|
  | R3: 600 × 300 × 12 panel, 3 × 2 tiles | **11 of 14 bores inside the panel** (3.91–121.59 mm from its edge), Z−12, through | 3 bores in waste; 4 seams named |
  | R2: eight Ø90 coasters | **1 bore inside coaster 6, 3.65 mm from its edge**, Z−6 | 2 in waste |

  Off-board bores are gone (was 6 in R1–R3). Tabs on or off make no difference. `t-pre1889` gives the same 11 / 1, so #1889 did not cause it. Each bore is listed in the tiled save and drawn in preview, but nothing warns.
- **Scenario:** a cabinet side or sign blank larger than the bed, cut Outside with default settings and tiled with registration on (the default once tiling is on). Every interior seam bore goes through the finished panel.
- **Severity:** **P1**. It drills holes through the part, and a listed or previewed result is not a warning.
- **Announced?** No. The ADR's tests use geometry that compiles to closed passes.
- **Novelty:** new facet of KNOWN N4-P1-1 / AC-5. The fix's gap.
- **Fix direction:** in `isLoop`, treat a profile ring as a loop regardless of its lead: carry `closed`/`ringClosed` provenance from `profile-lead-passes.ts`, or test that the path3d's ring returns to its start within the cut width. Add a `tile-registration-placement` test with a default-lead Outside part.

### N7-P1-2 — An outline that stops just over one cut width short gets no tabs and no warning, and is held only by a sliver (N1-P2-2 residual)

- **Where:** `src/core/cnc/cnc-tabbed-contour-passes.ts:139-149`. `bitClosesOutline` uses `gapMm < cutWidthMm - EPS`.
- **Anchor:**
  - Twin: the same outline with Tabs off warns "the part and any hole slugs come free on the final pass" at every gap tested (0.5–4.5 mm).
  - Codebase rule: `THIN_POCKET_FLOOR_MM = 0.2` ("a floor thinner than this holds nothing"). ADR-572 Amd 4 counts 0.1 mm as cut free.
- **Evidence (REPRO `n7-open.ts`, 80 × 60 outline, ⅛" bit, 6.35 through):**
  - gap 3.0 and 3.15 mm: 4 tabs, 12 mm² bridges, warning;
  - gap **3.2 / 3.3 mm**: no tab, no warning, held only by the uncut sliver gap − D = **0.025 / 0.125 mm** across the full 6.35 mm depth (0.16 / 0.8 mm² of section, against 12 mm² for one tab). 3.6 and 4.5 mm (0.43 / 1.3 mm slivers) are likewise silent.

  The same holds On path and Outside. By the code, the ¼" bit has the same window at 6.35–6.55 mm (not run).
- **Scenario:** a hand-drawn or imported outline whose end stops a hair more than the bit width from its start. SVG closes only within 1e-4 mm; ADR-672's join is 0.5 mm and Outside/Inside only. It is cut through with Tabs on as shipped. On the last pass the sliver tears and the part comes free with the bit running, and Job Review says nothing.
- **Severity:** **P1** (a freed part, the N1-P2-2 hazard). P2 considered, because the window is 0.2 mm wide and the decision chose D as the boundary. METHOD has no reach clause, and the codebase's own threshold treats ≤ 0.2 mm as free.
- **Announced?** No. ADR-258 Amd 5 decision 4 says "the material across its gap holds it".
- **Novelty:** new (the boundary of the #1889 fix).
- **Fix direction:** use `gap < D + THIN_POCKET_FLOOR_MM` in `bitClosesOutline`, or warn "held by an X mm sliver" for D ≤ gap < D + 0.2. Make the Tabs-off warning use the same rule.

### N7-P2-1 — V-bit and engraver relief finishing still take up to 2.1 passes under the tip in the edge band (N2-P2-1 partly fixed)

- **Where:** `src/core/relief/relief-next-tool-radius.ts` and `relief-roughing-reach.ts` (ADR-421 Amd 4 decision 1). A narrowing bit is judged by its radius one Depth per pass above the tip. Levels and the note are planned, but the tip still rides deeper. Likely cause (READ, not proven): the strip the levels cover is sized from that radius, while the V-bit's tip descends the band's slope.
- **Anchor:**
  - ADR-421 Amd 4 Consequences: "no lateral move of these bits has more than one 1.5 mm pass (plus 0.1 mm of grid slack) under its centre", including the 30° engraver along an edge band.
  - The emitted note says the bit "steps down … one depth per pass".
  - Twin: the 1 mm-tip tapered ball on the same pyramid: max 1.50.
- **Evidence (REPRO, refuter `r-p21.ts`, 0.04 mm grid, dpp 1.5):**

  | Surface / bit | Before (`j38`) | After |
  |---|---|---|
  | pyramid, 30° engraver | 4.75 max, 125.9 mm > 1.55 | **2.74 max, 100.2 mm** (longest 13.3), F1000, 3 levels + note |
  | pyramid, 60° V-bit `vb-60-3175` | 3.87, 118.4 mm | **3.12, 106.8 mm** (longest 13.5), 2 levels + note |
  | ellipse, V-bit | 3.13, 23.7 mm | 2.56, 18.1 mm |
  | ellipse, 1 mm-tip tapered ball | 4.00, 24.0 mm | 2.96, 7.6 mm |

  Auditor `n2-narrow` (its own sweep): cone V-bit 2.20 / 11.9 → 1.99 / 11.7 mm.
- **Severity:** **P2**, as N2-P2-1 was rated (1.3–2.1× a normal pass; nothing gouged).
- **Announced?** The note claims one pass, so no.
- **Novelty:** KNOWN N2-P2-1, residual after #1878.
- **Fix direction:** judge the strip by the tip's descent along the band (or at the levels' actual Z), then re-run `r-p21` pyramid and ellipse with the V-bit and engraver as regression cases.

### N7-P3-1 — The new tab-hold warning says small holes hold "by as little as 0 mm"; measured 3.0–3.7 mm

- **Where:** `src/core/cnc/cnc-tab-placement.ts:288-310` (`bridgeAcross`). On a loop shorter than about two windows, `reach = (P − window)/2` walks the cut arc, so "the cut running on from the other end" is the same kerf, measured across the hole interior. Warning: `cnc-tab-hold-warnings.ts`.
- **Evidence (REPRO `n7-small.ts` min-cut; `n7-free.ts`):**

  | Shape | Claim | Measured |
  |---|---|---|
  | Ø8 hole | 0 mm | waste attached along about 218° of wall; no freed piece |
  | Ø9 hole | 0.9 mm | no freed piece |
  | Ø10 hole | 2.2 mm | 3.69 mm (7.38 mm²) |
  | 8 mm square hole | 1.5 mm | 3.46 mm |
  | 10 mm hexagon | 1.0 mm | 3.23 mm |
  | ¼" Ø16 hole | 1.4 mm | 2.92 mm |
  | Ø4 part | 2.6 mm | 3.97 mm |

  ¼" Ø12/Ø14 holes are also claimed at 0 mm. Wedges (acute tips) are measured correctly (1.0 / 0.6 mm = reader).
- **Scenario:** every small bolt hole gets "drag those tabs to straighter edges… or use narrower tabs" advice that cannot be followed on a circle and that would weaken a hold that is fine.
- **Severity:** **P3**, wrong advice like N5-P3-1. P2 considered.
- **Novelty:** new (regression of #1889's warning).
- **Fix direction:** cap `reach` so it never wraps past the window's own kerf ends, or skip the bridge test when the cut arc is shorter than about 2D. Add a Ø8/Ø10 hole case to `cnc-tab-hold-warnings.test.ts`.

### N7-P3-2 — The plain 1 mm ball gets a new short overload on a dome edge

- **Where:** #1878 decision 2 (wall-shadow rule replacing the edge-only rule, `relief-roughing-reach.ts`).
- **Evidence (REPRO `r-p21.ts`, `r-dump.ts`):** refuter ellipse dome, `r-bn1`:
  - before: max 1.62 under the centre, longest 1.85 mm;
  - after: **one 1.5 mm stretch, lines 3594-3613, Z−2.66…−1.56, F1000, up to 2.88 under the centre** (area 1.6× slot@dpp).

  Pyramid: 0 → 0.6 mm at 1.62.
- **Severity:** **P3**: a 1.5 mm stretch at 1.9× a pass.
- **Novelty:** new (regression).
- **Fix direction:** add the refuter's ellipse with `r-bn1` to `prepare-relief-n2-step-down.test.ts`.

### N7-P3-3 — Surfacing still caps a typed RPM without scaling its feed (N6-P2-1 sibling)

- **Where:** `src/ui/machine/save-surfacing-program.ts:137-148`. `spindleRpm: Math.min(inputs.spindleRpm, spindleMaxRpm)`, while the feed is capped only to Max feed. `cncCuttingRates` covers layer, relief and registration groups, not surfacing.
- **Evidence:** READ. The panel shows "Output uses … RPM after machine limits" (`SurfacingFields.tsx:96-101`); the starter seed is computed at `spindleMaxRpm`, so only a typed RPM above the maximum reaches it.
- **Severity:** **P3** (typed value, disclosed with the sent RPM, facing pass).
- **Novelty:** new sibling.
- **Fix direction:** route surfacing through `cncCuttingRates`.

## KNOWN status (every N1–N6 P1/P2 and the decisions)

| ID | Status on `54b67e3ad` |
|---|---|
| J1-P1-1 | fixed (#1889) |
| N1-P2-1→P1 | fixed |
| N1-P2-2→P1 | fixed below the cut width; residual N7-P1-2 |
| N1-P2-3 | fixed |
| N2-P2-1 | partly fixed; residual N7-P2-1 |
| N2-P2-2 | fixed |
| N2-P2-3 | fixed |
| N2r-P2-1 | fixed |
| N3-P1-1 | fixed (warning names every freed island) |
| N3r-P2-1 | fixed |
| N3r-P2-2 | fixed |
| N4-P1-1 | partly fixed (off-board gone, seams named, preview); **bores still inside default-lead parts, N7-P1-1** |
| N4-P2-1 | fixed |
| N5-P1-1 | fixed (GRBL simulator) |
| N5r-P1-1 | fixed |
| N5-P2-1 | fixed |
| N6-P2-1 | fixed (surfacing sibling N7-P3-3) |
| N6r-P2-1 | fixed |
| J1-P2-1 | fixed (#1878) |
| **Decision J1-P3-3** (6.35 counts as set) | implemented as decided; old projects byte-identical |
| **Decision AC-6** (refuse slots at 50 %) | implemented as decided; 10 % unchanged |
| **Decision FS-2 / FS-5 / JR-5** | FS-5 and JR-5 implemented, FS-2 warning implemented; **option A (300 mm/min, lower RPM) pending, not on main** |

P3s fixed in the same PRs: J1-P3-1, N1-P3-1/2/3, N2-P3-1, N3-P3-1/2, N4-P3-1 (disclosure), N5-P3-1, N5r-P3-1, N6-P3-1/2. Still open: J1-P3-2, N4-P3-2/3, N5-P3-2 (unchanged at `laser-status-line.ts:202-215`), N5-P3-3/4, N6-P3-3/4.

## Verified clean

- **Tabs:** 46-case sweep and refuter misc/kept checks show:
  - kept material 0;
  - no rapid into stock;
  - tab height and levels unchanged;
  - every bridge at least as wide as before except a 5-point star with 4 tabs (4.80 → 4.65 mm).

  J1's oracle agrees with the refuter reader on the six key programs.
- **Pockets:** 63 programs byte-identical, 12 differences all intended.
- **Adaptive:** 16 of 18 programs byte-identical at the default; the 32 mm square at 50 % still plans adaptively.
- **Spindle:** uncapped programs byte-identical apart from the documented comment line.
- **Tiling:** the tiled cut covers the untiled one (dropped 0.000 mm). Seam ramps descend no faster than the plunge rate.
- **Recovery:** a safe Abort keeps "Position retained" and recovers identically to before (C). The confirmation lists the bits; the refusals come before any controller write (wire count 0).

## Not verified

- **grblHAL:** the kept-G92 path (no grblHAL simulator run). It rests on READ of `work-z-before-reset.ts:52-60` and the PR's own `cnc-recovery-after-reset.simulator.test.tsx`.
- An in-session reset button after an Abort (ADR-215 Amd 4 lists it as a follow-up).
- The rendered Job Review and preview of the registration bores. Physical strength of slivers and small-hole crescents (arithmetic and grid only).
- V-bit profile tabs, relief-projection tabs, multi-tool tabbed layers. The FS-2 option A program (not on main).
- E-case "physical depth" from the refuter's harness: its stock-top model does not follow a plate probe (15–16 mm on both trees), so I judged E by the recovery boundary and bit only.

## Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-n7\`. Run from the file's folder with `node --no-experimental-webstorage --import ./register.mjs <file>`; for `n7-tree` probes in `zz-n7\` set `TREE=<tree dir>`.

| File | Covers | Output |
|---|---|---|
| `a-<area>\…`, `b-<area>\…` | N1–N6 auditor and refuter scripts re-pointed at `j39-main` / `j38-main` | `a-<area>\out\*.txt`, `so-*.txt` |
| `a-n1r\n7-small.ts`, `b-n1r\n7-small.ts` | small holes and parts, min-cut, both trees | `out\n7-small.txt` |
| `a-n1r\n7-free.ts` (+ `b-`) | freed-piece flood fill | `out\n7-free.txt` |
| `a-n1r\n7-open.ts` | **N7-P1-2** | `out\n7-open.txt` |
| `a-n1\n7-transform.ts` (+ `b-`) | manual tabs under transforms | `out\n7-transform.txt` |
| `a-n2r\r-p21.ts`, `r-dump.ts` | **N7-P2-1**, **N7-P3-2** | `a-n2r\out\p21.txt`, `dump-ell-bn1.txt` |
| `a-n4r\r-reg.ts`, `r-reg-noleads.ts`, `r-reg-notabs.ts`, `p-n4r\r-reg.ts`, `a-n4r\n7-passes.ts` | **N7-P1-1** | `out\reg*.txt`, `out\n7-passes.txt` |
| `n7-tree.ts`, `n7-stock.ts`, `n7-spindle.ts`, `n7-guide.ts` | #1892, #1894, #1895 (`TREE=…\t-pre1892` / `t-pre1894`) | `out\stock2-*.txt`, `spindle-*.txt`, `guide-j39.txt` |
| `n7-vitest.mjs`, `a-n5r\vitest.r.config.mts`, `a-n5\vitest.n5.config.mts`, `sum-n5r.cjs` | N5 / N5r suites on `j39-main` | `a-n5r\out\*.json`, `a-n5\out\*.json`, `out\vt-*.txt` |
| `t-pre1889`, `t-pre1892`, `t-pre1894` | extracted `src` trees (`node_modules` is a junction: never delete recursively) | — |
| `qrun.sh`, `queue.txt`, `runlog.txt`, `cmp-n1.cjs` | queue runner and comparison | — |

## Counts

| Raised | P1 | P2 | P3 | Known (statused) |
|---|---|---|---|---|
| 6 | 2 | 1 | 3 | 19 P1/P2 + 3 decisions |

```json
[
  {"id":"N7-P1-1","severity":"P1","file":"src/core/cnc/tile-registration-placement.ts","line":397,"anchor":"ADR-433 amendment (#1885) D1 'outside every closed cut loop'; twin leads off","evidence":"REPRO","known":"N4-P1-1 / AC-5 (fix incomplete)","summary":"Default-lead profiles compile to open path3d passes that isLoop does not count, so 11 of 14 bores land inside a 600x300 panel and 1 inside a coaster"},
  {"id":"N7-P1-2","severity":"P1","file":"src/core/cnc/cnc-tabbed-contour-passes.ts","line":146,"anchor":"Tabs-off twin warns; THIN_POCKET_FLOOR_MM 0.2","evidence":"REPRO","known":"N1-P2-2 residual","summary":"Open outline with gap in [D, D+0.2) gets no tabs and no warning, held by a 0.025-0.2 mm sliver"},
  {"id":"N7-P2-1","severity":"P2","file":"src/core/relief/relief-next-tool-radius.ts","line":20,"anchor":"ADR-421 Amd 4 consequences; emitted one-pass note; tapered-ball twin 1.50","evidence":"REPRO","known":"N2-P2-1 residual","summary":"V-bit 3.12 / 107 mm and engraver 2.74 / 100 mm under the tip over one pass on the pyramid edge band"},
  {"id":"N7-P3-1","severity":"P3","file":"src/core/cnc/cnc-tab-placement.ts","line":292,"anchor":"Measured min-cut bridges","evidence":"REPRO","known":null,"summary":"Tab-hold warning claims 0-2.2 mm on small holes that hold by 3.0-3.7 mm"},
  {"id":"N7-P3-2","severity":"P3","file":"src/core/relief/relief-roughing-reach.ts","line":null,"anchor":"Before 1.62 max","evidence":"REPRO","known":null,"summary":"Plain 1 mm ball: new 1.5 mm stretch at 2.88 under centre on ellipse dome"},
  {"id":"N7-P3-3","severity":"P3","file":"src/ui/machine/save-surfacing-program.ts","line":145,"anchor":"ADR-233 Amd 1 one rate rule","evidence":"READ","known":"N6-P2-1 sibling","summary":"Surfacing caps a typed RPM without scaling the feed"}
]
```

## Refuter (2026-11-14)

**Tree and harness.** Read-only export `j40-main` = `origin/main` @ `951f94712`, newer than the auditor's `54b67e3ad`. Between them only #1897 (FS-2 option A, ADR-256 Amd 1) and #1898 (CNC spindle review e2e fixture; ceiling-warning RPM disclosure) merged. `git diff --stat 54b67e3ad 951f94712 -- src` lists 18 files: the 4040 starter catalogue and resolver, `resolve-cnc-auto-settings.ts`, `cnc-machine-limit-warnings.ts`, `FeedsCalculatorRow.tsx`, four `ui/state` seeding callers, and their tests. None of them is a tab, registration, tiling, relief, pocket, adaptive or recovery file. So every N7 tab, tiling, relief and recovery result carries to `j40-main` unchanged, and I re-measured the P1s and the P2 there.

My scripts are in `zz-n7r\`. Run each with `node --no-experimental-webstorage --import ./register.mjs <file> [args]` (the loader was copied from `zz-e2`). I read the auditor's `n7-tree.ts`, `n7-guide.ts`, the N4r `r-build.ts`/`r-reg.ts` and the N2r `r-p21.ts`/`r-surf.ts`/`r-build.ts` for API shape only. Nothing imports a `zz-n7`, `zz-n4r` or `zz-n2r` file.
- **Own builder** (`x-build.ts`): `createProject` / `createLayer` with `imported-svg` polylines, the Save path (`emitGcode`), and `prepareOutput` + `detectMachineJobWarnings` for Job Review.
- **Own G-code reader** (`x-build.ts readG`): modal G0–G3 (arcs split at 0.5 mm), the `layer-id:` comment, point-in-polygon and edge distance. It shares no code with the CAM, the emitter or any earlier reader.
- **Own measures:**
  - **Registration bores:** the deepest point of each feed move below Z0 in the `tile-registration` section of every tile file, mapped to stock coordinates by the tile rectangle. Each bore is classified against the drawn parts and their holes. The bores are cross-checked against `plannedTileRegistration`, which is what Preview draws.
  - **Open outlines:** the sliver is (distance between the bit centre's two end positions on the full-depth floor) − D. The ends are read from the emitted floor moves, not from the drawn gap.
  - **Relief:** a 0.05 mm height grid with analytic cutter shapes (flat, ball, V, flat-tipped engraver, tapered ball), carved by every feed move. Carving lags the tip by one tool diameter of path, so the measure at the tip is the material the pass meets, not what its own leading flank took 0.05 mm earlier. The metric is the material standing over the tip on lateral moves of `relief-finish`. It is run on `j40-main` and on `j38-main` (before #1878).
  - **Tab bridges:** the chord between consecutive full-depth floor pieces, minus D: the narrowest straight section of the tab at the stock bottom.
- **Own geometry:**
  - **Tiling:** a 520 × 260 r25 tabletop in 12 mm under 2 × 2 tiles (default leads, leads off, 5° ramp, Tabs off); a Ø320 disc; a 400 × 300 frame with an Inside window; two 220 × 280 panels with a 20 mm lane.
  - **Open outlines:** an open circle and an open bracket at 2.5–7 mm gaps, ⅛" and ¼".
  - **Relief:** a 50° cone, a 35° ridge, and the N2r 40° pyramid and ellipse (rebuilt from their formulas to reproduce).
  - **Holes:** Ø8–Ø20 holes and a 9 mm square hole in a plate.
  - **Spot checks:** squares, a rectangle, a triangle and an L under corner tabs; a through pocket with two bosses; adaptive at 1.5875 / 0.3175 mm on 44 × 30, 60 × 22, a 44 × 16 L, a 32 mm square and a 40 mm octagon.
  - **#1897:** a 25-recipe matrix on the 4040 profile, plus 260 recipe rows compared between `j39-main` and `j40-main`.
- **Not used:** pnpm, Vitest, a browser, hardware, the GRBL simulator. Each Node process ran under 550 MB, one at a time, with 2.1–2.4 GB free.

### Verdicts

| Finding | Verdict | Severity | Evidence (own) |
| --- | --- | --- | --- |
| N7-P1-1 | **CONFIRMED, wider.** It also hits a disc, a frame rim and the panel beside a waste lane. **The tile advisory says the bores are clear of every part and cut.** It is a new facet of KNOWN N4-P1-1 / AC-5 | **P1** | `x-reg.ts` → `out/reg.txt`; READ `tile-registration-placement.ts:373-400` |
| N7-P1-2 | **CONFIRMED.** One anchor correction: the Tabs-off "twin" warning is geometry-blind, so it is not evidence that the app judges the sliver free. The Outside variant gets an open-path notice, but no hold warning | **P1** (window D ≤ gap ≲ D + 0.1–0.2 mm) | `x-open.ts` → `out/open.txt`; `x-open1.ts`; READ `cnc-tabbed-contour-passes.ts:141-149`, `cnc-through-cut-tab-warnings.ts:146-163`, `cnc-profile-part-issues.ts:21-36` |
| N7-P2-1 | **CONFIRMED, and worse for the V-bit.** On my model #1878 did not change the 60° V-bit at all (pyramid 99.7 → 99.5 mm over 1.55 mm). The 1 mm-tip tapered ball also still overloads on the ellipse, so "tapered balls are fixed" in the Headline overclaims | **P2** | `x-relief.ts` → `out/relief-all.txt`; `x-relief38.ts` → `out/relief-j38.txt`; `out/relief-note.txt` |
| N7-P3-1 | **CONFIRMED.** The claims sit 1.2–1.6 mm below my floor-neck on every case | P3 | `x-holes.ts` → `out/holes.txt` |
| N7-P3-2 | **CONFIRMED, wider:** the plain 1 mm ball's peak rose on 3 of 4 surfaces, each over a short length | P3 | `out/relief-all.txt` vs `out/relief-j38.txt` |
| N7-P3-3 | **CONFIRMED** (READ, unchanged on `j40`) | P3 | `save-surfacing-program.ts:127-150`, `SurfacingFields.tsx:96-101` |
| #1897 (FS-2 option A) | **Implemented as decided**; 2 new P3s (N7r-P3-1, N7r-P3-2) | — | `x-fs2.ts` → `out/fs2.txt`; `x-recipes.ts` → `out/recipes-j39.txt`, `out/recipes-j40.txt` |
| #1898 / N6-P2-1 | **Correct:** the RPM disclosure is present and every number in the warning matches the program | — | `x-cap.ts` → `out/cap.txt` |

### Per-finding notes

**N7-P1-1: CONFIRMED, P1.** Setup: the tiled Save core (`finalizeTiledOutput`), with the registration draft from `registrationDraftFromCurrentSettings` (Ø3.175, the first layer's depth). The stock is the parts plus a 10–15 mm margin. Pass kinds are counted from the prepared job.

| Job (own) | Pass kinds | Bores | **In a part** | Waste |
| --- | --- | --- | --- | --- |
| Tabletop 520 × 260, 12 mm, default leads | `path3d/open` × 5 | 8 | **6** (3.91–111.6 mm inside its edge), Z−12 | 2 |
| same, Tabs off | `path3d/open` × 4 | 8 | **6** | 2 |
| same, leads off | `contour/closed` × 4 | 2 | 0 | 2 (2 seams named "No registration hole fits", 2 "Only one") |
| same, 5° ramp, leads off | `path3d/open+ramp` × 5 | 2 | 0 | 2 (same 4 seam lines) |
| Disc Ø320, 12 mm | `path3d/open` × 5 | 8 | **5** (3.61–127.3 mm inside) | 3 |
| Frame 400 × 300 + window, 6 mm | `path3d/open` × 6 | 8 | **2 in the rim**, 3.91 mm inside the outer edge | 6 (4 in the window slug) |
| Two panels, 20 mm lane, 6 mm | `path3d/open` × 6 | 8 | **2** (3.83 and 6.83 mm inside) | 6 |

- **Cause.** The bores in the G-code equal `plannedTileRegistration` (Preview) in every case, so the placement is the cause, not the tiled emitter. READ confirms the mechanism the auditor named: `isLoop` counts only `closed` passes and ramped `path3d` passes, and a default-lead profile is neither.
- **The listing is worse than silent.** The tile advisory begins "Registration holes, Ø3.18 mm, at stock X, Y (and tile X, Y). Each is clear of every part and cut and inside the stock: r1-c1 (308.41, 123.91 …". That bore is 3.91 mm inside the tabletop. So the one place that lists the bores tells the operator they are clear.
- **Severity.** P1 under METHOD §3: a through bore in a finished part, and the only text says the opposite. In the leads-off twin the same seams correctly get no bore and a named warning.
- **Fix direction** (as the auditor's, plus the advisory). Mark a profile ring as a loop whatever its lead or ramp, using provenance from the profile compiler rather than the pass shape. Add a default-lead Outside part to `tile-registration-placement` tests, and a check that each listed bore lies outside every part.

**N7-P1-2: CONFIRMED, P1, with one anchor correction.**

| Gap (drawn) | ⅛" On path, Tabs on | ⅛" Outside, Tabs on | Tabs off |
| --- | --- | --- | --- |
| 2.5 / 3.10 / 3.17 mm (< D) | 5 floor pieces (4 tabs), "ends closer to its start than the 3.2 mm cut width" | same | "cuts through … with no holding tabs" |
| **3.18 / 3.20 / 3.25 / 3.30 mm** | **1 floor piece, no tab; Job Review silent; sliver 0.005 / 0.025 / 0.075 / 0.125 mm** (bracket; circle 0.05–0.17) | same cut, no hold warning; only the preflight notice `cnc-profile-open-path-on-line` ("A part it outlines comes out 3.17 mm smaller … Close the outline with Tools > Join paths") | same "no holding tabs" line |
| 3.4 / 3.6 / 4.0 mm | silent; sliver 0.23 / 0.43 / 0.83 mm | as above | as above |
| ¼": 6.36 / 6.40 / 6.50 mm | silent; sliver **0.010** / 0.050 / 0.150 mm (bracket) | open-path notice only | "no holding tabs" |

- **Anchor correction.** The Tabs-off line comes from `throughCutWarning` (`cnc-through-cut-tab-warnings.ts:146-163`). It fires for any profile layer cut through with Tabs off, whatever the geometry, and would fire for a straight line. It shows inconsistency, not that the app judges a 0.025 mm sliver free. The stronger anchor is physical. The sliver is far smaller than an ordinary router's runout and deflection (a few hundredths of a millimetre on an ER11 hobby spindle), so at 3.18–3.25 mm on ⅛" (≤ 0.08 mm of wall) the bit's real cut width removes it. The part is then cut fully free with no tab and no warning, which is the N1-P2-2 hazard. Above about D + 0.2 mm a sliver probably stands until the last pass, though far weaker than one tab (12 mm²).
- **Severity.** P1 stands for the narrow window. The On path layer is fully silent, and the Outside variant's only text is about size. A Join paths nudge is not a warning that the part comes free.
- **Threshold.**
  - Minimum: treat `gap < D + 0.2 mm` (the codebase's `THIN_POCKET_FLOOR_MM`, and above typical runout) as closed and tab it.
  - Better: tab the outline whenever the sliver's section (gap − D) × cut depth is less than one tab's (tab width × tab height), for example under D + 1.9 mm for 6 × 2 mm tabs in 6.35 mm stock. Name the sliver width in the hold warning in between.
  - Either way, make the Tabs-off line say the same.

**N7-P2-1: CONFIRMED, P2. Worse for the V-bit than the auditor reports.** The note on these programs reads "… cuts it first in 2 step-down levels of one depth per pass, at the finishing feed, before its finishing pass" (`out/relief-note.txt`). Measured with my stock model, dpp 1.5 mm. Each cell is mm of lateral finishing path with more than 1.55 mm over the tip / with more than 2.0 mm / the peak:

| Surface | 60° V-bit `vb-60-3175` (before → after #1878) | 30° engraver, 0.3 flat | 1 mm-tip tapered ball |
| --- | --- | --- | --- |
| Pyramid 40° (N2r formula) | 99.7 / 9.3 / 2.42 → **99.5 / 9.1 / 2.42** | 121.5 / 51.3 / 2.71 → **96.5 / 28.3 / 2.64** | 24.7 / 24.7 / 2.77 → 0 / 0 / 1.50 |
| Cone 50° (own) | 49.6 / 11.9 / 2.98 → **49.5 / 11.8 / 2.98** | 55.0 / 18.8 / 4.67 → 27.9 / 6.5 / 2.72 | 26.7 / 26.7 / 2.81 → 0 / 0 / 1.50 |
| Ridge 35° (own) | 71.4 / 61.0 / 2.80 → **68.5 / 59.9 / 2.80** | 147.4 / 73.5 / 3.00 → **101.3 / 26.1 / 2.72** | 62.2 / 40.6 / 2.29 → 24.1 / 0 / 1.62 |
| Ellipse (N2r formula) | 14.3 / 6.6 / 3.21 → 12.2 / 6.1 / 2.50 | 29.7 / 15.2 / 4.00 → 5.8 / 0.8 / 2.16 | 20.4 / 12.1 / 2.68 → **7.5 / 2.8 / 2.87** |

- **The V-bit is unchanged.** My pyramid length (99.5 mm, longest run 13.5 mm) matches the auditor's 106.8 / 13.5 mm. My peak is lower (2.42 against 3.12) because my lag measure differs. The before-tree, however, shows no improvement at all for the V-bit on any of the four surfaces. The auditor's "3.87 → 3.12" improvement does not reproduce on my model: N2-P2-1 is open for the V-bit. #1878 changed the program (finishing path 445 → 550 mm on the pyramid) but not where the tip overloads.
- **Engraver:** partly better. **Tapered ball:** fixed on the pyramid and cone, nearly on the ridge (1.62 sits within grid slack). On the ellipse's curved edge band it is **not** fixed: 7.5 mm over a pass, 2.8 mm of it over 2.0 mm, and a peak higher than before. The Headline's "Tapered balls are fixed" should read "fixed on planar slopes"; the auditor's own table already carries the ellipse row.
- **Severity P2 stands.** The peaks are 1.6–2.0× a pass at F1000 on a 3.175 mm-shank finishing bit, in runs of up to 26 mm (ridge). Nothing is gouged, and the surface is left right.

**N7-P3-1: CONFIRMED, P3.** Inside holes in a plate, Tabs on, through 6.35 mm (`out/holes.txt`):

| Shape | Floor pieces | Claim ("as little as") | Own floor neck (chord − D) |
| --- | --- | --- | --- |
| Ø8, ⅛" | 1 | 0 mm | 1.38 |
| Ø9, ⅛" | 1 | 0.9 | 2.64 |
| Ø10, ⅛" | 2 | 2.2 | 3.47 |
| 9 mm square, ⅛" | 2 | 2 | 3.54 |
| Ø16, ¼" | 2 | 1.4 | 2.89 |
| Ø12, Ø16 ⅛"; Ø20 ¼" | 2 / 4 / 3 | none | 4.43 / 5.23 / 4.38 |

- **Why the claim is low.** `bridgeAcross` also measures to cut points beyond the window, and on a short loop those lie across the hole's own slug. Such a cut separates only a cap of the slug, not the slug from the board.
- **Advice.** The full Ø10 text: "…hold by as little as 2.2 mm of the 6 mm set, because the outline turns inside the tab. Drag those tabs to straighter edges with Edit positions, or use narrower tabs." On a circle that advice cannot be followed.
- **Severity.** P3. On Ø8 the true neck (1.38 mm) is genuinely weak, so the warning points the right way there, though the number is wrong.

**N7-P3-2: CONFIRMED, wider, P3.** The plain 1 mm ball's peak over the tip rose on three of my four surfaces:
- cone50: 1.50 → **2.23**, 3.1 mm over 1.55;
- ridge35: 1.62 → **2.63**, 24.8 mm over 1.55, 0.1 mm over 2.0;
- ellipse: 1.62 → **2.56**, 5.4 mm, 0.3 mm over 2.0;
- pyramid: 1.50 → 1.62.

Every stretch over 2.0 mm is ≤ 0.4 mm long, so it stays P3. The fix direction is as the auditor's, with the cone and ridge as extra cases.

**N7-P3-3: CONFIRMED, P3** (READ). It is unchanged on `j40`: `spindleRpm: Math.min(inputs.spindleRpm ?? spindleMaxRpm, spindleMaxRpm)`, and the feed is capped only to Max feed.

**#1897, FS-2 option A, on the Neotronics 4040 profile** (`NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE`, `out/fs2.txt`):
- **Starter.** Seed F300, plunge 250, **S3000**, dpp 0.75, revision 3. The emitted program is `S3000 F300`, 0.050 mm/tooth, with no Job Review warning.
- **Recipes (S and F read from the emitted program).** The feed stays at **300 everywhere**. RPM is lowered to the chart (⅛": hardwood S3750, aluminium S7500; 1/16": S4750–7150, at 100 % of the chart) and floored at **3,000** (⅛" plywood: 83 % of chart; ¼"/⅜": all at S3000). The 1/16" aluminium recipe is not feed-capped (S12000 F250).
- **Regression side.** For the default profile, 130 of 130 recipe rows (5 cutters × 5 materials × 2 start RPMs; 260 rows across both profiles) are identical between `j39` and `j40`. On the 4040, only S changed (124 rows), always downward; F, plunge, dpp and source are identical.
- **The low-chip-load warning at the floor: confirmed, consistent and acceptable.**
  - ¼" plywood and softwood: 0.050 mm/tooth = **45 %** of 0.11 → the FS-2 warning fires.
  - ¼" hardwood and acrylic: exactly 50 % → silent.
  - ⅜" (`em-9525`): 33–40 % → warns.
  - The warning is true: 300 mm/min at the spindle's 3,000 RPM floor cannot reach the chart for a ¼" or larger two-flute bit. The maintainer chose the 300 cap and the floor, so the residual is the decision's known consequence and is disclosed.
  - Its advice is half wrong on this machine (N7r-P3-1).
- **Not verified.** Whether the fitted 500 W spindle really holds 3,000 RPM under load (`supports: '3,000-12,000 RPM range …'` is the catalogue's claim; no live source was fetched). Whether the 4040's `$31` lets `S3000` drive it there.

**#1898 and N6-P2-1: correct** (`out/cap.txt`).

| Case | Sent | Warning numbers |
| --- | --- | --- |
| 1/16" S24000 F1500 P400 on a 9,000 max | `S9000`, cutting F562, plunge F150 (= 1500·0.375, 400·0.375) | "sends S9000 and lowers its feed from 1500 to 562 mm/min and plunge from 400 to 150" |
| ⅛" hand-set S18000 F1800 P500 on 10,000 | `S10000`, F1000, P277 | matching |
| Drill S12000 on 6,000 | P300 → 150 | the warning names only the plunge, correctly |

Each warning ends "KerfDesk sends the S value only; actual spindle RPM is not measured." The program carries `; cnc spindle-capped: requested-rpm …`. Uncapped ¼" S12000 on 12,000 has no comment and no line.

### New findings

**N7r-P3-1: On the 4040, the low-chip-load warning tells the operator to lower the spindle speed when it already sits at the spindle's 3,000 RPM floor.**
- **Where:** `src/ui/laser/cnc-cut-guide-warnings.ts:78-91` (`lowChipload`), with `cnc-machine-starter-catalog.ts` `spindleMinRpm: 3_000`.
- **Anchor:** ADR-256 Amd 1 (#1897) gives the starter a spindle minimum, and the resolver refuses to plan below it (`rpmForFeedCeiling`). The warning ends "raise the feed, or lower the spindle speed, until it is nearer the chart".
- **Evidence (REPRO, `out/fs2.txt`):** ¼" plywood/softwood and every ⅜" recipe on the 4040 profile are sent at S3000 F300 and warn. The recipe chose 3,000 because it is the floor. Going lower runs the spindle below its rated range; raising the feed breaks the starter's 300 mm/min cap, the maintainer's decision.
- **Scenario:** a 4040 owner with a ¼" bit and a plywood recipe reads the advice, types 1,500 RPM, and the spindle bogs or stalls in the cut. A hand-typed S below the floor gets no warning (`hand-typed S1500 … review (none)`).
- **Severity:** P3 (wrong advice on a true warning, like N5-P3-1).
- **Announced?** No. **Novelty:** new (#1897).
- **Fix direction:** when the group's feed source is a starter with `spindleMinRpm` and the sent S is at that floor, drop "lower the spindle speed". Say instead that a smaller bit or a higher feed than the starter's cap is needed. Optionally warn when a sent S is below a known `spindleMinRpm`.

**N7r-P3-2: Two recipe paths still treat a lowered 3,000 RPM as hand-set, so the lowered speed sticks to the next bit's recipe.**
- **Where:** `src/ui/layers/CncKeptFeedsNotice.tsx:78-87` (the "Use <material> values" button after a bit change) and `src/ui/layers/CncStageRecipeFields.tsx:71-80` (a stage recipe's material starter). Both call `materialFeedsPatch` without `automaticSpindleRpm`, unlike the six callers #1897 updated.
- **Anchor:** #1897's own test, "plans from full speed on a starter-seeded layer, so a lowered RPM does not stick" (`cnc-4040-feed-cap-rpm.test.ts`), and the ADR-256 Amd 1 comment in `resolve-cnc-auto-settings.ts` ("a speed it lowered for one material never holds down the next").
- **Evidence (REPRO, `out/fs2.txt`, the same call with and without the flag, operation RPM 3,000):**

  | Bit and material | As hand-set (these two paths) | As automatic (material picker) |
  | --- | --- | --- |
  | 1/16" plywood | S3000 **F190** | S4750 F300 |
  | 1/16" hardwood | S3000 **F130** | S7150 F300 |
  | 1/16" aluminium | S3000 **F60** | S12000 F250 |
  | ⅛" aluminium | S3000 F120 | S7500 F300 |

- **Scenario:** a starter-seeded 4040 layer (S3000), bit changed to 1/16", "Use Plywood values" → the bit runs 37–75 % slower than the same recipe chosen from the Material picker. The chip load stays at the chart, so nothing breaks.
- **Severity:** P3 (two buttons give different recipes for the same bit and material, against the PR's stated rule; no harm to the cut).
- **Announced?** No. **Novelty:** new (#1897).
- **Fix direction:** pass `automaticSpindleRpm: settings.feedSource !== undefined` in both callers, as `FeedsCalculatorRow` does, and add the bit-change path to `cnc-4040-feed-cap-rpm.test.ts`.

### Probes with no gap

- **Corner tabs** (`out/spot.txt`): 50 mm square, ¼" 60 mm square, 90 × 40 rectangle, 70 mm triangle and an 80 × 60 L, each through 6.35 mm. Each has 4 floor pieces, every floor bridge **6.00 mm**, tab tops Z−4.35. The N1-P2-1 fix holds on my shapes.
- **Small holes cut through:** Ø10 / Ø12 / Ø16 (⅛") and Ø16 / Ø20 (¼") reach Z−6.35 with 2 / 2 / 4 / 2 / 3 tabs. Ø8 and Ø9 get one tab each (J1-P1-1 fix holds).
- **Through pocket with islands:** offset, adaptive and raster X each name "round 2 islands (15 × 20 mm and 16 × 16 mm)" and offer a 5.85 mm depth (N3-P1-1 fix holds).
- **6.35 counts as set:**
  - marked: a 3 mm groove skips its tabs with the "3.4 mm floor" line; a 7 mm Outside puts its tab tops at Z−4.35.
  - unmarked: tab tops at Z−1.00 and Z−5.00, as before.

  Behaviour matches ADR-258 Amd 6.
- **Slot refusal at 50 %** (`out/adapt.txt`): the 44 × 30 rectangle, a 44 × 16 L and my 60 × 22 rectangle fall back to offset rings with the ADR's notice. The 32 mm square and my 40 mm octagon stay adaptive at 1.5875 mm. The long pockets also fall back at 0.3175 mm, as before #1891 (by the limit).
- **Registration, leads off or ramped:** every bore is in the waste, and the four blocked seams are named. Ramped profiles (`path3d+ramp`) count as loops, as the code says.
- **#1897 regression:** default-profile recipes are byte-identical; the 4040 changes RPM only, never upward.
- **Recovery (#1893):** not re-run. The `j39 → j40` diff touches no recovery file (`cnc-recovery-work-z.ts`, `work-z-before-reset.ts` and `abort-auto-restore.ts` unchanged), so the auditor's GRBL-simulator verdicts on `j39` carry over. On READ, `cncRecoveryWorkZ` / `cncRecoveryWorkZIssue` / `cncRetainedWorkZIssue` refuse both paths for `cleared-by-reset`, and for `unrecorded` after a bit change, as the ADR-215 Amd 3 table says.

### Not verified

- **Recovery on the simulator:** not re-run (see above). grblHAL kept-G92 rests on the auditor's READ.
- **Relief edge-band levels:** the reason the V-bit levels do not cover its descent (the auditor's "likely cause" stays READ, not proven). The bit-to-program peak difference between my model (2.42) and the N2r sweep (3.12) on the pyramid V-bit (lag versus sweep measure).
- **Physical strength:**
  - slivers above about 0.2 mm (N7-P1-2's upper edge);
  - small-hole necks;
  - whether a 500 W 4040 spindle holds 3,000 RPM in a ¼" cut.
- **The rendered UI:** Preview's drawn bores were compared through `plannedTileRegistration`, not rendered. The Kept-feeds and Stage-recipe buttons were driven through `materialFeedsPatch` with the arguments those components pass, not clicked.

### Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-n7r\`. Run each with `node --no-experimental-webstorage --import ./register.mjs <file> [args]`. Outputs go to `out\`. Nothing in the repo, `j40-main` or any other export was touched.

| File | Covers | Output |
| --- | --- | --- |
| `x-build.ts` | Own builder (Save path, Job Review) and own G-code reader | — |
| `x-reg.ts` (`ONLY=<prefix>` env) | N7-P1-1: bores vs parts and holes, 7 jobs, Preview cross-check, advisories | `out/reg.txt` |
| `x-open.ts`, `x-open1.ts` | N7-P1-2: open circle and bracket, ⅛" and ¼", On path / Outside, Tabs on/off; sliver from the floor | `out/open.txt` |
| `x-relief.ts [bits] [surfaces] [tag]`, `x-relief38.ts` (same on `j38-main`) | N7-P2-1, N7-P3-2: own stock model; `FULL=1` prints whole notes | `out/relief-all.txt`, `out/relief-j38.txt`, `out/relief-note.txt`, `out/relief*-*.nc` (`out/relief-t1.txt` is a superseded run without the carving lag) |
| `x-holes.ts` | N7-P3-1: claim vs floor neck | `out/holes.txt` |
| `x-fs2.ts` | #1897 on the 4040: seed, 25-recipe matrix, hand-set vs automatic RPM, below-floor S; N7r-P3-1, N7r-P3-2 | `out/fs2.txt` |
| `x-recipes.ts` (`TREE`, `TAG` env), `x-cmp.cjs` | #1897 regression: 260 recipe rows on `j39` vs `j40` | `out/recipes-j39.txt`, `out/recipes-j40.txt` |
| `x-cap.ts` | #1894 / #1898 capped spindle: S, F, plunge vs the warning | `out/cap.txt` |
| `x-spot.ts`, `x-adapt.ts` | Corner tabs, through-pocket islands, 6.35 mark, slot refusal | `out/spot.txt`, `out/adapt.txt` |

Refuter counts: raised 8, refuted 0, P1 2, P2 1, P3 5, known 22. That is the auditor's 6, all confirmed, plus 2 new P3s from #1897 (N7r-P3-1, N7r-P3-2). Known: the auditor's 19 statused P1/P2s and 3 decisions. N7-P1-1, N7-P1-2 and N7-P2-1 are residuals of KNOWN N4-P1-1 / AC-5, N1-P2-2 and N2-P2-1. Status changes: N2-P2-1 is **not fixed for the 60° V-bit** (unchanged by #1878 on my model), and the 1 mm-tip tapered ball is fixed only on planar slopes.
