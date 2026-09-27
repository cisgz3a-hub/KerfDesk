## ADR-494 - Laser Line tabs by spacing, with a tab power, and placed by hand (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

Builds LBG-C05 from `docs/audits/2026-09-26-lightburn-gap-audit.md`. Extends the automatic Line-mode
tabs of `core/geometry/tabs-bridges.ts`. Laser only: the CNC compiler never reads these settings or
the placed laser tabs, and the CNC holding tabs (`cncTabAnchors`, `core/cnc/cnc-tabs.ts`) are
untouched (ADR-101). No new guard or refusal (ADR-228).

### Context

LightBurn's **Tabs / Bridges** (`Reference/AddTabs/`) places tabs by count or by spacing with a
maximum per shape, lets the operator click tabs onto a shape, and can burn the tabs at a reduced
power so parts hold in the sheet but snap out cleanly. KerfDesk had a count, a size and "skip inner
shapes" only: every closed shape got the same number of tabs, big or small, and the tabs were
always uncut.

### Decision

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

- **Tab power as per-point power inside one segment.** Rejected for the reason ADR-415 rejected
  laser-off moves inside a segment: no output format, estimator or Ruida path carries per-point
  power.
- **A tab-power field on `CutSegment`.** Rejected: every emitter, the preview and both estimates
  would need to read it, for the same output a second group gives.
- **Reuse `cncTabAnchors` for laser tabs.** Rejected: laser and CNC stay separate, and one artwork
  used by both a laser and a CNC operation would share tabs across machines.

### Consequences

- Output changes only for operations that choose spacing, set a tab power or have tabs placed by
  hand. No snapshot changes.
- The canvas hint judges inner shapes within the selected artwork and ignores kerf, so at the edges
  a hollow hint can differ from the compiled job; the preview shows the compiled tabs.
- The tab spans are never perforated: they burn continuously at the tab power.
- Placed tabs are keyed by path colour, so a main operation and its sub-operations on that colour
  share them.
