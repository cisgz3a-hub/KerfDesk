## ADR-494 Amendment 2 - Delete node and Radius / Fillet keep tabs placed by hand where they were (2026-10-28)

**Status:** Accepted; software-verified through unit tests. | **Date:** 2026-10-28

Amends ADR-494 Amendment 1, whose Decision 3 keeps placed tabs in place through the Edit nodes
**Start** and **Break** but names neither **Delete** (a node) nor **Radius / Fillet**, which also
redraw a closed contour from another point. Output changes only where one of those two edits used
to move a tab placed by hand. No project schema change, no new guard or refusal (ADR-228).

### Context

A tab placed by hand, laser (`laserTabAnchors`) or CNC (`cncTabAnchors`), is stored as a fraction
`pathT` of one contour's length, measured from that contour's start (ADR-156). Amendment 1 requires
any command that changes where a contour starts to keep each tab at the same physical place, or
deliberately handle it. Rolling audit v7 (finding L6-P1-1, P1, confirmed by a refuter on real GRBL
and CNC output) found two path edits that did neither.

- **Delete node** on a closed contour's start node restarts it at the next kept node
  (`deleteCurveNodes` returns `start: anchors[kept[0]]`; the polyline Delete does the same). Every
  tab kept its fraction, so it moved round the part by the deleted node's share of the outline.
  On a 40 × 20 mm part drawn from the middle of its bottom edge, deleting that redundant node left
  the outline identical but moved the laser tab gap from the bottom edge to the right edge and the
  CNC tab from the top edge to the left one, 14.42 mm each; on a Ø50 mm circle about 35 mm.
- **Radius / Fillet** that rounds a contour's start corner starts it where the arc ends
  (`replaceCorner`), and **Remove** does the reverse. An r 5 fillet on every corner of that part
  moved both tabs 4.14 mm along their edges. A fillet on other corners shortens the outline, so
  even then tabs on untouched edges shifted by their share of the change (0.22 and 0.86 mm).
- Neither said anything. Placed tabs are drawn only while a tab tool is open, so on screen nothing
  changed while the burn and the cut did.

### Decision

1. **Delete node and Radius / Fillet re-measure each placed tab where it was.** After the edit,
   each laser and CNC tab on a contour the edit changed is placed at its old position, measured in
   the artwork's own coordinates on the same flattened outline the output reads
   (`withTabsFollowingEdit`, `core/geometry/edited-tab-anchors.ts`). A tab whose place is still on
   the outline keeps it exactly. A tab whose place the edit removed (on a deleted bump, in a corner
   the fillet cut off, on a curve the merge refitted) moves to the nearest point of the new
   outline on the same contour. Tabs on contours the edit left unchanged keep their anchors bit for
   bit. A contour held open by Break is measured with its closing line, as Amendment 1 does.
2. **The toast says when a tab moved.** When a tab's old place lies more than twice the machine
   flattening tolerance (0.05 mm) from the new outline, Delete pushes "N placed tab(s) sat on the
   changed outline and moved to the nearest point of it. Undo restores them.", and Radius / Fillet
   adds the same sentence to its "Rounded N corners." toast. A tab that stayed in place says
   nothing.
3. Both edits remain one Undo step, which restores the anchors with the outline.

### Consequences

- Deleting a start node no longer moves any tab on an outline that did not change; on the audit's
  part every laser and CNC tab stays within 1e-9 mm, and the compiled GRBL tab spans and CNC tab
  rises are where they were.
- A fillet keeps every tab on a straight side in place, whether or not it rounds the start corner:
  the laser tab spans are unchanged to 1e-9 mm and the CNC tab rises to under 0.001 mm. This also
  removes the small shift a fillet on other corners used to cause.
- A tab on the part of an outline a node delete refits moves only by the refit's own change: on a
  four-node circle, under 0.3 mm.
- Unchanged: Smooth, Corner, Curve and Line, and dragging a node or a handle, still keep each tab's
  fraction (Amendment 1, Consequences). They reshape a contour without restarting it.

### Verification

- `src/ui/state/path-node-delete-fillet-tabs.test.ts`: deleting the redundant start node of the
  40 × 20 part keeps every laser and CNC tab within 1e-9 mm, and its compiled GRBL tab spans
  (1e-9 mm) and CNC tab rises (1e-6 mm) match the part before the delete, with no toast; on a
  four-node circle tabs on the untouched quarters stay within 1e-9 mm and those on the refitted
  half within 0.3 mm; an r 5 fillet on every corner keeps the tabs on straight sides within
  1e-9 mm and the compiled tab spans and rises in place (under 0.001 mm for the re-offset CNC
  profile), toasting only "Rounded 4 corners."; a tab in a corner the fillet cuts off lands on the
  arc, the toast names it, and Undo restores the anchors. With the remap disabled the four tests
  fail by 14.42, 35.40, 4.14 and 0.12 mm.
