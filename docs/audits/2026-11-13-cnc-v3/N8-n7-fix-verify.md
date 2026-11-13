# N8 — N7 fix verification (CNC audit v3, `n7-fix-verify`)

## Question

Do #1901 (ADR-392 Amd 8, N7-P1-1), #1903 (ADR-258 Amd 7, N7-P1-2 and N7-P3-1) and #1904 (ADR-421 Amd 5, N7-P2-1 and N7-P3-2) do what they claim? I measured this from the emitted programs. I also checked whether any of them changed something that held before.

## Tree

- **After:** read-only export `j41-main` = `origin/main` @ `2e653bf66` (#1904 merge, newest on main).
- **Before:** `git archive` of `src` + `public` for each merge's first parent, each with a `node_modules` junction:
  - `zz-n8\t-pre1901` = `446e9cdbc` (before #1901);
  - `zz-n8\t-pre1903` = `13339bf7c` (#1901 in, #1903 not);
  - `zz-n8\t-pre1904` = `71f7b88bc` (#1903 and #1902 in, #1904 not).
- Each pre tree differs from the after tree only by the PRs merged after it:
  - `t-pre1901` lacks #1901, #1903, #1902 and #1904. Its CNC registration and tiling files differ from after only by #1901.
  - `t-pre1903` lacks #1903 and the two later merges. Its tab files differ only by #1903.
  - `t-pre1904` lacks only #1904.
  - #1902 (zero-area retrace kerf) touches `core/job`, `geometry` and DXF join. It precedes `t-pre1904`, so the relief comparison isolates #1904.
- **Harness:** `zz-n8\register-v.mjs` / `ts-resolve-v.mjs` is the N8 loader. It remaps every `…\j41-main\…` import to the tree named by `TREE`, so one script runs unchanged on every tree. `zz-n8\v\run.sh <dir> <script> <after|pre1901|pre1903|pre1904>` writes to `out\<tag>\`.

## Method

- **Re-runs.** The prior scripts were copied into `zz-n8\v\` and re-pointed with the loader:
  - N7 refuter `x-*` → `v\n7r`;
  - N4r registration `r-reg*` → `v\n4r`;
  - N1 and N1r tab suites, incl. the N7 auditor's `n7-small`, `n7-free`, `n7-open`, `n7-transform` → `v\n1`, `v\n1r`;
  - N2r relief sweep `r-p21` → `v\n2r`.

  Each was run on the after tree and the relevant before tree, one Node process at a time (`--max-old-space-size=500`).
- **New probes (mine):**
  - `v\n8\v-reg.ts`: 10 shapes × 16 variants (arc / line / r6-90° / no lead × ramp 0 / 5° × Tabs on / off) plus 4 extras (8 tabs, 0.5 mm allowance, conventional, 20 mm tabs) on three shapes; 172 jobs per tree. For every planned bore (Preview = G-code, cross-checked by `x-reg`) it records: point in part (minus holes), distance to every toolpath of the job against the advisory's "cutter radius + hole radius + 2 mm", and whether the bore is on the stock. It also hashes the untiled program.
  - `v\n8\v-reg-open.ts`: a part drawn as an open outline under tiling, and a self-crossing engraved stroke.
  - `v\n8\v-gap.ts`: gap sweep D − 0.5 … D + 3 mm in 0.1 mm steps, plus D + 0.005, D + 1.85, D + 1.93 and 6 mm. It covers ⅛" and ¼", rectangle and circle, On path / Outside / Inside, Tabs on (and off for On path); 642 programs. Measures from the program:
    - floor pieces at full depth;
    - sliver = bit-centre end gap at the floor − D;
    - tab necks = chord between facing floor-piece ends − D;
    - tab over the gap;
    - Job Review kind.
  - `v\n1\v-shift.ts`, `v-shift2.ts`, `v-shift3.ts`: open triangle / L / hexagon / star / 30° wedge / square / rectangle, gap 1 or 4.5 mm at a vertex or mid-edge, tab widths 1–6 mm. Bridges are read by the N1 reader's through-cut component analysis.
  - `v\n7r\v-relief.ts`: the refuter's lagged stock model on 7 surfaces (pyramid 40°, cone 50°, ridge 35°, ellipse dome, raised dome, 45° ramp, 10° ramp) × 7 bits (60° V-bit, 30° engraver, 1 mm-tip tapered ball, plain 1 mm ball, 1/16" ball, ⅛" ball, 1/16" flat). It hashes the programs.
  - `v\n7r\v-relief-grid.ts` + `v-gridcmp.cjs`: the final carved stock compared cell by cell between trees (new over-depth check).
- **Vitest:** only the bonus. `zz-n8\v-vitest.mjs` + `vitest.n8.config.mts` run an explicit file list from `j41-main`, with the cache in `zz-n8\.vite-n8` and free RAM ≥ 1.5 GB (2.29–2.37 GB at each run).
- No hardware, browser, pnpm, build, live service or PR was touched. Nothing in the repo or `j41-main` was edited.

## Headline

All three fixes do what their PRs claim on the cases they name. Registration bores no longer land in parts with any lead, ramp or tab setting:
- 1,149 bores, 0 in a part, 0 nearer a toolpath than the advisory says, 0 off the stock; before #1901, 305 of 1,453 were in a part.
- Untiled programs are byte-identical.

Open outlines are tabbed exactly while gap < D + 1.89 mm (default tabs, 6.35 mm), with the warning. 205 of 205 closed-outline N1r programs and 97 of 98 N1 programs are byte-identical; the one difference is an intended open-outline case. The small-hole "0 mm" claims are gone, and acute wedges are still named.

On the lagged model, no relief finishing move meets more than 1.50 mm under the tip on 49 surface/bit pairs. Before, there were up to 128 mm of path over one pass. The final carved surfaces match before #1904 to within 0.04 mm.

Four new findings:
1. **N8-P1-1 (pre-existing, not a regression).** A part drawn as an open outline gets registration bores drilled through it. This includes an outline that the tab code itself treats as closed: Job Review says "the cut frees it like a closed shape". On a 600 × 300 panel, 11 of 14 bores land in the part, while that panel's own Job Review line says it is tabbed as a closed shape. The new advisory's generic sentence ("A part drawn as an open outline is not known as a part") names neither the outline nor the bores.
2. **N8-P2-1 (regression from #1903).** `planClearOfGap` shifts all of an open outline's tabs together. On a square or L open at mid-edge it moves every tab onto a corner:
   - default 6 mm tabs: bridges 5.95–6.0 → **3.27 mm**, silent;
   - narrower tabs: 1.86 / 1.15 / 0.44 / 0.09 mm, warned;
   - 1 mm tabs: the part is **cut free**, warned "as little as 0 mm".

   This brings N1-P2-1's corner-tab symptom back for these outlines.
3. **N8-P3-1 (#1904).** Every relief finishing program got 1–31 % longer, including bits that were already within one pass. The ⅛" ball on the pyramid and cone gets a new step-down level and a note that "the roughing bit leaves more than one depth per pass under the … finishing bit's path". The lagged model never measured more than 0.60 / 0.79 mm there.
4. **N8-P3-2 (#1904).** On the N7 auditor's own row measure (N2r sweep), short over-one-pass stretches remain:
   - V-bit on the pyramid: 8.8 mm, max 1.98, longest 0.65 mm;
   - V-bit on the ellipse: 1.5 mm, max 2.33;
   - new for the 1/16" ball (0.97 mm at 2.40) and the plain 1 mm ball (0.32 mm at 2.43), where a level row runs onto the surface.

   ADR-421 Amd 5 claims no lateral move over 1.6 mm.

## Fix tables

### #1901 (ADR-392 Amd 8): registration bores and default lead-in

| Case | Before (`t-pre1901`) | After (`j41`) | Verdict |
|---|---|---|---|
| N4r R3 panel 600 × 300 × 12, 3 × 2 (`r-reg`, default leads) | 14 bores, **11 in the part** | 3 bores, 0 in part, waste; other seams named | **fixed** |
| R3 Tabs off (`r-reg-notabs`) | 11 in part | 0 | fixed |
| R2 eight Ø90 coasters | 1 in coaster 6 | 2 in waste | fixed |
| R1 sign, R4 pocket-first | 0 / 0 | 0 / 0 | unchanged |
| Leads off (`r-reg-noleads`) | 0 in part | 0 in part | unchanged |
| N7r tabletop 520 × 260 r25 (default / leads off / ramp 5° / Tabs off) | 6 / 0 / 0 / 6 in part | 0 / 0 / 0 / 0; 2 bores, 2 seams "No registration hole fits", 2 "Only one" | fixed |
| N7r disc Ø320 | 5 in part | 0; 3 bores in waste | fixed |
| N7r frame 400 × 300 rim (window Inside) | 2 in the rim, 4 in the window slug | 0 in rim, 0 in slug; 2 bores in waste, 4 seams named | fixed (the loose slug is no longer drilled) |
| N7r two panels, 20 mm waste lane | 2 in parts | 8 bores, all in the lane, 6.83–9.17 mm from a part | fixed |
| `v-reg` matrix, 10 shapes × arc / line / r6-90° / none × ramp × tabs (+ extras) | 1,453 bores, **305 in a part** (47 jobs) | 1,149 bores, **0 in a part, 0 nearer than R + r + 2, 0 off stock**; min margin over the claim +0.06 mm (conventional) / +0.15 mm | **fixed** for every lead / ramp / tab setting |
| Variant consistency (after) | default-lead jobs ≠ leads-off jobs | panel, tabletop, L, star, on-path, inside-hole: one bore set for all 16 variants. Others differ only where a longer lead arc blocks a spot (e.g. coasters r6-90° no tabs: one seam gets one bore, named) | consistent |
| Advisory text | "Each is clear of every part and cut" | "placed at least the cutter's radius, the hole's radius and 2 mm from every toolpath, outside every outline the toolpaths go round, and on the stock. A part drawn as an open outline is not known as a part." Preview: "clear of every toolpath, outside every outline…" | **true** for closed outlines (measured). The open-outline caveat is true but see N8-P1-1 |

### #1903 (ADR-258 Amd 7): open-outline gap, tab shift and bridge measure

| Case | Before (`t-pre1903`) | After | Verdict |
|---|---|---|---|
| N7 auditor `n7-open` 80 × 60, gap 3.2 / 3.3 / 3.6 / 4.5 mm, ⅛" On path and Outside | 1 floor piece, no tab, silent | 4 tabs + sliver, closed-gap warning, part held | **fixed** |
| N7r `x-open` circle / bracket, ⅛" 3.18–4.0 mm and ¼" 6.36–6.6 mm | silent, sliver 0.005–0.83 mm | tabbed and warned | fixed |
| `v-gap` 642 programs, both bits, rectangle / circle, On path / Outside / Inside | — | Tabbed **exactly** when gap < D + 1.89 mm: ⅛" through 5.025, ¼" through 8.200. D + 1.90 untabbed, sliver 1.90 mm = 12.07 mm² ≥ one tab (12 mm²). Necks of every tab 5.93–6.00 mm. **No tab over the gap** (0 of 642). Every tabbed row warns `closed-gap`; untabbed rows are silent with ≥ 12.07 mm² of sliver | **as specified** |
| 6 mm gap, ⅛" | untabbed | untabbed: sliver 2.825 mm, 17.9 mm² | correct |
| 6 mm gap, ¼" (< D) | tabbed | tabbed, warned | correct |
| Tabs off | "cuts through … with no holding tabs" | same line at every gap | unchanged (geometry-blind line, as N7r noted) |
| N7-P3-1 hold claims (`x-holes`, `n7-small`, `n7-free`, `r-j1`, `r-leads3`) | Ø8 "0 mm", Ø9 0.9, Ø10 2.2, 9 mm square 2, ¼" Ø16 1.4, ¼" Ø12/14 "0 mm", Ø2 part 0.1, Ø10 lead 2.2 | No narrow-bridge claim on any of them. They keep the "too small for 4 tabs … gets N tabs" line. Measured necks 2.9–3.7 mm. No freed piece in 13 `n7-free` programs | **fixed** |
| Acute wedge (`n1-corners2`) | 30°: "1 mm", 20°: "0.6 mm" | same claims; measured 1.00 / 0.65 | still named |
| Closed-gap warning text | "ends closer to its start than the 3.2 mm cut width, so the bit cuts it free" | "ends so close to its start that the 3.2 mm cut leaves less across the gap than a tab holds, so the cut frees it like a closed shape. It is given holding tabs as closed shapes; close it with Tools > Join paths to edit its tabs." | true across the sweep |

### #1904 (ADR-421 Amd 5): stock under the tip (lagged model, dpp 1.5)

Each cell gives mm of finishing path with more than 1.55 mm over the tip / longest run / peak.

| Surface | 60° V-bit before → after | 30° engraver | 1 mm-tip tapered ball | plain 1 mm ball |
|---|---|---|---|---|
| pyramid 40° | 99.5 / 13.5 / 2.42 → **0 / 0 / 1.50** | 96.5 / 13.4 / 2.64 → **0 / 0 / 1.50** | 0 / 0 / 1.50 → 0 / 0 / 1.50 | 0.6 / 0.6 / 1.62 → **0 / 0 / 1.50** |
| ellipse dome | 12.2 / 2.9 / 2.50 → **0 / 0 / 1.50** | 5.8 / 1.1 / 2.16 → 0 / 0 / 1.50 | 7.5 / 3.8 / 2.87 → **0 / 0 / 1.50** | 5.4 / 1.6 / 2.56 → **0 / 0 / 1.50** |
| raised dome (own) | 15.3 / 2.1 / 2.50 → 0 / 0 / 1.50 | 6.4 / 2.6 / 3.00 → 0 / 0 / 1.50 | 5.1 / 4.7 / 2.60 → 0 / 0 / 1.50 | 3.0 / 2.0 / 2.09 → 0 / 0 / 1.50 |
| 45° ramp (own) | 28.5 / 1.3 / 2.73 → 0 / 0 / 1.50 | 26.9 / 1.2 / 2.65 → 0 / 0 / 1.50 | 0.9 / 0.4 / 1.62 → 0 / 0 / 1.50 | 0.8 / 0.4 / 1.96 → 0 / 0 / 1.50 |
| 10° ramp (own) | 128.3 / 3.7 / 2.21 → 0 / 0 / 1.50 | 129.2 / 3.8 / 2.19 → 0 / 0 / 1.50 | 6.6 / 3.7 / 2.19 → 0 / 0 / 1.50 | 3.7 / 3.7 / 2.21 → 0 / 0 / 1.50 |
| cone 50°, ridge 35° (N7r) | 49.5 / 2.98, 68.5 / 2.80 → 0 / 1.50 | 27.9 / 2.72, 101.3 / 2.72 → 0 / 1.50 | 0 / 1.50, 24.1 / 1.62 → 0 / 1.50 | 3.1 / 2.23, 24.8 / 2.63 → 0 / 1.50 |

- **Other bits.** 1/16" ball, ⅛" ball and 1/16" flat: every after cell is 0 / 0 / 1.50. Before they had up to 14 mm at 2.41 (10° ramp).
- **The notes.**
  - V-bit pyramid: "…cannot reach about 21 mm² … The 3.175 mm V-bit finishing bit cuts it first in 2 step-down levels of one depth per pass, at the finishing feed, before its finishing pass. A smaller roughing bit clears it faster." True on this model.
  - New path-only note (⅛" ball pyramid): "the 3.175 mm roughing bit leaves more than one depth per pass under the 3.175 mm finishing bit's path in places. The finishing bit cuts that first in 1 step-down level…". See N8-P3-1.

**Second measure (N2r row sweep, 0.04 mm grid; the N7 auditor's).** Each cell gives mm over 1.55 / peak, before → after.

| Case | Before → after |
|---|---|
| Pyramid V-bit | 106.8 / 3.12 → **8.8 / 1.98** (longest 0.65) |
| Pyramid engraver | 100.2 / 2.74 → 0.98 / 2.01 |
| Ellipse V-bit | 18.1 / 2.56 → 1.5 / 2.33 |
| Ellipse tapered ball | 7.6 / 2.96 → **0 / 1.50** |
| Ellipse 1 mm ball | 6.2 / 2.88 → **0 / 1.50** |
| 0.5 mm-tip tapered ball | 9.2 / 1.66 → 0 / 1.50 |

New on this measure: pyramid 1/16" ball 0 → 0.97 / 2.40, and 1 mm ball peak 1.62 → 2.43 over 0.32 mm (N8-P3-2).

## Regression tables

### #1901

| Check | Result |
|---|---|
| Untiled programs (172 jobs of the matrix) | **byte-identical** (`untiled-hashes.txt`, `cmp` equal) |
| Bores refused where they fit before | Waste bores that moved or vanished: 90; new bores: 115. Every seam that lost bores is now named. Each after-set equals the leads-off set of the same shape on both trees (pre-#1901 leads-off was already right), so nothing is refused that the leads-off rule did not already refuse |
| Bores now in the frame's window slug | 4 → 0 (the slug is loose waste; an improvement) |
| Self-crossing engraved stroke (vertex revisited) beside a panel | no extra refusal (3 bores, same 7 seam lines as the panel alone) |
| Bores too close to a lead arc | 0 (min margin +0.06 mm over R + r + 2) |

### #1903

| Check | Result |
|---|---|
| Closed outlines, N1 suite (98 programs: sweep, corners, bridges, rects, seam, seed, J1, vcarve, open) | 97 byte-identical (comments stripped). Only `s-onpath-open-line` changed (an open outline: tabs shifted off its join; bridges still 6.0) |
| Closed outlines, N1r suite (214 programs) | 205 byte-identical. All 9 differences are open-outline cases (`n7o-*-g3.2…4.5` now tabbed; `open-onpath-gap0-tabs` tabs shifted) |
| Manual tabs under transforms (`n1-transform`, `n7-transform`) | identical output on both trees |
| Tab dropped? | none on closed outlines. Open outlines in the window gain 4 tabs |
| Narrower bridge? | **yes on open outlines open at mid-edge of a square or L (N8-P2-1)**. Triangle, hexagon, star, wedge and 80 × 60 rectangle keep 5.9–6.0 mm (star 4.0–4.1 as before) |
| Warnings removed | only the small-hole "as little as X mm" claims (intended). The wedge claims remain |

### #1904

| Check | Result |
|---|---|
| Programs where the bit was already fine | **all changed**. 49 of 49 programs differ; finishing path +1 % … +31 %. That includes tapered ball, 1/16" ball and 1/16" flat on pyramid / cone, which measured 0 mm over one pass before (N8-P3-1) |
| New over-depth | **none**: final carved stock vs before. 43 of 49 pairs identical cell for cell. 6 differ by ≤ 0.038 mm deeper in ≤ 1,051 of 230–475 k cells (V-bit / engraver / flat on cone, dome, ramp, pyramid, ridge), below one sampling step. No cell is more than 0.04 mm deeper |
| Material left | none more than 0.031 mm higher (engraver cone, ridge) |
| Feeds | step-down levels run at the finishing feed (F1000), as the note says |

## Findings

### N8-P1-1 — Registration bores are drilled through a part drawn as an open outline, even one the tab code treats as closed

- **Where:**
  - `src/core/cnc/tile-registration-placement.ts`: `addPassObstacles` / `ringsOf` find a ring only when the path returns to a vertex.
  - Contrast `src/core/cnc/cnc-open-outline-tabs.ts:53-60` `cutFreesOpenOutline`: the same job's tab compiler treats the outline as a closed loop.
- **Anchor:**
  - Job Review on the same job: "1 open outline (600 × 300 mm) ends so close to its start that the 3.2 mm cut leaves less across the gap than a tab holds, so the cut frees it like a closed shape. It is given holding tabs as closed shapes".
  - ADR-392 Amd 8 and the advisory: holes "outside every outline the toolpaths go round".
  - METHOD §3 G6: the app must name the specific mismatch to lower a P1.
- **Evidence (REPRO `v\n8\v-reg-open.ts`, `out\after\reg-open.txt`):** 600 × 300 panel drawn open, 6 mm, ⅛", tiles 250 × 200, overlap 20, default draft.

  | Gap | Tabs / Job Review | Bores | In the part |
  |---|---|---|---|
  | 2.5 mm (< D: the bit sweeps the gap) | tabbed; "frees it like a closed shape" | 14 | **11** (5.5–120 mm inside) |
  | 3.5, 4.5 mm (#1903 window) | tabbed; same line | 14 | **11** |
  | 6 mm | untabbed, silent | 14 | 11 |

  The same on Outside. `t-pre1901` gives the same 11. The only text is the advisory's generic "A part drawn as an open outline is not known as a part", attached to every registration listing. It names neither this outline nor that its bores are inside.
- **Scenario:** an imported or hand-drawn panel outline that stops short of its start, by less than the bit (always freed) or within #1903's window. It is cut through with tiling and registration on. Job Review says KerfDesk treats it as a closed shape, and 11 dowel bores go through the finished panel.
- **Severity:** **P1**: a through bore in a part, i.e. wrong physical output. The one related text is generic and conflicts with Job Review's own line. P2 considered, because the advisory does disclose open outlines as a class.
- **Announced?** Partly: the generic caveat, added by #1901. **Novelty:** new. It was not tested by N7 or N7r and is not a #1901 regression (same on `t-pre1901`).
- **Fix direction:** in `collectObstacles`, close any profile pass whose ends lie within `closedForTabsBelowMm` (or at least within the cut width) and add it as a loop. Better, carry the closed-for-tabs fact from the compiler. Otherwise, name each open outline that a bore lands inside.

### N8-P2-1 — #1903 moves every tab of an open outline onto the corners of a square or L (N1-P2-1 symptom back)

- **Where:** `src/core/cnc/cnc-open-outline-tabs.ts:66-91` `planClearOfGap`. When any window touches the gap, all centres shift by one `delta` so that the gap's middle sits halfway between two tabs. On a square (4 tabs, 60 mm apart, planned mid-edge), a gap at mid-edge shifts every tab by 30 mm, onto the corners. The corner-avoiding plan of ADR-258 Amd 5 is discarded.
- **Anchor:** ADR-258 Amd 5 (#1889) corner tabs fixed to 6.00 mm (N1-P2-1→P1). The same outline with its gap at a vertex keeps 5.95–6.00. The closed twin has 6.00.
- **Evidence (REPRO `v\n1\v-shift2.ts`, `v-shift3.ts`, N1 through-cut bridge reader; before = `t-pre1903`):**

  | Shape, gap 1 mm at mid-edge, ⅛", 6.35 through | Tab width | Before | After | Job Review after |
  |---|---|---|---|---|
  | square 60, Outside / On path | 6 (default) | 6.0, 5.95 × 3 | **3.27 × 4** | closed-gap only (no narrow-bridge: 3.27 ≥ W/2) |
  | L 80 × 80, Outside / On path | 6 | 5.95 × 4 | **3.27 × 4** | same |
  | square 60 | 4 / 3 / 2 / 1.5 | 3.95–4 / 2.95 / 1.95–2 / 1.45 | **1.86 / 1.15 / 0.44 / 0.09** | "as little as 1.9 / 1.2 / 0.5 / 0.1 mm" |
  | square 60 | 1 | 0.95 × 4, held | **1 piece: part cut free** | "as little as 0 mm" |
  | gap 4.5 mm mid-edge (now tabbed) | 6 | untabbed | 3.27 × 3 + sliver | closed-gap |
  | 80 × 60 rectangle, triangle, hexagon, wedge | 6 | 5.9–6.0 | 5.9–6.0 | — |
- **Scenario:** an open square or L-shaped part (e.g. an imported outline missing its last segment), cut with Tabs on as shipped. Each default tab holds 55 % of its set width with no warning. At narrow tab widths the part is weakened or cut free; there is a warning, but its advice, to drag the tabs, is unavailable for an open outline: "close it with Tools > Join paths to edit its tabs".
- **Severity:** **P2**. At the default the part is still held, silently weakened. Where it comes free, a warning names it. P1 considered (N1-P2-1 precedent: corner tabs at 3.31 mm, P1 because narrow widths freed parts silently; here the free case is warned).
- **Announced?** No. ADR-258 Amd 7 says the windows "shift together". **Novelty:** new, a regression of #1903 (the before tree holds at full width).
- **Fix direction:** shift only the windows that touch the gap, or re-run the Amd 5 corner-avoiding placement on the loop with the gap's arc excluded. Add an open square with a mid-edge gap to `compile-cnc-tab-gaps.test.ts`, with a 6.0 mm bridge expectation.

### N8-P3-1 — #1904 lengthens every relief finishing program, and adds a level and an "under the path" note where the ⅛" ball meets at most 0.6–0.8 mm

- **Where:** `src/core/relief/relief-finishing-step-down.ts:40-53` (`stockUnderTip` now runs for every row, even when no region was missed) and `src/ui/laser/cnc-relief-roughing-reach-warnings.ts:60-82` (`underTipWarnings`).
- **Anchor:** ADR-421 Amd 5 Consequences names only "terrace corners … with pointed bits" as the cost. The lagged model measures what the bit meets at its tip.
- **Evidence (REPRO `v\n7r\v-relief.ts`, `out\pre1904` vs `out\after`):**
  - All 49 programs changed, finishing path +1 % … +31 %.
  - Bits that already measured 0 mm over one pass: tapered ball pyramid 2,783 → 3,549 mm (+28 %); 1/16" flat pyramid 1,054 → 1,246 (+18 %); 1/16" ball cone 2,005 → 2,331 (+16 %).
  - ⅛" ball on the pyramid and cone: before max 0.60 / 0.79 mm under the tip, no levels. After: 1 step-down level (+22 % / +14 % path) and the note "the 3.175 mm roughing bit leaves more than one depth per pass under the 3.175 mm finishing bit's path in places…".
  - The final carved surface is unchanged.
- **Severity:** P3 (run time, and a note that overstates the load on one bit; no harm to the part).
- **Novelty:** new (#1904).
- **Fix direction:** judge the under-tip stock after the finishing rows already cut (or by the bit's leading half only), or gate the path-only rule on pointed bits as the ADR describes. Add a "no change" case (⅛" ball after ⅛" rougher on the pyramid) to `prepare-relief-n7-under-tip.test.ts`.

### N8-P3-2 — On the N7 auditor's row measure, short over-one-pass stretches remain on the V-bit and at level-to-surface junctions

- **Where:** as N8-P3-1; ADR-421 Amd 5 Consequences: "no lateral move takes more than 1.5 mm (plus 0.1 mm of grid slack) under its tip" for the V-bit, engraver, tapered ball and 1 mm ball on the pyramid and ellipse.
- **Evidence (REPRO `v\n2r\r-p21.ts`, `out\{pre1904,after}\p21.txt`):**

  | Case | mm over 1.55 / peak, before → after |
  |---|---|
  | Pyramid V-bit | 106.8 / 3.12 → **8.8 / 1.98** (longest 0.65 mm). At the relief's boundary wall (rows climbing X41.7→40.2 from Z−5 to Z−0.27, F346) |
  | Ellipse V-bit | 18.1 / 2.56 → **1.5 / 2.33** |
  | Pyramid engraver | 100.2 / 2.74 → 0.98 / 2.01 |
  | New: pyramid 1/16" ball | 0 → 0.97 mm / 2.40, at L891, where the Z−3.000 level row runs on into the surface (Z−3.97) in the same row |
  | New: pyramid 1 mm ball | 0.6 / 1.62 → 0.32 / 2.43 (L1408 Z−3.000) |

  The lagged model (`v-relief`) reads ≤ 1.50 everywhere. The row measure counts what the same row's flank and descent take after the level pass. So the residual is measure-dependent and short.
- **Severity:** P3 (≤ 1.6× a pass over ≤ 0.65 mm stretches; down from 107 mm at 2.1×).
- **Novelty:** residual of KNOWN N7-P2-1 / N7-P3-2 on the auditor's measure.
- **Fix direction:** in the ADR's own per-pass test, add the boundary-wall climb (pyramid V-bit) and a 1/16" ball pyramid case. Or let a level row step back up to the level Z before descending to the surface.

## KNOWN status

| ID | Status on `2e653bf66` |
|---|---|
| N7-P1-1 (bores in default-lead parts) | **fixed** (0 of 1,149 bores in a part across all leads, ramps and tabs; advisory now true for closed outlines). Open-outline sibling: N8-P1-1 |
| N7-P1-2 (open outline just over D) | **fixed** (tabbed and warned to D + 1.89 mm; above, the sliver ≥ one tab's section). Side effect: N8-P2-1 |
| N7-P2-1 (V-bit / engraver under the tip) | **fixed on the lagged model** (0 mm over one pass, 7 surfaces). Residual on the row measure: N8-P3-2 |
| N7-P3-1 (small holes "0 mm") | **fixed** (no claim on Ø7–Ø10, 8 mm square, hexagon, ¼" Ø12–16; wedges still named 1.0 / 0.6) |
| N7-P3-2 (plain 1 mm ball overload) | **fixed on the lagged model** (ellipse 2.56 → 1.50; cone, ridge, pyramid 1.50). Row measure: 0.32 mm at 2.43 on the pyramid (N8-P3-2) |

## Verified clean

- Untiled programs unchanged by #1901 (172 jobs).
- No bore off the stock or nearer a toolpath than the advisory claims.
- Closed-outline tab programs byte-identical across #1903 (97 + 205 programs). Manual tabs under transforms identical. No tab dropped. No freed piece in `n7-free`.
- Gap rule exactly as specified on both bits and all three sides. No tab over the gap.
- No new relief over-depth: final stock ≤ 0.04 mm from before in every cell.
- **Bonus: `adaptive-pocket-verifier.test.ts`, run alone 5 times (explicit file, 1 worker): 17 / 17 passed each time.** Durations were 13.2–15.6 s. The slowest test, `verifies a regular 360-edge curved pocket`, took 5.07–6.09 s against a local budget of `ciBudgetMs(20_000, 60_000)` = 20 s. It is not flaky in logic. It is timing-sensitive: under a full parallel local run a 3–4× slowdown can pass the 20 s local ceiling, which matches the one failure seen. Under load it was not reproduced (memory rule).

## Not verified

- N8-P1-1 / N8-P2-1 in the rendered Preview or Job Review UI (prepared-job warnings and `plannedTileRegistration` only).
- Physical strength of 3.27 mm corner bridges and of slivers between 0.2 and 1.89 mm.
- The ADR's own analytic per-pass simulator (`prepare-relief-n7-under-tip.test.ts`) was not run. Why it disagrees with the N2r row measure is READ-level only.
- The pocket-verifier test under a multi-worker load run.
- Tiling with relief or V-carve layers; ¼" bit on the registration matrix.

## Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-n8\`. Run `v\run.sh <subdir> <script> <after|pre1901|pre1903|pre1904> [args]`, or directly from the script's folder: `TREE=<tree> node --no-experimental-webstorage --import ../../register-v.mjs <file>`.

| File | Covers | Output (`v\<dir>\out\<tag>\`) |
|---|---|---|
| `register-v.mjs`, `ts-resolve-v.mjs`, `v\run.sh` | tree-remapping loader and runner | `so-*.txt` |
| `t-pre1901`, `t-pre1903`, `t-pre1904` | extracted trees (`node_modules` junction: remove only with `cmd /c rmdir`) | — |
| `v\n8\v-reg.ts`, `v\n8\v-regcmp.cjs` | #1901 matrix, untiled hashes, before / after bore sets | `reg-matrix.txt`, `reg-summary.txt`, `untiled-hashes.txt` |
| `v\n8\v-reg-open.ts` | **N8-P1-1** | `reg-open.txt` |
| `v\n7r\x-reg.ts`, `v\n4r\r-reg*.ts` | N7r and N4r registration repros | `reg.txt`, `so-r-reg*.txt` |
| `v\n8\v-gap.ts` | #1903 gap sweep | `gap.txt`, `gap-hashes.txt` |
| `v\n1\v-shift.ts`, `v-shift2.ts`, `v-shift3.ts` | **N8-P2-1** | `so-v-shift*.txt` |
| `v\n1\*.ts`, `v\n1r\*.ts` (incl. `n7-small`, `n7-free`, `n7-open`), `v\n7r\x-holes.ts`, `x-spot.ts`, `x-open.ts` | #1903 regressions, N7-P3-1 | `*.nc`, `so-*.txt` |
| `v\n7r\v-relief.ts`, `v-relief-grid.ts`, `v-gridcmp.cjs` | #1904 lagged model, hashes, over-depth; **N8-P3-1** | `relief-all.txt`, `relief-hashes-all.txt`, `grid-*.bin`, `relief-fullnote.txt` |
| `v\n2r\r-p21.ts` | **N8-P3-2** (N2r row measure) | `p21.txt`, `p21-*.nc` |
| `v-vitest.mjs`, `vitest.n8.config.mts` | bonus: pocket-verifier runs | `v\vt\run1-5.txt` |

## Counts

| Raised | P1 | P2 | P3 | Known (statused) |
|---|---|---|---|---|
| 4 | 1 | 1 | 2 | 5 (N7-P1-1, N7-P1-2, N7-P2-1, N7-P3-1, N7-P3-2) |

```json
[
  {"id":"N8-P1-1","severity":"P1","file":"src/core/cnc/tile-registration-placement.ts","line":null,"anchor":"Job Review on the same job says the open outline is cut free like a closed shape; ADR-392 Amd 8 'outside every outline the toolpaths go round'","evidence":"REPRO","known":"sibling of N7-P1-1 (pre-existing; same on t-pre1901)","summary":"Part drawn as an open outline (gap 2.5-6 mm) gets 11 of 14 registration bores through it; only a generic advisory caveat"},
  {"id":"N8-P2-1","severity":"P2","file":"src/core/cnc/cnc-open-outline-tabs.ts","line":66,"anchor":"ADR-258 Amd 5 corner tabs 6.00; closed twin 6.00","evidence":"REPRO","known":"N1-P2-1 symptom reintroduced (regression of #1903)","summary":"planClearOfGap shifts all tabs onto corners of an open square/L: bridges 6.0 -> 3.27 mm silent; 1 mm tabs cut the part free (warned)"},
  {"id":"N8-P3-1","severity":"P3","file":"src/core/relief/relief-finishing-step-down.ts","line":40,"anchor":"ADR-421 Amd 5 consequences (pointed bits only); lagged model 0.60/0.79 mm","evidence":"REPRO","known":null,"summary":"Every relief finish +1-31% path; 1/8in ball gets a level and an 'under the path' note where it meets <= 0.8 mm"},
  {"id":"N8-P3-2","severity":"P3","file":"src/core/relief/relief-finishing-step-down.ts","line":null,"anchor":"ADR-421 Amd 5 'no lateral move more than 1.5 (+0.1)'","evidence":"REPRO","known":"N7-P2-1 / N7-P3-2 residual on the row measure","summary":"N2r row measure: V-bit pyramid 8.8 mm at <=1.98, ellipse 1.5 mm at 2.33; new 1/16in ball 0.97 mm at 2.40 and 1 mm ball 0.32 mm at 2.43 at level-to-surface rows"}
]
```


## Refuter (2026-11-14)

**Tree and harness.** The same read-only export `j41-main` = `origin/main` @ `2e653bf66` as the auditor. For before/after I imported the auditor's extracted trees `zz-n8\t-pre1901`, `t-pre1903` and `t-pre1904` read-only (nothing deleted or edited there).

My scripts are in `zz-n8r\`. Run each with `TREE=<j41|pre1901|pre1903|pre1904> node --no-experimental-webstorage --import ./register.mjs <file>`; output goes to `zz-n8r\out\<tree>\`. I read the auditor's `v-reg-open.ts` and the N7r `x-build.ts` / `x-relief.ts` for API shape only. Nothing imports a `zz-n8\v`, `zz-n7r` or earlier script.
- **Own builder and reader** (`r-lib.ts`): `createProject` / `createLayer` with `imported-svg` polylines, Save (`emitGcode`), and `prepareOutput` + `detectMachineJobWarnings` for Job Review. The G-code reader is my own (modal G0–G3, arcs split at 0.2 mm, `layer-id` comments).
- **Own measures:**
  - **Holding section** (`Floor`): a 0.02–0.05 mm raster of the stock bottom. It is stamped by the bit's disc wherever a feed move (or the part of one) is at the program's full depth. Two outputs:
    - **neck:** the minimum distance between two cut-through components, which is the narrowest uncut section across each tab at the stock bottom;
    - **free:** a 4-connected flood of uncut cells from a seed inside the part. If it never reaches the raster border, the part is cut free.
  - This uses no chord, no floor-piece endpoints and no compiler data. It reads 6.00 mm on a closed 60 mm square's 6 mm tabs, 5.93–5.96 mm on a circle.
  - **Bores:** the deepest point of every `tile-registration` feed move below Z0 in every tile file, mapped to stock coordinates through `tileJobs` tile rectangles and clustered. Each is checked against the drawn part and window polygons, the untiled program's cut moves (≥ R + r + 2 mm) and the stock rectangle. They are cross-checked with `plannedTileRegistration`, and matched in every job.
  - **Relief: tip-attributed per-row removal.** The finishing op is split into rows at every rapid and every XY turn ≥ 60°. For each 0.025 mm step of a lateral move (XY ≥ |Z|), I charge the stock that cell held at the row's start minus max(its final height, the tip's Z there). That is what the row takes off the cell down to the tip, and nothing a later Z-dominant move or a neighbouring row's flank takes. It runs on a 0.05 mm grid with analytic ball / V shapes. There is also a roughing-only figure: the stock left by roughing alone over each finishing tip position.
- **Own geometry:**
  - open squares 8–60 mm with mid-edge or vertex gaps, an open L, 100 × 40 rectangles, open circles r8 / r30 / r90, triangles, a pentagon, hexagons and an octagon;
  - a 500 × 250 r20 tabletop and a Ø300 disc drawn open (gaps 2 / 4 / 8 mm);
  - a 400 mm hexagon, two Ø180 discs with a 25 mm lane, a 380 × 280 frame with a 260 × 160 window, six Ø80 coasters and a 400 × 300 L;
  - closed parts, holes and wedges (324 programs);
  - pyramid 40° (the N2r formula), a spherical bowl and a 30° ramp (own).
- **Not used:** pnpm, Vitest, a browser, hardware. Each Node process ran ≤ 580 MB, one at a time, with about 2.2 GB free.

### Verdicts

| Finding | Verdict | Severity | Evidence (own) |
| --- | --- | --- | --- |
| N8-P1-1 | **CONFIRMED** on new geometry. **The advisory's claim is false, not just limited**: for a gap < D the toolpath literally goes round the outline, yet bores land inside "every outline the toolpaths go round" | **P1** | `r-reg.ts` → `out/j41/reg.txt`, `out/pre1901/reg.txt` |
| N8-P2-1 | **CONFIRMED and RAISED.** On small open squares (8–10 mm) with 0.5–1 mm tabs, the part is **cut free with no narrow-bridge line**. The only Job Review text says it "is given holding tabs as closed shapes". At 1.5 mm the necks are 0.12 mm, also silent. Before #1903 the same parts held at 0.48–1.00 mm | **P1** | `r-shift.ts`, `r-small2.ts`, `r-small3.ts`, `r-text.ts` → `out/{j41,pre1903}/shift.txt`, `small2.txt`, `small3.txt`, `text.txt` |
| N8-P3-1 | **CONFIRMED, one wording correction:** the path-only note is literally true. The level it adds is unneeded | P3 | `r-relief.ts` → `out/{j41,pre1904}/relief-g.txt` |
| N8-P3-2 | **CONFIRMED only as a measure/doc issue.** On my tip-attributed measure, 0 mm over 1.55 on 3 surfaces × 4 bits after #1904. The residual appears only when removal is charged to the tip that did not take it | P3 | `out/j41/relief-g.txt`; `relief-t.txt` (row-total variant) |

### Per-finding notes

**N8-P1-1: CONFIRMED, P1.** Own shapes, 12 mm stock, ⅛", tiles 200 × 160, overlap 20, registration draft from the layer. Bores were read from the tile G-code, and every one equals a planned (Preview) bore.

| Job | Bores | **In the part** (mm inside, depth) | Job Review |
| --- | --- | --- | --- |
| Tabletop 500 × 250 r20, closed, Outside / On path | 3 | 0 | — |
| same, drawn open, gap 2 mm (< D), Outside / On path | 14 | **11** (5.5–110 mm, Z−12) | `closed-gap`: "the cut frees it like a closed shape. It is given holding tabs as closed shapes" |
| same, gap 4 mm (in the #1903 window) | 14 | **11** | same line |
| same, gap 8 mm | 14 | 11 | none |
| Disc Ø300, closed | 8 / 3 | 0 | — |
| Disc Ø300 open, gap 2 / 4 mm | 8 | **5** (5.5–120 mm) | `closed-gap` |

- **Pre-existing.** It is the same on `t-pre1901`: 11 / 11 / 11 and 5 / 5, where the advisory still said "clear of every part and cut".
- **The new advisory text** (full) ends: "Each is placed at least the cutter's radius, the hole's radius and 2 mm from every toolpath, outside every outline the toolpaths go round, and on the stock. A part drawn as an open outline is not known as a part. Preview draws them; check them against your parts and fixture before cutting."
- **The caveat is not a warning under G6.**
  - It is attached to every registration listing.
  - It names no outline and no bore.
  - It sits next to a sentence that is false for this job. With a 2 mm gap, the bit's two end kerfs overlap, so the toolpath does go round the outline.
  - Job Review on the same job says KerfDesk treats the outline as closed.
  - The app knows the specific mismatch (`cutFreesOpenOutline` is true) and does not say it.
- **Severity.** P1 for gaps < `closedForTabsBelowMm` (the part is freed and drilled). For a genuinely open line (8 mm gap: the part is held by its web and Job Review is silent), the generic caveat is literally true; I would rate that tail P2. The finding stays P1.
- **Fix direction:**
  - Add an open profile pass as a ring in `addPassObstacles` when its ends lie within `closedForTabsBelowMm`, using the same rule as the tab code. Carrying the compiler's closed-for-tabs fact is better than re-deriving it.
  - Name each open outline that a bore lands inside.
  - Add an open-outline case to `tile-registration-lead-in.test.ts`.

**N8-P2-1: CONFIRMED, raised to P1.** ⅛", Outside and On path give identical results, through 6.35 mm, tabs 2 mm high, gap at mid-edge. The cells give the own floor-neck in mm (pre-#1903 → after) and the Job Review line after.

| Shape, gap | Tab width | Before (`t-pre1903`) | After | Job Review after |
| --- | --- | --- | --- | --- |
| square 60, gap 1 | 6 (default) | 6.00 × 4 | **3.27 × 4** | `closed-gap` only |
| square 60, gap 1 | 4 / 3 / 2 / 1.5 | 4.00 / 3.00 / 2.00 / 1.50 | 1.86 / 1.15 / 0.44 / 0.09 | "as little as 1.9 / 1.2 / 0.5 / 0.1 mm" |
| square 60, gap 1 | 1 | 1.00 × 4 | **free** | "as little as 0 mm … or use narrower tabs" |
| square 60, gap 4.5 | 6 | untabbed, sliver only | 3.27 × 4 + 1.30 sliver | `closed-gap` |
| square 60, vertex gap | 6 | 6.00 | 6.00 | `closed-gap` |
| **square 8 and 10, gap 1 or 2.5** | **0.5 / 1** | 0.48 / 1.00 × 4, held | **free** | **`closed-gap` only** ("given holding tabs as closed shapes") |
| square 8 / 10 / 11, gap 1 or 2.5 | 1.5 | 1.48–1.52 | **0.12 × 4** | `closed-gap` only |
| square 8 / 10 / 11 | 2 / 2.5 | 2.00 / 2.48 | 0.49 / 0.83 | `closed-gap` only |
| square 10 / 12 / 14, gap 1 | 4 | 4.00 | 1.88 | `closed-gap` only (below W/2 = 2) |
| square 12 W3, gap 1 and 4 | 3 | 3.00 | 1.20 | `closed-gap` only (16 mm and up is named) |
| squares 11–16 | 0.5 / 1 | 0.48–1.00 | free | "as little as 0 mm" |
| L 80 (mine), gap 1 | 6 / 2 | 6.00 / 2.00–2.75 | 6.00 / **0.44** | `closed-gap` / "0.5 mm" |
| rectangles 100 × 40 (long or short edge), triangles, hexagons, octagon, circles r8/r30/r90 | 6 / 2 | — | 5.93–6.00 / 1.96–2.00 (pentagon 4.23 at W6) | `closed-gap` |

- **Mechanism (READ).** `planClearOfGap` (`cnc-open-outline-tabs.ts:67-91`) moves every centre by one `delta`. On any loop whose tab spacing equals its edge length (squares; the L only at narrow widths), half a spacing is a corner. The Amd 5 corner-avoiding plan is thrown away.
- **Why the small cases are silent.** The narrow-bridge line also reads the plan, through `windowsBridgeMm` → `narrowestBridgeMm`. On the 8–10 mm loops it names nothing. Amendment 7 decision 4 skips windows whose cut arcs on both sides are shorter than max(2D, window), which matches the 8 mm case. I did not isolate the cause for the 10 mm case (READ: `cnc-tab-bridge.ts:23-37`).
- **The Amendment 7 premise is wrong for gaps under D.** It says "a window there would hold nothing". Before #1903, the tab over a 1 mm gap held a full 6.00 mm (my floor-neck), because both end kerfs ride up over the gap. So for gaps < D, the shift buys nothing and costs the corner placement.
- **Regression comparison.**
  - Gap < D: strictly worse than before. Every tab was at full width before; now there are corner necks or a freed part.
  - In the D … D + 1.89 mm window: better than before. Before there were no tabs and a 0.005–1.89 mm sliver (N7-P1-2, P1). Now there are corner tabs plus the sliver.
  - So #1903 fixed a P1 band and opened another below it.
- **Severity: P1 under METHOD §3.** This matches the N1-P2-1 → P1 precedent: corner tabs freeing parts at allowed widths, silently. Tab width allows 0.5 mm in 0.5 steps (`CncTabFields.tsx`). The part is freed (or held by 0.12 mm) with no line naming it. The one line shown says it is "given holding tabs", and the field's tooltip says "Tabs are kept off corners". Where the warning does fire ("as little as 0 mm"), its advice cannot be followed on an open outline ("Drag those tabs") or makes it worse ("use narrower tabs").
- **Fix direction:**
  - For gaps < D, do not shift (the gap is swept).
  - Otherwise, move only the window that touches the gap, or re-run the Amd 5 corner-avoiding placement with the gap's arc excluded.
  - Add 10 mm and 60 mm open squares with mid-edge gaps at W1 and W6 to `compile-cnc-tab-gaps.test.ts`, checked on emitted G-code.

**N8-P3-1: CONFIRMED, P3.** Finishing XY path, `t-pre1904` → `j41`:
- pyramid: V-bit 640 → 831 (+30 %), ⅛" ball 1,070 → 1,310 (+22 %), 1/16" ball 1,908 → 2,345 (+23 %), 1 mm ball 2,779 → 3,270 (+18 %);
- bowl: +21 / +13 / +13 / +8 %;
- 30° ramp: +24 / +23 / +21 / +15 %.

Every program grew. On the pyramid, the ⅛" ball gains 1 level and the path-only note, although the most its tip takes in a row was **0.50 mm** before #1904.
- **Wording correction:** the note is literally true. Roughing alone leaves up to 2.27 mm over the ⅛" ball's tip path, for 150 mm. The ball's own earlier rows take that away before the tip arrives, so the level is unnecessary run time, not a false note.
- **The rule is not always idle on a ball.** On my 30° ramp the ⅛" ball did overload before (2.77 mm over, peak 2.22), and the same rule fixed it to 1.50. So "gate the path-only rule to pointed bits" would reopen that case. Judging after the finishing bit's own earlier rows is the better direction.

**N8-P3-2: CONFIRMED only as measure/doc wording, P3.**
- **On my tip-attributed measure:** every finishing row on `j41` takes at most 1.50 mm under the tip, on 3 surfaces × 4 bits (incl. 60° V-bit and 1/16", ⅛", 1 mm balls).
- **Before #1904,** the same measure shows overloads: bowl ⅛" ball 8.6 mm at 1.97; ramp V-bit 1.75 mm at 2.06; ramp 1 mm ball 2.07 mm at 2.24; pyramid 1 mm ball 0.80 at 1.62. So #1904 is effective on my measure.
- **Where the residual comes from.** In a row-total variant (charging everything the row takes off a cell, including later Z-dominant descents and other positions' flanks), the pyramid V-bit shows 1.58 mm over 1.55, peak 2.07 (`relief-t.txt`). That is the same kind of residual as the auditor's 8.8 mm at 1.98. So the residual depends on charging the tip with removal it does not make; no lateral move takes it.
- **The ADR's wording is the real problem.** Its Verification measure says "the stock one pass takes off a cell under the tip in all: the feed moves between two rapids". Read literally on a serpentine finish, that also charges neighbouring rows' flank cuts. On my per-pass variant (no row split) the `j41` pyramid V-bit then reads 86.8 mm over 1.55 at 3.85. So the Consequences claim holds only under a narrower measure than the one the ADR names.
- **Severity.** P3 doc precision; there is no load defect.

### Spot checks (own)

| Claim | Result |
| --- | --- |
| No bore in a part (#1901) | `r-reg2.ts`: 5 shapes × 16 variants (arc / line / arc r6-90° / none × ramp 0 / 5° × tabs on / off) = 80 tiled jobs. **544 bores, 0 in a part, 0 in the window slug, 0 nearer than R + r + 2 mm (min margin +0.03 mm), 0 off stock.** `t-pre1901`: 580 bores, **60 in a part** (hexagon, coasters) |
| Untiled byte-identical across #1901 | 80 of 80 untiled programs identical (SHA-1, `reg2.txt` HASHES) |
| Closed outlines byte-identical across #1903 | `r-closed.ts`: 324 programs (9 closed shapes incl. plate with 4 holes, wedge, star; Outside / Inside / On path; ⅛" and ¼"; W 6 / 3 / 1; 4 or 2 tabs). **0 differ** (comments stripped). Job Review: only the small 9 mm square/hole "as little as X mm" lines are gone (intended). My floor-neck on those: ¼" 9 mm part 2.98–6.02 held, ⅛" 9 mm hole 1.80–2.71 held |
| Relief surfaces within 0.04 mm of pre-#1904 | 12 final grids: after deeper by ≤ **0.012 mm**, higher by ≤ 0.011 mm |
| Tiling + open outlines with tabs | `r-tileopen.ts`: 220 × 140 rectangle (gap 1 / 2.5 / 4), circle r90 (gap 1 / 4), two open squares on one layer. The union of all tile files has the same through-cut pieces as the untiled program, and the part is held in every case |
| Open circles, multiple open outlines | Open circle r30 / r8 tabs 5.47–5.96 mm (same as before), gap 4 tabbed with a 0.80 sliver. Two open squares on one layer: tabbed independently (9 floor pieces) |

**Not verified.**
- The rendered UI.
- Text outlines (they are closed paths; not probed).
- The auditor's N2r row measure itself. I reproduced its effect with my row-total variant only.
- Why lead settings left my L and square programs byte-identical (`r-lead.ts`: no arc moves with any lead). This is outside N8's scope. Leads did change the hexagon, disc, coaster and frame programs, so the bore matrix still covers leads.

**KNOWN status (own measures).**
- N7-P1-1: **fixed** (544 / 0 against 580 / 60 before).
- N7-P1-2: **fixed** (gaps of 4–4.5 mm are tabbed and warned).
- N7-P3-1: **fixed** (the 9 mm claims are gone; the necks hold).
- N7-P3-2: **fixed** on my measure (the 1 mm ball goes from 0.80 mm at 1.62 to 0).
- N7-P2-1: **fixed for balls** on my measure. My measure did not see the pre-#1904 V-bit / pyramid overload that N7r and the auditor saw (it read 0 on both trees), so the V-bit half rests on their models.

Refuter counts: raised 4, refuted 0, P1 2, P2 0, P3 2, known 5
