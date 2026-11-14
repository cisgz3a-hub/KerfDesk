## ADR-480 Amendment 7 - The rubber-band outline cuts along a line, with the operation shown and picked in a dialog (2026-11-14)

**Status:** Accepted. Amends ADR-480 Decision 3 (Rubber-Band Outline). Fixes tools audit T1
findings T34-P1-1 (P1), T34-P2-1 and T34R-P2-1 (P2), and T34-P3-1, T34-P3-2 and T34-P3-3 (P3)
(`docs/audits/2026-11-13-tools-t1/LEDGER.md`). Tested on emitted G-code, read back by an
independent decoder; not burn- or cut-tested. The hull itself, the variable-data guard (ADR-350
Amendment 2), Offset Shapes, Frame, Start, output policy and licences are unchanged. |
**Date:** 2026-11-14

### Context

Decision 3 gave the outline "a copy of the first selected artwork's Line operation settings (the
ADR-103 offset rule), or a new Line operation named Outline". The code tested only the root
operation's `mode === 'line'`, took the first source in scene order, and gave the copy none of the
source artwork's own settings. The T34 auditor and refuter reproduced on main eeac725e8:

- **CNC (T34-P1-1).** Every CNC operation has mode `line`; Pocket, Profile and V-carve differ only
  in `cnc.cutType`. So the Outline fallback never ran in CNC and the outline copied whatever cut
  type it found. V-carve sign text selected alone made the outline V-carve the whole hull: 82,512
  mm of toolpath, 5.196 mm deep, about 1,875 mm² swept, where a cut around it is 748.6 mm. A
  pocket drawn before the cut-out made the outline pocket the hull (4,773.6 mm) instead of
  profiling it (1,136 mm), even when the user selected the cut-out first. The design canvas draws
  a plain line; the cut type showed only as a label in the Cuts list and Job Review.
- **Fill sub-operation (T34R-P2-1).** A Line operation with an enabled Fill sub-operation was
  copied whole, so the outline hatched the hull: 480 mm of burn became 2,220 mm, 1,600 mm of it
  hatch across the gaps between the parts.
- **Settings (T34-P2-1).** A source burning at F250/S760 through its own override and power scale
  gave an outline at the operation's base F1200/S250, where Offset Shapes from the same source
  keeps F250/S760. No ADR allows that; ADR-350 Decision 2 drops overrides only for Union
  Silhouette, with an explicit operation choice. An output-off guide drawn first gave an outline
  that never burned, under a success notice.
- **Notices (T34-P3-1, T34-P3-2).** The variable-text notice did not say the outline leaves the
  text out. The "no area" test used area (1e-4 mm²), so a 0.008 mm square was refused as "on one
  straight line" while a 50 × 0.0015 mm sliver was outlined.

### Decision

1. **Only an operation that cuts along a line is copied.** A source operation qualifies when its
   own mode and every enabled sub-operation's mode are Line, and, in a CNC project, its cut type
   is a Profile (Outside, Inside or On path). Fill, Image, Pocket, V-carve, Engrave, Drill, Inlay
   and Relief operations are never copied.
2. **Otherwise a new "Outline" operation.** It is Line on a laser and an **Outside-path** Profile
   with the default CNC settings in a CNC project. Outside, not the ADR-256 On-path default,
   because the hull touches the outermost parts: an On-path bit would cut half its width into
   them.
3. **The copy keeps the source artwork's own settings.** The outline carries the source artwork's
   operation override and power scale into the copy, as Offset Shapes does (ADR-410 Decision 3,
   `offset-shapes.ts`), so it burns like the artwork it was taken from.
4. **A dialog shows and picks the operation.** Tools → Vector → Rubber-Band Outline opens a dialog
   with one list, "Cut the outline with": the qualifying operations of the selected artwork in the
   order the artwork was selected, then "New operation “Outline”". The default is the first
   choice whose output is on, so selection order, not scene order, decides (T34-P3-3), and an
   output-off guide is not chosen by default. Operations that do not qualify are named as not
   offered, with the reason. Choosing an output-off operation is warned in the dialog, and a
   warning notice follows the success notice. This matches Union Silhouette's result-operation
   list (ADR-350 Decision 2), and Offset Shapes' list from the T33 fix is meant to read the same.
5. **Notices.** The success notice names the operation ("cut with a copy of “cut”, with the
   artwork's own settings" or "cut with a new operation “Outline”"). The variable-data notice
   adds "The outline does not go round it." A hull narrower than 0.01 mm, measured as the convex
   polygon's width, is refused with "it lies on one straight line or is too small", so a tiny
   square and a thin sliver are judged alike.
6. **Tests.** `rubber-band-outline-operation.test.ts` drives the real store action and reads the
   emitted G-code with its own decoder (`rubber-band-outline-test-helpers.ts`): CNC toolpath length
   and depth against the copied-operation oracle, laser F/S pairs and lit length. The CNC,
   settings, output-off, Fill and selection-order cases fail on main.

### Alternatives

- **Refuse the tool when no selected operation qualifies.** Rejected: an outline round engraving
  or V-carved text is the tool's commonest use, and Decision 3 already promised a new operation.
- **Keep the On-path default for the new CNC operation.** Rejected for the reason in Decision 2.
- **Copy base settings only, as Union Silhouette does.** Rejected: the outline is meant to cut like
  the artwork's own outline, and Union Silhouette drops overrides only because it merges sources
  with different settings, with a dialog that says so.
- **Include the variable template's extent in the hull.** Not done: ADR-350 Amendment 2 keeps
  variable data out of every geometry tool, and the notice now says so. Left for the maintainer.

### Consequences

- The menu entry opens a dialog instead of acting at once; one more click for the common case.
- An existing project is unaffected: only new outlines take the new rule.
- `addRubberBandOutline(operationId?)` takes the dialog's choice; without one it uses the default,
  so scripted and test callers keep working.
