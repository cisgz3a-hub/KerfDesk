## ADR-494 - Closed-shape starts and laser tabs, LightBurn gap batch 7 (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

Builds LBG-C04 and LBG-C05 from `docs/audits/2026-09-26-lightburn-gap-audit.md`, the next two items
of its build plan, under the owner's standing direction to build every gap and make it better than
LightBurn (2026-09-24, restated 2026-09-26; "continue" on 2026-09-27). Both are laser only and both
are off by default: an existing project emits the same G-code. No new guard or refusal (ADR-228).

PROJECT.md listed "manual tabs / bridges" among the features to reject without a PROJECT.md revision
and a decision; this ADR is that decision, and PROJECT.md now lists laser tabs placed by hand as
shipped. CNC already had tabs placed by hand (`cncTabAnchors`).

### Context

LightBurn behaviour as the gap audit recorded it from LightBurn's documentation (read 2026-09-26,
`https://docs.lightburnsoftware.com/latest/Reference/`):

- **Optimization Settings** (`OptimizationSettings/`): **Choose best starting point** lets a closed
  shape start at the point nearest the head instead of where it was drawn, and **Choose corners**
  prefers corners for that start, where the start/stop mark shows least.
- **Tabs / Bridges** (`AddTabs/`): tabs by count or by spacing with a maximum per shape, tabs
  clicked onto a shape, and a tab cut power so tabs hold parts in the sheet but snap out cleanly.

KerfDesk started every closed shape where it was drawn (`segment-order.ts` offered one entry per
closed segment). Laser Line tabs had a count, a size and "skip inner shapes" only: every closed
shape got the same number of tabs, big or small, and the tabs were always uncut.

### Decision: where closed shapes start (LBG-C04)

A. **One project setting.** `ProjectOptimizationSettings.closedShapeStart`: `'drawn'` (default),
   `'nearest'` or `'nearest-corner'`, in **Tools → Cut Planner** as **Start closed shapes** (Where
   drawn, Nearest point, Nearest corner). Optional in files: the validator accepts the three values
   and the loader fills `'drawn'`. No schema bump: an older build starts closed shapes where drawn,
   which cuts the same outline.
B. **Candidates.** `'nearest'` offers every vertex of a closed shape; `'nearest-corner'` offers its
   corners, vertices where the path turns by at least 30°, reading each direction over 0.05 mm of
   path so a densely sampled curve has none; a shape without a corner offers every vertex
   (`core/job/closed-shape-start.ts`). The test uses exact arithmetic (cos² 30° = 0.75), so every
   platform agrees.
C. **Inside the indexed planner.** The nearest-neighbour search (`segment-entry-index.ts`) gets one
   entry per candidate, and the picked shape is rotated to start there (`rotateClosedCutSegment`).
   The tie-break grows a fourth key, the vertex index, so the drawn start wins exact ties and
   `'drawn'` offers exactly the entries it always did. Retired entries are dropped as queries meet
   them, so ordering stays close to linear in vertex count (200,000 vertices planned in 0.1 to
   0.2 s in a local measurement). Inside-first buckets, layer order and open shapes are unchanged.
D. **Keep source order** keeps order and direction; each closed shape starts at its candidate nearest
   where the previous one ended, the first nearest the Planning start.
E. **Arcs are kept.** A shape carrying ADR-432 arc moves only offers vertices a move also ends on,
   and the moves rotate with the polyline; a rotation that would lose arcs is not offered. Sharp
   corners are always move ends, so Nearest corner works on arc machines; Nearest point there has
   fewer choices.
F. **Scope.** Line cut groups and Offset Fill rings, the groups the planner already orders. Overcut
   (ADR-415) is applied from the ordered polyline, so it runs past the new start. Fill, Image and CNC
   output never change. Preview, both estimates, Job Review, Frame, Ruida and tiled saves read the
   same prepared job, and the canvas plan key already serialises the whole optimization object.

### Decision: laser tabs (LBG-C05)

1. **Four optional operation settings.** `tabLayout` (`'count'` or `'spacing'`), `tabSpacingMm`
   (default 50), `tabMaxPerShape` (0 is no limit) and `tabCutPowerPercent` (0 to 100, default 0) join
   `LayerOperationSettings`, artwork overrides and sub-operations. Absent means count, uncut: the
   behaviour before them, byte for byte. Like the ADR-415 settings they are captured only when set,
   so saved process recipes keep their key set, and Copy and Paste settings carries them. Material
   presets do not store them: tabs are a design choice, and applying a preset keeps what the
   operation has.
2. **Spacing.** A closed contour the automatic rule picks gets `max(1, round(perimeter /
   spacing))` tabs, capped at `tabMaxPerShape` when that is above 0, spread evenly with the first
   half a gap from the start, as count mode spreads them. Count mode runs through the same code with
   the same centre expression and interval pipeline, so existing tabbed jobs compile unchanged
   (`core/geometry/tab-layout.ts`, `core/job/line-tabs.ts`).
3. **Tab power.** A Line group has one power, so the tab spans of an operation's artwork burn as a
   second Line group straight after its cut group, at `tabCutPowerPercent` of the cut power, with
   the same speed, passes, air, power mode and contour entry, and no overcut
   (`lineTabSpanGroups`). The group records `tabSpanPowerPercent`; the GRBL group comment says
   `tab spans at N% of cut power` and Job Review names it "Line tabs (N% of cut power)". The pair
   shares its operation and artwork, so layer priority reversal (which keeps order within an
   operation), Run order, the preview, both time estimates, Frame bounds (the spans lie on the
   contour), Ruida (one part per group) and Marlin and Smoothieware (GRBL emission) all follow
   without change. At 0 no group is added and nothing changes.
4. **Tabs placed by hand.** `SceneObject.laserTabAnchors` holds tabs placed on the artwork, with the
   CNC anchor's shape: `layerColor` (the path colour), `pathIndex`, `polylineIndex` and a normalized
   `pathT` along that source contour. Where a contour has placed tabs they replace its automatic
   tabs, eligible or not; other contours and other artwork keep automatic tabs. They apply only
   while the operation has tabs on. With a kerf offset each offset contour takes the placed tabs of
   the source contour nearest it, and a tab goes to the nearest offset contour of that source only.
   Move, rotate, scale, copy and paste, break apart, recolour, path join and text re-edits carry
   them as they carry `cncTabAnchors`.
5. **The tab tool.** **Place tabs** (Cut Settings → Line detail → Tabs / Bridges) applies the
   settings and starts the tool for the one selected, unlocked artwork using the operation; it is
   disabled with the reason in its tooltip otherwise. On the canvas a click on the outline adds a
   tab, a click on a tab removes it and a drag moves it, each one undo step. Placed tabs draw
   filled and the automatic tabs they would replace draw hollow. A hint on the canvas repeats how
   it works, counts the placed tabs and offers **Clear placed tabs** and **Done**; Esc also leaves.
   **Clear placed tabs** in Cut Settings returns the artwork to automatic tabs.
6. **Job Review** reads e.g. "tabs every 50 mm (at most 6) × 0.5 mm, cut at 20%" or "tabs 4 × 0.5 mm,
   3 placed by hand". An operation that never set them reads as before.
7. **No project schema bump.** An older build ignores the new settings and `laserTabAnchors`: it
   places tabs by count and leaves them uncut. That is the output it always gave, and it never cuts
   a part free that the new build would hold, so the ADR-415 precedent (bump when an older build
   would cut through what the new one keeps) does not apply. The reasoning also sits where the
   fields are declared.

### Alternatives

- **Closed-shape start as a per-operation setting.** Rejected: LightBurn keeps it with the other
  optimization settings, and the planner reads project settings; one choice per project is what the
  operator reaches for.
- **Split arcs to start anywhere.** Rejected for now: re-fitting or splitting an arc changes the
  burned curve's representation; limiting starts to move ends keeps the fitted output exact.
- **Tab power as per-point power inside one segment.** Rejected for the reason ADR-415 rejected
  laser-off moves inside a segment: no output format, estimator or Ruida path carries per-point
  power.
- **A tab-power field on `CutSegment`.** Rejected: every emitter, the preview and both estimates
  would need to read it, for the same output a second group gives.
- **Reuse `cncTabAnchors` for laser tabs.** Rejected: laser and CNC stay separate, and one artwork
  used by both a laser and a CNC operation would share tabs across machines.

### Consequences

[ADR-486 Amendment 2](ADR-486-amendment-2-topology-before-process-settings.md) adds whole-run automatic tab parity and parent main-pass/tab-pass ordering for new inside-first Jobs; source-order and historical Jobs retain this decision's original process-group route.

- Output changes only for projects that choose a closed-shape start other than Where drawn, and for
  operations that choose spacing, set a tab power or have tabs placed by hand. No snapshot changes.
- The seam hides only where a shape has a corner; round shapes start at their nearest point.
- The canvas hint judges inner shapes within the selected artwork and ignores kerf, so at the edges
  a hollow hint can differ from the compiled job; the preview shows the compiled tabs.
- The tab spans are never perforated: they burn continuously at the tab power.
- Placed tabs are keyed by path colour, so a main operation and its sub-operations on that colour
  share them.
- Automatic tabs are still spread evenly along the perimeter and can land on a corner, as before.
  The CNC gap audit found the same for CNC holding tabs (CW-05); moving tabs off corners is left to
  one deliberate change for both heads rather than a side effect of this batch.

### Verification

- `closed-shape-start.test.ts`, `cut-arc-rotation.test.ts`, `optimize-paths-closed-start.test.ts`,
  `closed-shape-start-output.test.ts`, `segment-entry-index.test.ts`: byte-identical default output
  (absent field, older file, with and without arcs, both travel policies), nearest and corner picks,
  circle fallback, tie determinism, source-order starts, inside-first order, overcut past the new
  start, G2/G3 kept after rotation, CNC untouched, an exhaustive-scan fuzz of the index.
- `line-tabs.test.ts`, `compile-job-laser-tabs.test.ts`, `laser-tab-anchors.test.ts`,
  `project-laser-tabs.test.ts`, `CutSettingsDialog.laser-tabs.test.tsx`, `laser-tab-actions.test.ts`,
  `laser-tab-editor.test.ts`, `job-review-laser-tabs.test.ts`: spacing counts and cap, count mode
  unchanged, tab spans at the tab power in G-code, the preview and the estimate, 0 % unchanged,
  placed tabs on one object only, anchors through transforms, copy and paste and break apart,
  validator ranges, the dialog, the store actions and the canvas tool.
- Nothing here has run on a real machine.
