# CNC audit v1 — F2 Pocket and adaptive clearing

- **When:** 2026-10-23 08:30 +0800   **Tree:** origin/main @ `b9202d5aa` (worktree HEAD `e958f7118`
  adds only audit docs; no `src/` difference)
- **Scope:** `src/core/cnc/adaptive-*.ts`, `pocket-*.ts`, `cnc-pocket-*.ts`, `rest-pocket.ts`,
  `cnc-rest-*.ts`, `finish-allowance*.ts`, `cleared-capsule-interval.ts`, `pocket-stay-down-links.ts`,
  and `cnc-helical-pocket-passes.ts` (pocket entry only). Twins were followed into
  `compile-cnc-layer-passes.ts`, `compile-cnc-operation-groups.ts`, `compile-cnc-special-passes.ts`,
  `motion-polish.ts`, `vcarve-region-order.ts`, `cnc-adaptive-issues.ts`, `src/core/job/toolpath.ts`
  and `src/core/sim` (removal grid).
  - Governing documents: ADR-154 and its Amendments (2026-08-02, 2, 3), ADR-153 (rest machining),
    ADR-140 and Amendment 1 (finish allowance), ADR-491 (stay-down links), ADR-312 item 4
    (physical cut direction for adaptive), ADR-251/252 (climb semantics, hole winding), PROJECT.md
    H.16 and non-negotiable 5 (determinism).
  - Ground truth: Autodesk Fusion Adaptive Clearing reference; Vectric VCarve Pro pocket form.
- **Lenses run:** L1, L3, L4 and L7 as stressed passes; L2 for the reference-app claims. L5 and L6
  were not run: no untrusted input enters this area beyond geometry already normalised upstream, and
  the planners' failure paths are covered by the known JR-4 and the offset-ladder diagnostics.
- **Method:** every design was compiled through `compileCncJob` and emitted with
  `cncGrblStrategy.emit`, and the G-code text was then checked by an independent harness that does
  not import any planner, verifier or simulator under audit:
  - **Parser:** G0/G1/G2/G3 with modal motion, G17 I/J arcs expanded at 0.02 mm, and M0 sections.
  - **Gouge check:** signed distance from every cutting sample (every 0.02 mm with Z below 0) to the
    design boundary, in machine coordinates, minus the cutter radius.
  - **Coverage raster:** 0.05 mm cells (0.1 mm for the 1/4" bit). Stock is removed in emission
    order by exact capsule sweeps. "Reachable" means within R of a cell that is at least R from
    every wall, found by Euclidean distance transform. Uncut reachable cells are grouped into
    clusters.
  - **Engagement estimate:** at every 0.1 mm of lateral motion, the leading half of the cutter rim
    (at R plus half a cell) is sampled at 1 degree. A rim point counts as engaged where at least
    0.25 mm of axial stock remains at the current Z. The result is the contact angle phi. A side
    cut of radial depth ae gives phi = arccos(1 - ae/R), from geometry. The method reads a full slot
    as 169-180 degrees and a side cut about 2 degrees high.
  - **Twin check:** the preview's `buildToolpath` and `computeRemovalGrid` were run on the same Job.
- **Counts:** 5 raised → 0 refuted (refuter: 5 CONFIRMED, 0 PLAUSIBLE; severity change: P1-1 →
  P2) → P1 0 / P2 3 / P3 2 (+3 KNOWN re-observed). The finding keeps its ID `F2-P1-1`.

## Headline

Gouge safety holds: no emitted cutting move in 30+ programs came closer to a wall or island than
the cutter radius, beyond 0.001 mm output rounding. Ordinary offset, raster and stay-down-linked
pockets left no reachable stock. The defects are in the island-aware adaptive planner and the rest
ladder added or left behind since 2026-10-09:

- **Island adaptive leaves pins of stock (raised P1; refuter: P2).** It partitions the pocket along every
  island's bounding lines. It then leaves a full-depth pin of stock at every interior point where
  two of those lines cross, and nothing removes it. The verifier's 98.5 % coverage target lets this
  through, and Job Review says nothing about stock left behind.
- **Island adaptive's wall cleanup runs too early (P2).** The pass that cleans up all walls is
  attached to the last planned cell. The emitter re-sorts cells by source region, so a pocket nested
  inside an island, or a second pocket on the layer, gets its wall slotted at full width at the
  cutting feed, at every depth, before it is cleared. This happens at all default settings.
- **The rest ladder lacks the core-ring fix (P2).** Above 50 % stepover it leaves a full-depth fin.
  The ordinary pocket fixed the same problem in July.

## Findings

### F2-P1-1 (refuter: P2) — Island adaptive leaves a full-depth stock pin at every interior partition junction, certified as covered

- **Where:**
  - `src/core/cnc/adaptive-pocket-islands.ts:33-47` cuts the region into cells along every
    island's min/max X and Y. Each cell is cleared on its own by `sequencesForComponent`, whose
    centre region is the cell inset by R, so each cell leaves its own convex-corner fillet.
  - `adaptive-pocket-islands.ts:48-56` adds only `offsetAdaptivePaths(region, -R)` as final
    cleanup. That ring follows the real walls and islands, never the interior crossings.
  - `src/core/cnc/adaptive-pocket-verifier.ts:24,99` accepts any plan that removes at least
    98.5 % of reachable stock.
- **Anchor:**
  - Contract: ADR-154 Decision ("An independent bounded stock-removal verifier must confirm ...
    coverage"), and ADR-154 Amendment 3 Decision 1, which says stock is "what the cutter can
    reach".
  - Ground truth: the Fusion Adaptive Clearing reference says the strategy "guarantees a maximum
    tool load", and that "a positive stock value leaves material". Stock is left only when
    configured.
- **Scenario:**
  - 100 x 60 mm pocket with islands 20 x 15 mm at (20,10) and (60,35), 3 mm deep, 6.35 mm end mill,
    default 10 % engagement, Adaptive. The plan has 23 partitions, and the verifier returns
    `ok: true` with coverageRatio 0.98739.
  - The emitted program never brings the cutter centre closer than 4.49 mm (= R·√2) to the 8
    interior crossings at scene (20,35), (40,35), (20,50), (40,50), (60,10), (80,10), (60,25) and
    (80,25), against R = 3.175. The independent raster finds 8 uncut clusters of 8.52 mm²
    (0.858·R²) each, standing the full 3 mm, 12.6 mm from any wall. That is 68.2 mm² in total.
  - Same with the default 1/8" bit at 25 % engagement on an 80 x 60 pocket with 15 mm islands at
    (15,12) and (48,32): 8 crossings at 2.244 mm (= R·√2) from any cutter centre, R = 1.5875.
  - Each pin is a four-point star with a solid core about 0.29·R from the crossing in each diagonal
    direction (≈0.9 mm across with 1/8", ≈1.9 mm with 1/4"). Its arms run R along the cut lines.
  - Job Review shows only the island-adaptive disclosure ("coverage is simulated"). No warning names
    stock left in the pocket. The 3D preview's removal grid does show depth 0 at the crossings, so
    the twin agrees and a close inspection of the 3D view would reveal the pins.
  - It needs two or more islands whose bounding lines cross away from every wall and island. One
    island, or islands aligned on both axes, give no interior crossing.
- **Evidence:** REPRO.
  - Command: `node ../../../node_modules/vitest/vitest.mjs run src/core/cnc/zz-f2-evidence.test.ts -t E1`
    (archived as `scratchpad/f2-repros/zz-f2-evidence.test.ts`) and `zz-f2-junction.test.ts`.
  - Output:
    - `E1 verifier {"ok":true,"coverageRatio":0.9873875544839099,...}`
    - `E1 junction scene (20,35) nearest final-depth cutter centre 4.49 mm (R=3.175)` (all 8 rows)
    - `E1 uncut 68.16 [{"a":8.52,...,"wall":12.6} x8]`
    - Twin: `preview depth at probes [{"scene":[20,35],"previewDepth":0},...]`
- **Severity note:** P1 by the letter: the pocket floor is silently wrong, with stock standing to
  full depth and nothing warning. The coordinator may weigh the pin size (≈1-2 mm cores) toward P2.
- **Refuter:** **CONFIRMED** (REPRO with an independent checker); **severity P1 → P2**. What would
  refute it: a later pass in the same program that sweeps the crossings, crossings out of the
  cutter's reach, or an ADR that accepts reachable stock left standing inside the 98.5 % target.
  None holds.
  - **Independent check.** The refuter wrote its own checker. It has its own G-code parser, with
    G2/G3 expanded at 0.005 mm sagitta. It keeps an exact flat-cutter height field: for each move,
    in emission order, a cell takes the lowest Z over the interval of the move where the cell centre
    lies within R. The whole emitted program was run through it.
    - E1 (100 x 60, two 20 x 15 islands, 1/4" bit, default 10 %, 3 mm deep, 0.1 mm cells):
      - 8 clusters of 8.52 mm² each, 68.16 mm² in total. That is 4R²(1 − π/4), the four
        cell-corner fillets.
      - No cell in them was ever cut: they stand the full 3 mm, 12.55 mm from any wall.
      - The nearest cutting centre at any depth is 4.49 mm (= R√2) from each of the 8 crossings.
    - 80 x 60 with the 1/8" bit at 25 %: 8 × 2.12 mm², also never cut.
    - 120 x 80 with three diagonal 20 mm islands, 1/4" bit, default 10 %: 12 pins, 102.2 mm².
    - Worst wall clearance was −0.0014 mm, which is output rounding. No rapid below Z0 met stock.
  - **No later pass.**
    - An adaptive layer returns its passes directly (`compile-cnc-layer-passes.ts:85-92`,
      `completePasses`).
    - Rest is never requested with adaptive (`cnc-rest-operation.ts:59`).
    - There is no pocket-finish stage (`cnc-stage-recipe.ts`), and finish allowance applies to
      profiles only.
    - The simulation covered the whole emitted program.
  - **98.5 %.**
    - ADR-154 and Amendment 3 Decision 1 fix "98.5 % of the stock the cutter can reach" as a
      certification target. Amendment 3 explains it as grid slack, once unreachable corners were
      taken out of the count.
    - No ADR accepts reachable stock left standing, and no uncut-area diagnostic exists.
    - The island partition planner has no ADR at all (F2-P3-2).
  - **Correction: the pins are larger than stated.** The nearest centres sit at (±R, ±R), so the
    uncut star reaches R(√2 − 1) ≈ 0.41·R from the crossing along each diagonal: about 2.6 mm across
    with 1/4" and 1.3 mm with 1/8", not 0.29·R.
  - **Severity P2, not P1: the path is narrow.**
    - Adaptive is a Pro opt-in (`PocketFillRow.tsx:29`), and the default strategy is offset
      (`machine.ts:185`). Island adaptive must also pass its own verifier.
    - A sweep of six multi-island designs at full defaults gave:
      - The default 1/8" bit fell back to offset rings every time (0 of 6). Job Review names that
        fallback.
      - The 1/4" bit compiled island adaptive 2 of 6 times, and both had pins. On that path the pins
        are certain.
    - The error is stock left standing, not a gouge or unexpected motion. The 3D preview's removal
      grid shows it (the auditor's twin). No later move in the program comes near a pin, so the
      risk of snapping a bit is low.
    - This fits P2: an ordinary user gets a misleading result, a plan the verifier certified with
      Job Review silent.
- **Fix direction:**
  - Clean up the interior crossings: run each cell's finish ring across the cut lines it shares, or
    add the union of cell-corner remnants to the final cleanup.
  - Make the verifier report any connected uncut reachable cluster, not only a total-ratio
    shortfall.

### F2-P2-1 — Island adaptive's whole-region wall cleanup is emitted before later regions are cleared, as a full-width slot at the cutting feed; the verifier certifies a different order

- **Where:**
  - `src/core/cnc/adaptive-pocket-islands.ts:50-56` appends the finish rings for every wall and
    island of the whole region to the last planned sequence.
  - `src/core/cnc/adaptive-pocket-operation.ts:74-80` re-sorts sequences by
    `vcarveSourceRegionRankFromLayout`. Then `:82-99` emits each sequence's finish rings at every
    depth straight after that sequence's roughing.
  - `src/core/cnc/adaptive-pocket-verifier.ts:47,73-74` simulates `plan.sequences` in plan order,
    with every finish ring last and unmeasured.
- **Anchor:**
  - Twin: the verifier's order differs from the emitted order (`adaptivePocketPasses`).
  - Contract: ADR-154 says roughing sequences are "verified constant-load". The code's own intent is
    "final wall cleanup" (`adaptive-pocket-islands.ts:49`).
- **Scenario:**
  - All defaults: 1/8" bit, 10 % engagement, Climb, 1.5 mm per pass, 3 mm deep, Adaptive. A 60 mm
    square pocket contains a 36 mm square island, which contains an 18 mm square pocket.
  - The plan has 9 partitions. The finish rings are on sequence 8 (entry (54,54), 4 finish rings).
    The nested pocket is sequence 4, which ranks after the outer region and so is emitted after
    sequence 8.
  - At line 16918 the program rapids to X37.413 Y370.000 and plunges straight in with
    `G1 Z-1.500 F300` into untouched stock. It then cuts the nested pocket's whole wall ring at
    F1000 (`G1 X37.413 Y377.413 F1000` ... `G1 X37.413 Y370.000`), and repeats this at Z-3.
  - The first helix inside the nested pocket is at line 18163.
  - The independent simulation measures 104 mm of cutting at 150-169 degrees of contact at F1000, at
    both Z-1.5 and Z-3. The verifier reports `maxSimulatedEngagementMm 0.498` and coverage 1.
  - Also reproduced with a second plain pocket on the layer: 30 mm square with a 10 mm island,
    plus a 20 x 9 mm pocket at x 40, 4 mm bit at 0.5 mm. The second pocket's wall ring was slotted
    at 170 degrees at F1000 before it was cleared.
  - With the deep depth-per-pass that adaptive is chosen for, this becomes a full-width slot at full
    feed around the whole perimeter, which breaks small bits.
  - Job Review's island disclosure says "final wall cleanup can engage more stock". It does not say
    that a nested or second pocket is slotted at full width before it is cleared.
- **Evidence:** REPRO.
  - Command: `... run src/core/cnc/zz-f2-evidence.test.ts -t E2`.
  - Output:
    - `E2 verifier {"ok":true,"coverageRatio":1,...,"maxSimulatedEngagementMm":0.4976...}`
    - `E2 plan seq 8 entry (54,54) finishRings 4`
    - `E2 first inner wall-ring move at line 16918 ; first helix inside inner pocket at line 18163`
    - `E2 cutting-feed samples >=150deg 1042 mm 104.2 at Z [-1.5,-3] max 169`
  - L7: `adaptive-pocket-islands.test.ts:20` certifies this exact nested case (40 / 24 / 12 mm) on the
    plan and verifier only. The emission test (`adaptive-pocket-islands-emission.test.ts`) uses a
    single island, so the defect passes both.
- **Refuter:** **CONFIRMED** (REPRO + READ, independent engagement method); P2 kept. What would
  refute it: emission in plan order, or the nested region cleared before the cleanup ring runs.
  Neither holds.
  - **Read.**
    - `adaptivePocketPasses` sorts the sequences by `vcarveSourceRegionRankFromLayout`
      (`adaptive-pocket-operation.ts:74-81`).
    - It then emits each sequence's finish rings at every depth, straight after that sequence's
      roughing (`:82-109`).
    - The verifier walks `plan.sequences` in plan order and clears every finish ring last
      (`adaptive-pocket-verifier.ts:47-74`).
  - **Repro: nested 60 / 36 / 18 at all defaults** (1/8" bit, 10 %, 3 mm deep, 1.5 mm per pass).
    - Line 16917, `G1 Z-1.500 F300`, is a straight plunge into stock that has not been cut.
    - Line 16918 starts the nested pocket's wall ring at F1000. The ring runs again at Z-3
      (lines 18154-18160).
    - The first helix inside the nested pocket is at line 18163.
    - Engagement was measured from the material removed per mm of travel on the exact height field,
      not by sampling the rim: 51.9 mm per depth level at ae ≥ 0.9·D, up to 173 degrees, at F1000.
      That is 103.8 mm in total, which matches the auditor's 104 mm.
  - **Second-pocket case.** The auditor's 4 mm bit is not in the starter tool list, so the refuter
    used the 3 mm starter bit `em-3000` at 0.5 mm engagement. It slots 37.5 mm per level at 180
    degrees and F1000 before that pocket's first helix (plunge at line 8454, helix at line 9132).
  - **Note on severity.** At the default 1.5 mm per pass this is the same slot the default profile
    cut makes. "Breaks small bits" therefore holds for the deeper passes that adaptive is chosen
    for, not at the defaults. P2 rests on the broken constant-load contract and on a verifier that
    certifies an order that is never emitted.
- **Fix direction:**
  - Emit the whole-region cleanup after every sequence of every region, or split it per source
    region and attach it to that region's last sequence after sorting.
  - Run the verifier over the emitted sequence order.

### F2-P2-2 — Rest pocket ladder has no core ring: above 50 % stepover the rest pass leaves a full-depth fin

- **Where:**
  - `src/core/cnc/rest-pocket.ts:181-218` (`centerRegionRings`) offsets the rest target inward by
    whole steps and stops at the first empty offset. It has no deepest-ring bisection and no
    remaining-core pass. Both rest modes use it: legacy at `:67` and stock-aware at `:113`.
  - Twin: `src/core/cnc/pocket-paths.ts:113-208` (`coreRing`, `remainingPocketCores`), where the
    July full-chain audit item 1.10 fixed the same problem for ordinary pockets.
- **Anchor:**
  - Contract: ADR-153 says the rest bit "machines only the modeled remainder". Its rings are
    generated "over that target".
  - Twin: `pocketRingToolpaths` leaves no core at any stepover.
  - Ground truth: Vectric's pocket form says subsequent tools "remove as much material as it can
    from any previously unmachined areas". It also adds "Tail" cleanup moves when the stepover is
    "greater than 50% of the cutter/tip diameter".
- **Scenario:**
  - Pocket: 40 mm square with an 8 mm wide, 40 mm long arm, 3 mm deep. Rough first with the 9.525 mm
    end mill (it cannot enter the arm), then the 1/8" layer bit at 85 % stepover.
  - The arm's rest target is a strip 4.825 mm wide. The second offset (2.70 mm) is empty, so only
    the outline ring is cut. Its sweep reaches 3.175 mm from each wall, which leaves a 1.65 x 36 mm
    fin standing to the stock top along the arm's centre.
  - Results:
    - Legacy rest: 58.9 mm² uncut.
    - Stock-aware rest: 60.8 mm² uncut.
    - At 60 % stepover a 6.6 mm arm leaves 7.36 mm².
    - Control: the ordinary offset pocket at 85 % leaves 0.
  - Job Review: nothing (`[]`). The ladder reports `complete`.
  - The 3D preview's removal grid shows depth 0 on the fin (the twin agrees).
- **Evidence:** REPRO.
  - Command: `... run src/core/cnc/zz-f2-evidence.test.ts -t E3` (and `zz-f2-rest.test.ts`).
  - Output:
    - `E3 legacy 85%: M0 1 uncut 58.88 mm2 [{"a":58.88,"c":{"x":58.4,"y":380},"wall":3.98}] review []`
    - `E3 legacy 60% (6.6 mm arm): ... uncut 7.36 mm2`
    - `E3 ordinary offset 85% (control): M0 0 uncut 0 mm2`
  - L7: `rest-pocket.test.ts:61-81` ("preserves 1% and 200% finishing stepovers") asserts only that
    the 200 % rings differ from the 85 % rings. No rest test asserts coverage above 50 %.
- **Severity note:** P2 to match the July audit's equivalent item 1.10 (pocket core at > 50 %). It
  needs a stepover above 50 %, which the field allows without limit (AUD-100-014 keeps every
  positive value).
- **Refuter:** **CONFIRMED** (REPRO + READ); P2 kept, on a corrected rationale. What would refute
  it: a core pass in the rest ladder, a later pass that covers the arm's centre, or a Job Review
  warning. None holds.
  - **Repro.** Independent height field at 0.05 mm, with each section carved at its own cutter
    radius:

    | Case | Uncut, mm² |
    |---|---|
    | Legacy rest, 85 %, 8 mm arm | 58.88 |
    | Stock-aware rest, 85 %, 8 mm arm | 60.80 |
    | Legacy rest, 60 %, 6.6 mm arm | 7.36 |
    | Legacy rest, 50 % and 40 % | 0 |
    | Plain offset pocket, 85 % (with `coreRing`) | 0 |

    - No cell of a fin was ever cut: it stands the full 3 mm.
    - Job Review for legacy rest is `[]`. Stock-aware rest shows only its disclosure about the
      prediction tolerance.
  - **When it happens.** With only ring 0, a fin stands whenever the rest target is wider than D but
    narrower than twice the step. At 85 % with the 1/8" bit, that is every rest slot from 6.35 to
    8.57 mm wide, which covers most of the slots a 9.525 mm rougher leaves behind.
  - **July 1.10 did not cover rest pockets.** It cited only `pocket-paths.ts:41-46`, and its fix
    (6960b14b2) touched only `pocket-paths.ts`. `rest-pocket.ts` already existed then (dfe2c2ef7,
    2026-07-14). This is a twin the fix left behind, not a regression. No earlier audit names the
    rest ladder, and no open PR touches these files.
  - **Correction to the severity note.** The July audit filed 1.10 as P3, not P2. P2 is kept on the
    METHOD's own terms: it is reachable today (any positive stepover is accepted), it breaks the
    ADR-153 contract with a clear failure scenario, and the ladder misleadingly reports
    `complete`.
- **Fix direction:** Reuse the pocket ladder's core handling for the rest target: bisect to the
  deepest ring, or cut the uncovered target remainder from a swept-stroke difference.

### F2-P3-1 — The adaptive roughing chain ignores Cut direction: Conventional, or Climb on a mirrored frame, roughs the opposite way while the helix and finishing ring follow the setting

- **Where:**
  - `src/core/cnc/adaptive-pocket-operation.ts:150` flattens `sequence.rings` as planned. Clipper's
    positive outers are counter-clockwise in machine numbers, and the chain is never reoriented.
  - The helix (`:161`) and finishing rings (`:88-96`) do use `cutDirectionClockwise` and
    `enforceCutDirection`.
- **Anchor:**
  - Contract: ADR-251 says pocket Climb is counter-clockwise from above for an M3 cutter.
  - ADR-312 item 4 says adaptive paths "use the same physical Climb/Conventional mapping as
    ordinary pocket/profile compilation", but also that "the planned open adaptive engagement chain
    is not reversed".
  - The Entry & travel summary shows the stored direction (ADR-481 Amendment 1).
- **Scenario:** 30 mm square, Adaptive, 1.5 mm engagement.
  - Climb, front-left: helix G3, chain counter-clockwise, finishing ring counter-clockwise
    (consistent).
  - Conventional, front-left: helix G2 and finishing ring clockwise, but the roughing chain stays
    counter-clockwise. That is physical climb for nearly all of the material removed.
  - Climb on a front-right (mirrored) origin: helix G2 and finishing ring clockwise in machine
    numbers (physical climb), but the chain is counter-clockwise in machine numbers. That is
    physical conventional.
  - The helix also turns against the first ring. An operator who picked Conventional for a
    flexible machine still gets climb roughing.
- **Evidence:** REPRO (`... -t E4`).
  - `E4 conventional front-left: helix G2 roughing chain CCW (numeric) finishing tail CW`
  - `E4 climb front-right: helix G2 roughing chain CCW (numeric) finishing tail CW`
- **Refuter:** **CONFIRMED** (REPRO); P3 kept.
  - **Repro.** 30 mm square, Adaptive, 1.5 mm per pass. In all three cases the roughing chain turns
    +84 net counter-clockwise in machine numbers.
  - **What follows the setting.** The helix (G3 / G2 / G2) and the finishing ring (CCW / CW / CW)
    follow Cut direction; the chain does not.
  - **Anchor is partial.** ADR-312 item 4 itself says "the planned open adaptive engagement chain is
    not reversed". What is left is drift: the Cut direction setting and the helix contradict the
    roughing chain, and nothing tells the user. That is P3.
- **Fix direction:** Reverse each closed ring of the chain to the requested winding, keeping the
  inner-to-outer ring order. Or state in ADR-312 and in the summary that adaptive roughing does not
  follow Cut direction.

### F2-P3-2 — Island adaptive and stock-aware rest ship without a governing ADR and contradict ADR-154/ADR-153 as written

- **Where:**
  - `src/core/cnc/adaptive-pocket.ts:36-46` routes any region with a hole to
    `adaptiveIslandSequences`.
  - `adaptive-pocket-islands.ts:88` makes the innermost ring a plunge-feed "seed" slot.
  - `adaptive-pocket-verifier.ts:229-244` clears seeds without measuring engagement.
  - `src/core/cnc/cnc-rest-stock-operation.ts:25-50,127-157` (`fullPocketFallback`) cuts the whole
    pocket with the small bit when the stock source is invalid.
- **Anchor:** Contract.
  - ADR-154 Decision: "Planning is limited to sanitized closed, island-free regions ... islands ...
    block preflight".
  - PROJECT.md H.16: "bounded island-free pockets".
  - ADR-153 Decision: "No invalid request falls back to a full-pocket cut with the small bit."
  - AGENTS.md: a new decision is its own ADR.
  - `grep -rli "island" docs/decisions | xargs grep -li adaptive` finds no ADR for the partition
    planner, its seed slotting or the stock-aware fallback. They are recorded only in the build note
    `docs/audits/2026-10-08-cnc-leaders/BUILD.md` (C10).
- **Scenario:** The behaviour is disclosed in Job Review: "plunge-feed seed slotting that may
  engage full cutter width", and "Full offset-pocket fallback: ...". It still contradicts the
  accepted decisions. Seed slots are full-width (up to 180 degrees) at the plunge feed and
  unmeasured; on the nested 60 mm case they total about 92 mm per depth level at 120 degrees or more. The governing contract a reviewer
  reads says island pockets are refused.
- **Evidence:** READ, plus the REPRO disclosure text (`E1/E2 review [...]`).
- **Refuter:** **CONFIRMED** (REPRO + READ); P3 kept.
  - **Read.** `git grep` over DECISIONS.md, `docs/decisions` and PROJECT.md finds no ADR for:
    - island partitions;
    - seed slotting;
    - `rough-stage-stock` / stock-aware rest or its full-pocket fallback.
  - ADR-154 Decision and PROJECT.md H.16 still say "island-free".
  - **Reproduced.**
    - Two-island and nested pockets compile as island adaptive.
    - A stock-aware rest whose rough cutter is missing compiles a full offset pocket with the small
      bit, with no M0. Job Review says "Full offset-pocket fallback".
    - ADR-153 says "No invalid request falls back to a full-pocket cut with the small bit."
- **Fix direction:** Record an ADR-154 amendment and an ADR-153 amendment for island partitions,
  seed slotting, the 98.5 % interplay (F2-P1-1) and the stock-aware full-pocket fallback, or remove
  the behaviour.

## KNOWN (re-observed on this tree, not re-raised)

- **AC-6 (2026-09-24), still open.** The verifier converts contact to engagement with
  r(1 - cos(arc/2)), which reads a side cut low (`adaptive-pocket-verifier.ts` via
  `AdaptiveCutterContact`). It also adds an allowance of one cell diagonal (0.2245 mm at the
  default, kept by ADR-154 Amendment 3).
  - Measured on the default 30 mm square: inner rings around the entry run at 39-50 degrees of
    contact against the 25.8 degrees their 0.159 mm spacing gives on a straight wall. A side cut at
    phi = 45 degrees is ae ≈ 0.46 mm against the 0.3175 mm limit.
  - The links next to the entry disk reach 74 degrees. The verifier reported 0.285 mm.
- **ADR-154 Amendment 3, "the finishing rings are not measured".** Measured contact:
  - 99 degrees at the 30 mm square's 90-degree corners.
  - 169-171 degrees at the right triangle's 45-degree corners (`plain-tri30.nc` lines 1848-1850).
- **AC-2 / CW-03 / rolling-v2 K-3.** A 40 mm L-shape at the default settings falls back to offset
  rings ("simulated radial engagement above the configured limit").
- Not re-run, read only: JR-4. Helical entry on an island pocket returns `[]` and drops the layer
  (`cnc-helical-pocket-passes.ts:17`).

## Refuted

- **Refuter: none refuted.** All five findings were reproduced with the refuter's own parser and
  height field. The only change is a severity downgrade, F2-P1-1 to P2. The refuter raised no new
  P1 or P2: no rapid below Z0 met standing stock in the island or nested programs, and no move
  gouged a wall.

None raised and withdrawn by the auditor. Candidates dropped before raising:

- **Stay-down links cross uncut stock at full depth.** By design: ADR-491 Decision 1 feeds them at
  the plunge feed as "the slow step". Measured: every link was within 1 D and kept R - 0.005 mm.
- **Stock-aware rest re-traces every wall.** Its finishing lateral path was 578 mm, against 88 mm
  for legacy rest on a 40 mm square. This is the disclosed conservative tolerance band
  (`cnc-pocket-stock.ts:190`, default 0.01 mm), not stock left uncut.
- **Pocket finish allowance is ignored.** The field is shown only for profile cuts
  (`CncFinishAllowanceField.tsx:17`), as ADR-140 scopes it. Pocket stock-to-leave is the known gap
  CNG-T05.

## Verified clean

- **No gouge.**
  - All 30+ emitted programs had a worst signed clearance of -0.001 mm, which is 3-decimal output
    rounding. The designs covered adaptive plain and island cases, offset, raster, stay-down-linked
    and lifted pockets, rest legacy and stock-aware, and profile finish allowance.
  - The exception is stock-aware rest at -0.003 mm (3 µm, Clipper 3-decimal precision; not raised).
  - No cutter entered an island.
- **Full clearing, ordinary pockets.** Offset and raster pockets with and without links, and the
  85 % offset control, left 0 reachable uncut cells. Designs: dumbbell with a 6 mm neck, five-slot
  comb, round island, star, L, square-plus-arm. Plain adaptive (square, triangle) also left 0.
- **Stay-down links (ADR-491).**
  - Link counts: 4 to 130 per program. Longest: 3.097 mm, under the 3.175 mm bit.
  - Every link is at the plunge feed and keeps clear of walls and islands.
  - Full-slot samples at the cutting feed changed by at most +6 % between linked and lifted
    variants.
- **Rest legacy at 40 % and 60 %** (8 mm arm) and **rest at corners:** 0 uncut. The rest pass meets
  at most 121-122 degrees in corners, with no slot at the cutting feed where only corner stock
  remains.
- **Finish allowance (ADR-140 + Amd 1).** Profile-inside with 0.5 mm allowance on an L, a star and a
  4 mm slot: no gouge, and the wall band within 1 mm was fully cut to depth. The slot between D and
  D + 2a follows the depth ladder.
- **Adaptive finishing rings close (ADR-154 Amd 2).** The emitted rings end at their start, e.g.
  `G1 X37.413 Y370.000`.
- **Twin: preview and emitted program.**
  - `buildToolpath` cut length 14,811.3 mm against 14,809.8 mm parsed from the G-code (E1), and
    656.2 against 656.2 mm (E3).
  - The removal grid agrees with the emitted program at the pins and the fin.
- **Determinism (non-negotiable 5).** Island adaptive (441,914 bytes) and stock-aware rest compile
  byte-identical twice.
- **`cleared-capsule-interval.ts`.** Read: the chord-capsule interval is the min/max union of the
  two end disks and the slab. That is correct, because a capsule is convex.
- **Rest roughing direction (ADR-312 item 4).** Read: `enforceCutDirection` is applied in
  `compile-cnc-operation-groups.ts`.

## Design → result table

| Design (settings) | Worst wall clearance | Uncut reachable | Max engagement (contact) | Source |
|---|---|---|---|---|
| 30 mm square, adaptive defaults | -0.001 mm | 0 | 99° finishing corners (KNOWN); rings 39-50°; links ≤ 74° | `zz-f2-plain` |
| Right triangle 30 mm legs, adaptive defaults | -0.001 | 0 | 171° at 45° finishing corners (KNOWN) | `zz-f2-plain` |
| L 40 mm, adaptive defaults → offset fallback | -0.001 | 0 | 180° first ring (offset) | `zz-f2-plain` |
| 100x60, two 20x15 islands, adaptive 1/4" 10 % | -0.001 | **68.2 mm² (8 pins)** | 180° seed slots at plunge feed | E1 (F2-P1-1) |
| 80x60, two 15 mm islands, adaptive 1/8" 25 % | — | **8 crossings 2.244 mm from any centre (> R)** | — | `zz-f2-junction` (F2-P1-1) |
| 60x40, two 10 mm islands at (12,10) and (36,20), adaptive 4 mm 0.5 mm | -0.001 | **13.8 mm² (4 pins)** | 180° seeds at plunge feed | `zz-f2-islands2` |
| 60 / 36 / 18 nested, adaptive defaults | -0.001 | 0 | **169° at F1000 for 104 mm** (nested wall ring) | E2 (F2-P2-1) |
| 30 mm + 10 mm island + 20x9 pocket, 4 mm 0.5 mm | -0.001 | 0 | **170° at F1000** on the second pocket's wall | `zz-f2-islands2` (F2-P2-1) |
| 40 mm square + 8 mm arm, rest 9.525→3.175, 40 % | +0.002 | 0 | 180° (arm slot, by design) | `zz-f2-rest` |
| same, rest 85 % (legacy / stock-aware) | +0.002 / -0.003 | **58.9 / 60.8 mm² fin** | 170° | E3 (F2-P2-2) |
| 6.6 mm arm, rest 60 % | — | **7.36 mm²** | — | E3 |
| Dumbbell / comb / round island / star, offset + raster, linked + lifted | -0.001 | 0 | 180° first rings; links at plunge feed ≤ 3.10 mm | `zz-f2-links` |
| 40 mm square, rest corners (legacy / stock) | +0.002 / -0.001 | 0 | 121-122° | `zz-f2-restcorner` |
| Profile-inside, 0.5 mm allowance (L, star, 4 mm slot) | -0.001 | 0 in the 1 mm wall band | 180° (slot) | `zz-f2-allowance` |

Repro files and emitted programs are in
`C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\f2-repros\`.
Copy them back next to `src/core/cnc/` to run them.

## Not verified

- Tapered ball-nose and V-bit pockets, where the wall width differs from the clearing width
  (ADR-368 Amd 2). They were not compiled here.
- Pocket stepover above 100 %. The field is unbounded by AUD-100-014, and raster rows or offset
  rings may leave strips. Not measured.
- Helical-entry pockets with links beyond the code read, and the helix mechanics, which belong to
  F3.
- Island adaptive with curved islands. The plan refuses them (cells too small for the bit) and falls
  back to offset rings, which were verified clean. Large pockets near the 1,000,000-cell verifier
  budget were not exercised.
- Physical consequences of engagement: chip load against feeds belongs to F4. No air cut or
  material cut was made, and no hardware was operated.
- The 3D viewer's rendering itself. Only its removal-grid twin was compared.

```json
[
  {"id":"F2-P1-1","severity":"P2","area":"cnc-pocket-adaptive","file":"src/core/cnc/adaptive-pocket-islands.ts","line":33,"anchor":"Contract: ADR-154 coverage verifier + Amd 3 Decision 1 (reachable stock); Ground truth: Fusion Adaptive Clearing (stock left only when configured)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Island adaptive cells split at island bounds leave a full-depth stock pin (0.858*R^2) at every interior partition crossing; the final cleanup follows only walls/islands and the 98.5% coverage target certifies it (100x60 two-island pocket, 1/4in bit, default 10%: 8 pins, 68 mm2, coverage 0.9874, no warning). Refuter: P1->P2 (Pro opt-in path; default 1/8in bit never compiled island adaptive in a 6-design sweep; stock left standing, visible in 3D preview)"},
  {"id":"F2-P2-1","severity":"P2","area":"cnc-pocket-adaptive","file":"src/core/cnc/adaptive-pocket-operation.ts","line":80,"anchor":"Twin: verifier plan order (adaptive-pocket-verifier.ts:47,73) vs emission sort by source-region rank; Contract: ADR-154 verified constant-load","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Whole-region wall cleanup is attached to the last planned cell but sequences are re-sorted by source region, so a nested pocket or second pocket gets its wall ring slotted full width at F1000 with a straight plunge at every depth before it is cleared (all defaults: 104 mm at 169 deg); verifier reports 0.498 mm and coverage 1"},
  {"id":"F2-P2-2","severity":"P2","area":"cnc-pocket-adaptive","file":"src/core/cnc/rest-pocket.ts","line":181,"anchor":"Twin: pocket-paths.ts coreRing/remainingPocketCores (July 1.10 fix); Contract: ADR-153 rest machines the modeled remainder; Ground truth: Vectric pocket form adds cleanup when stepover > 50%","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Rest-pocket ring ladder (legacy and stock-aware) stops at the first empty offset with no core ring, so above 50% stepover rest regions keep a full-depth fin (8 mm arm, 9.525->3.175 at 85%: 58.9 mm2; 6.6 mm arm at 60%: 7.4 mm2); no Job Review warning"},
  {"id":"F2-P3-1","severity":"P3","area":"cnc-pocket-adaptive","file":"src/core/cnc/adaptive-pocket-operation.ts","line":150,"anchor":"Contract: ADR-251 pocket climb semantics; ADR-312 item 4 (same physical mapping, chain not reversed)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Adaptive roughing chain is always CCW in machine numbers: Conventional (front-left) or Climb on a mirrored frame rough in the opposite physical direction while helix and finishing ring follow the setting"},
  {"id":"F2-P3-2","severity":"P3","area":"cnc-pocket-adaptive","file":"src/core/cnc/adaptive-pocket.ts","line":36,"anchor":"Contract: ADR-154 (islands block), PROJECT.md H.16 (island-free), ADR-153 (no full-pocket small-bit fallback), AGENTS.md (new decision = ADR)","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Island adaptive (partitions, unmeasured plunge-feed full-width seed slots) and stock-aware rest full-pocket fallback ship with only a Job Review disclosure and no ADR; the accepted ADR-154/ADR-153 text still says the opposite"}
]
```
