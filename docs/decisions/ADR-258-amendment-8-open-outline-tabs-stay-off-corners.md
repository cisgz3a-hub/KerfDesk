## ADR-258 Amendment 8 - An open outline's tabs keep the corner-avoiding plan, and the CNC P3 sweep (2026-11-14)

**Status:** Accepted; software-verified on emitted programs, hardware qualification pending. |
**Date:** 2026-11-14

Amends ADR-258 Amendment 7 (it reverses decision 2). Frame remains the sole ordinary Start
policy gate (PROJECT.md non-negotiable 21): every Job Review line here is a warning or a finding.

### Context

CNC audit v3 N8 re-measured #1903 (Amendment 7) and found a regression, N8-P2-1, which it raised
to P1. Amendment 7 decision 2 moved an open outline's tabs off its gap by shifting **every**
window by one amount. On a square or L opened at mid-edge, half a tab spacing is a corner, so
every tab landed on one, and the corner-avoiding plan of Amendment 5 was thrown away. Measured
through 6.35 mm on the ⅛" bit:

| Case | Before #1903 | After #1903 | What Job Review said |
| --- | --- | --- | --- |
| 60 mm square, gap 1 mm, default 6 mm tabs | 6.00 mm | 3.27 mm | nothing |
| 60 mm square, 1.5 mm tabs | 1.50 mm | 0.09 mm | (the cases that held) |
| 8–16 mm squares, 0.5–1 mm tabs | held | cut free | "is given holding tabs" or "as little as 0 mm" |
| 80 mm L, 2 mm tabs | 2.00 mm | 0.44 mm | — |

The decision's premise was that a window over the gap "would hold nothing". That is wrong. The
cut rides the tab top from the window's edge to the outline's end, so each kerf still stops at a
window edge. The material between the kerf ends is the window less the cut width, as on any
other tab, with or without a sliver. Before #1903, a tab over a 1 mm gap held a full 6.00 mm.

The audit also asked for the remaining CNC P3s:

| Finding | Asked for |
| --- | --- |
| J1-P3-1 | Don't re-cut a fully tabbed loop at the tab top on every level. |
| J1-P3-2 | Note the seam left by an inlay fit gap wider than the glue gap. |
| N1-P3-1 | Don't give every loop of a split offset the full tab count, or copy a dragged tab to every loop. |
| N1-P3-2 | Don't let "Edit positions" seed new positions that change the program. |
| N1-P3-3 | Fix the "from the cut floor" wording. |

### Decisions

1. **Open outlines keep the closed loop's plan.** The tabs of an open outline that the cut frees
   (Amendments 5 and 7) are placed exactly as the closed loop's are, by the corner-avoiding plan
   of Amendment 5, gap or no gap. A tab may span the gap. `planClearOfGap` is removed.
2. **The advice fits an open outline.** Tab-hold findings carry `openOutline` for an open outline.
   Its narrow-bridge line now says "Close the open outline with Tools > Join paths and drag its
   tabs to straighter edges, or use narrower tabs" instead of pointing to Edit positions, which an
   open outline has no handles for.
3. **J1-P3-2: the inlay names its seam.** The plug closes its radial fit gap by sinking
   fit ÷ tan(half the V-bit angle) past engagement. When that is deeper than the glue gap, the
   plug bottoms out first. A new inlay finding then names:
   - the depth at which the gap would close;
   - the seam left, fit − glue × tan(half angle) per side;
   - the two fixes: raise the glue gap, or lower the radial fit gap.
4. **J1-P3-1, N1-P3-1, N1-P3-2 and N1-P3-3 are already fixed** by #1889 (Amendment 5):
   - J1-P3-1: a covered loop is cut once, on the tab-top level (`cnc-tabbed-contour-passes.ts`;
     `compile-cnc-tab-coverage.test.ts`).
   - N1-P3-1: split loops share the tab count, and a dragged tab goes to its nearest loop only
     (`splitLoopTabCounts`, `manualTabCentersForToolpaths`; `compile-cnc-tab-holds.test.ts`
     "N1-P3-1").
   - N1-P3-2: Edit positions seeds the compiled positions (`compile-cnc-tab-holds.test.ts`
     "N1-P3-2").
   - N1-P3-3: the Tab height tooltip and tutorial say "measured up from the stock bottom when
     Stock thickness is set … A tab as thick as the stock is cut half the stock thick"
     (Amendment 6 refined it to "until it is set").

### Alternatives considered

- **Move only the window that touches the gap.** The audit suggested this. It is unnecessary,
  because that window already holds its full width. Moving it would also need its own
  corner-avoiding search.

### Consequences

- An open square, L or rectangle keeps tabs of its set width wherever its gap lies.
- An outline opened at a vertex or mid-edge holds the same as its closed twin.
- An inlay that cannot close its walls says so before it is cut.

### Verification

- `src/core/cnc/compile-cnc-tab-gaps.test.ts`, "N8-P2-1", measures the emitted G-code with its own
  reader. Each case's holding section is its bridge × the 2 mm tab height. All 7 cases fail on
  main.
  - A 60 mm square opened at mid-edge keeps four pieces and bridges over 5.9 mm:
    - gap 1 mm, Outside;
    - gap 1 mm, On path;
    - gap 2.5 mm, On path.

    Main: 3.27 mm.
  - An 80 mm L with 2 mm tabs bridges over 1.9 mm. Main: 0.48 mm.
  - Squares held with narrow tabs:
    - 60 mm with 1 mm tabs;
    - 10 mm with 1 mm tabs;
    - 8 mm with 0.5 mm tabs.

    Each is held, with bridges within 0.1 mm of the tab width. Main: cut free.
- The Amendment 7 cases still pass: gaps of 3.2–4.5 mm tabbed, small holes not named, the wedge
  named.
- `src/ui/laser/cnc-tab-hold-warnings.test.ts`: an open outline's narrow-bridge advice.
- `src/core/cnc/tapered-inlay.test.ts`: a 0.4 mm fit gap on a 60° bit closes at 0.693 mm, past the
  0.5 mm glue gap, leaving a 0.111 mm seam. The default fit gap gets no such line.
