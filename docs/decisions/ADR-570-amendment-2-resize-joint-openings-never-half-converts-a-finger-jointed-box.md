## ADR-570 Amendment 2 - Resize Joint Openings never half-converts a finger-jointed box (2026-11-14)

**Status:** Accepted. | **Date:** 2026-11-14

### Context

ADR-570 makes vector changes reviewable, and its KXS-09 entry bounds Resize Joint Openings to
"bounded rectangular openings and orthogonal U-notches": ambiguous features stay unchanged and
uncertain geometry is shown, not guessed. Since bc4cd9eba (LightBurn parity D063) the tool also
finds outward tabs whose depth is the current thickness, and so offers the fingers of a
finger-jointed box. Tools audit T1 found three defects in it (T31, 2026-11-13; refuter grades):

- **T31-P1-1 (P2).** A box's fingers are offered, but only the fingers with a straight edge on
  both sides are found. The finger at each panel corner, and the notch between two corner fingers,
  are never candidates. A Box Generator box 80×50×40 at 3 mm, resized to 4 mm with every
  candidate selected, kept 8 of 20 joint steps on Bottom and Top at 3 mm, and Front/Back came out
  86×48 instead of 88×48. The box no longer assembles, and nothing said so. The dialog says
  "general thickness conversion require[s] explicit design edits", and the tutorial says the tool
  does not resize finger-joint depth; the Box Generator is the documented way to change a generated
  box's thickness.
- **T31-P1-2 (P2).** Tabs placed by hand keep their share of the contour's length (ADR-156) while
  the resize changes that length, so they slid along edges the edit never touched: up to 18.4 mm
  on a 300 mm panel with 25 fingers, one onto a finger corner, with no notice.
- **T31-P2-1.** Whether a feature stood out of the material or cut into it was read from the
  contour's own winding. On a cutout that is backwards: a keyway was deepened as a tab, a tooth of
  material was widened as a slot, and a rectangular part lying in another part's cutout was
  widened as an opening.

Two ways out of P1-1 were open: resize a box's joints whole (corner fingers move in two
directions, notch floors by depth), or recognise the case and leave it unchanged with a notice.

### Decision

1. **A finger-jointed outline is resized whole or not at all.** After detection, each outline
   with candidates is checked for *joint steps* none of them moves: edges of the current width
   between one corner turning each way (a finger's or a notch's flank). A shoulder lying on a found
   tab's root line, beside the end finger of an edge, is part of that edge, not a step. If any
   step is left, every candidate on that outline is withheld and the review names the object and
   the count: "a corner finger or the notch beside it cannot be resized with the rest … Change a
   finger-jointed design where it was made." An outline whose every step belongs to a candidate,
   such as a panel whose corners are notches, still resizes, so LightBurn-style tab resizing keeps
   working on imported parts.
2. **Box Generator panels are refused.** A panel the Box Generator placed (its `source` starts with
   `Box panel: `, now `src/core/box/box-panel-source.ts`) is excluded with a notice to generate the
   box again at the new material thickness. Its other panels must change with it, and the
   generator already does that exactly. This is the KXS-09 rule, not new scope: the tool stays a
   bounded edit, and converting a whole box remains the generator's job.
3. **Placed tabs stay put.** The resized object goes through `withTabsFollowingEdit` (ADR-494
   Amendment 2), as node edits, fillet and Optimize Shapes do. A tab on an untouched edge keeps its
   exact place; one on a resized part moves to the nearest point of the new outline. Apply now
   toasts "Resized N joint features." and adds Amendment 2's moved-tab sentence when any moved.
4. **Material side comes from nesting.** A contour held by an odd number of the object's other
   contours is a cutout (even-odd, like the fill), so its bulges are openings and its dents are
   tabs of material. An enclosed rectangle is an opening only at odd depth, so a part lying in a
   cutout is left alone.
5. **Smaller fixes (T31 P3s).** A width exactly at the tolerance edge matches (1 µm slack over the
   tolerance). A tab candidate carries its own width and depth (the request measures its depth),
   the list names objects by name, the summary line says what stays fixed for tabs, and the fields
   follow the display unit. The tutorial and help mention tabs and point a box to the Box
   Generator.

### Consequences

- Converting a whole imported box (boxes.py, MakerCase) to a new thickness is still not offered:
  outlines with corner fingers are left out with a notice. Implementing LightBurn's separate slot
  depth and tab height modes, corners included, would be a new decision.
- An imported part with an incidental step of exactly the current width beside a found feature is
  also left out. The notice names it, and the user can change the current width or edit the nodes.
- Tests: `src/core/geometry/joint-resize-t31.test.ts` holds each audit repro with an analytic
  oracle (placed tab positions, opening edges, joint-step depths of a generated box) and fails on
  the code before this amendment.
