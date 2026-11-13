## ADR-258 Amendment 5 - Tabs keep their width off corners, every shape that can cut through does, and Job Review names the shapes that cannot (2026-11-13)

**Status:** Accepted; software-verified through compile, emitted-G-code and Job Review tests,
hardware qualification pending. | **Date:** 2026-11-13

Amends ADR-258 and its Amendment 4 (decision 3's open-path rule). Frame remains the sole ordinary
Start policy gate (PROJECT.md non-negotiable 21): every Job Review change here is a warning.

### Context

CNC audit v3 area N1 (`docs/audits/2026-11-13-cnc-v3/N1-j1-refute-and-tabs.md`) measured every tab
path from the emitted program with two G-code readers that share no code with the CAM, and a
refuter confirmed each finding with a third measure (the holding cross-section). What failed was
the physical bridge, not the tab height:

- **J1-P1-1 (P1, KNOWN K-4 since 2026-09-24).** With n tabs of width W on a bit of cut width D, a
  hole under n·(W + D)/π + D (14.86 mm at the defaults) or a part under n·(W + D)/π − D (8.51 mm)
  rode the tab top all the way round and was never cut through. The full-coverage advisory looked
  at a whole layer, so a small hole beside a larger shape stopped at the tab top in silence. Each
  such loop was also lapped once per level below the tab top (J1-P3-1).
- **N1-P2-1 → P1.** Cut direction (default Climb) moves each loop's start to the middle of its
  longest edge, and tabs were spaced from there at (i + ½)·P/n, which is exactly the corners of a
  square and of any regular polygon with n tabs. A window measured along a path that turns a
  corner leaves a bridge of its chord less the cut width: 3.31 of 6 mm on every square, 1.40 mm on
  a 3-tab triangle. At widths the field allows (1 mm on the ⅛" bit, 2.5 mm on the ¼" bit, and a
  3-tab triangle on the ¼" bit at the default 6 mm) the bridge was gone and the part was cut free
  while Job Review still listed the tabs.
- **N1-P2-2 → P1.** An outline that stops 0–3 mm short of its start, cut On path or Outside with
  Tabs on, got no tab (Amendment 4: open paths take none) and no warning. The bit sweeps the gap,
  so the part came free; the same cut with Tabs off warned that it would.
- **N1-P2-3.** A lead joins its ring at the seam, at the pass depth. The seam lay midway between
  two tabs, so on a small hole the lead's cutter swept through-depth material beside both: a 16 mm
  hole held by 3.28 mm instead of 5.2 mm bridges, and a 5 mm lead radius erased both seam tabs of an
  18 mm hole.
- **P3s.** A shape whose offset split into two loops gave each the full tab count and copied a
  dragged tab onto every loop (N1-P3-1). "Edit positions" seeded handles mid-edge while the job cut
  its tabs on the corners, so one click changed the program (N1-P3-2). The Tab height tooltip and
  tutorial said "from the cut floor", though a set stock measures it from the stock bottom
  (N1-P3-3).

### Decision

1. **Automatic tabs keep off corners** (`cnc-tab-placement.ts`). Tabs stay evenly spaced, but the
   phase is chosen: the one whose windows lose the least chord, then the one whose tabs sit deepest
   in their straight runs (a longer window's chord loss), then the old half-spacing phase, so a
   curve keeps its old places. A window still turning a corner is nudged along its own share of
   the loop, never into a neighbour's. A square, a rectangle, a triangle and a hexagon get their
   tabs mid-edge whatever the seam.
2. **A loop gets as many tabs as still let it cut through** (J1-P1-1, as ADR-258 intended for
   loops too short for their tabs). The count is the largest n' ≤ the set count with
   n'·(W + D + 0.1 mm) ≤ the loop's length. Only a loop too short for one window rides the tab top,
   the AUDIT A5 property, and it is cut once at the tab top, not again on every level below it
   (J1-P3-1). Hand-placed tabs are cut where they are.
3. **Every level of a tabbed loop starts in the middle of the tab nearest its seam**, so all its
   leads join at one place and, below the tab top, run at the tab top, above every bridge
   (N1-P2-3). `profile-lead-tab-seam.ts` does the same for any other tabbed ring (finishing passes,
   inlay plugs) as the lead is laid. The ring drops to the cut depth at the tab's own wall, the
   vertical move every tab already makes, so no new mark lands on the wall.
4. **An open outline the bit closes is tabbed as the loop it makes** (revises Amendment 4 decision 3
   for this case). When its ends lie closer than the cut width at full depth, around an area larger
   than the bit's footprint, the bit sweeps the gap and frees the part exactly as a closed loop
   does. Its tabs are planned on the closed loop, but it is still cut from its first point to its
   last; the gap is never fed and it takes no lead. An open path whose ends lie further apart keeps
   the Amendment 4 rule (no tab): the material across its gap holds it.
5. **One outline split into several loops shares its tabs**: "Tabs per shape" is divided between
   the loops by length, at least one each, and a dragged tab goes on the loop nearest it only. A
   loop of that outline with no dragged tab keeps automatic tabs, so its slug is not freed
   (N1-P3-1).
6. **"Edit positions" seeds the handles from the same placement** the compiler uses, planned on the
   outline as placed with the layer's tab and cut widths, so opening the editor changes nothing on
   polygons (N1-P3-2). On a curve the seam the compiler starts from can differ from the outline's
   first point, so the seeded tabs may sit rotated by part of a spacing; the bridges are the same.
7. **Job Review names the shapes whose tabs are not the ones set**, by layer and size
   (`tabHoldShapes` in the compile sidecar, `cnc-tab-hold-warnings.ts`):
   - a hole or part too small for even one tab, which stops at the tab top and is NOT cut through;
   - a loop given fewer tabs than set so that it cuts through;
   - a tab whose bridge is under half the set width because the outline turns or closes in inside
     it (measured from each kerf end to the cut running on from the other, so an acute tip counts);
   - an open outline tabbed as a closed shape (decision 4).
   The per-layer full-coverage advisory stays for a job compiled before this evidence existed and
   for a layer the new evidence names no never-through shape on.
8. **Wording** (N1-P3-3): the Tab height tooltip and the tabs tutorial say the height is measured
   up from the stock bottom when Stock thickness is set, from the cut floor while it is the
   default, and that a tab as thick as the stock is cut half the stock thick.
9. These are warnings only. Nothing blocks Frame, Start or a save.

### Alternatives considered

- **Seed tabs from the un-rotated outline.** Fixes squares only when the outline happens to start
  at a corner; an outline that starts mid-edge has the same problem, and a triangle's or hexagon's
  corners are where (i + ½)·P/n lands from either start.
- **Lengthen each window until its chord is the set width.** Keeps the bridge on a corner, but
  leaves the tab on the corner, the place hardest to clean up, and swallows small loops sooner.
- **Warn only (no placement change).** The audit's minimum; it leaves the default square with
  60 % of its section and parts cut free at allowed widths.
- **Drop the lead on tabbed rings.** Simpler, but ADR-258's point was that tabs and leads coexist;
  a lead at the tab top keeps the plunge in the waste and costs no bridge.
- **Treat any open outline as closed for tabs.** An open line with a real gap is held by the
  material across the gap; closing it would cut that material and add tabs nobody asked for.

### Consequences

- G-code changes for tabbed profile cuts: automatic tabs move off corners (for most rectangles to
  the middle of each edge), every level of a tabbed loop starts in a tab, small loops get fewer
  tabs and now cut through, fully covered loops lose their redundant laps, and open outlines the
  bit closes gain tabs. The emitter revision is not advanced here.
- A small hole that used to stay as a full-thickness skin is now cut through, held by one or two
  tabs. That is what the operator asked for when they cut the hole; the fewer-tabs line says so.
- `splitPassForTabs` (unused by production since ADR-258) still spaces from the start; it is not
  part of any compile path.
- Residual: the automatic count is not shared when one outline's offset splits and another merges
  in the same layer (the split is detected only when a layer has more loops than outlines).

### Verification

- `compile-cnc-tab-holds.test.ts` compiles and emits each audit case and measures the G-code with
  `tab-bridge-measure.test-support.ts` (through-cut pieces of the cuts below the tab top, and the
  narrowest gap between them). On main 14 of its 15 cases fail with the audit's numbers (3.31 mm
  corner bridges, 3.33 against 5.24 mm beside the lead, holes at Z-4.35, one piece where the part
  was cut free); with this amendment:
  - 8 and 12 mm holes in a plate and a 6 mm part beside it reach Z-6.35 and keep a tab; a 5 mm hole
    stays at the tab top and is named by size;
  - a 60 mm square keeps four bridges at the set width with 6 mm and 1 mm tabs, and a triangle on
    the ¼" bit keeps three of 6 mm;
  - open outlines 0.3 and 2 mm short (On path) and 1 mm short (Outside) are held by four tabs; one
    10 mm short stays untabbed;
  - the 16 mm hole with the default lead and the 18 mm hole with a 5 mm lead keep the bridges of
    the leads-off cut;
  - a necked outline split into two loops gets four tabs in all, and a dragged tab lands on its own
    loop only;
  - seeded "Edit positions" handles cut the same tab walls as the automatic job.
- `compile-cnc-tab-coverage.test.ts`: a fully covered loop is cut once at the tab top and never
  below it; a 10 mm square that six 6 mm tabs used to swallow gets five and cuts through.
- `cnc-full-tab-coverage-warnings.test.ts` and `cnc-tab-hold-warnings.test.ts` cover each warning,
  a small hole named beside a plate, and the per-layer advisory on a job without the new evidence.
- No hardware result is claimed.
