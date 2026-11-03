## ADR-480 Amendment 2 - A cut that runs before the engraving inside it is warned, with Cut last one click away (2026-11-03)

**Status:** Accepted. Amends ADR-480 Decision 8 (Sort cuts last). Fixes UX audit U3-P2-4 (P2,
`docs/audits/2026-11-03-ux-u1/U3-first-design.md`). Tested on the compiled job and in Job Review's
own component; not burn-tested. Frame, Start, output policy and licences are unchanged. | **Date:**
2026-11-03

### Context

Run order follows the order the artwork was made (ADR-211). A beginner who draws a coaster outline,
sets it to cut (100 %, 300 mm/min), then adds a name inside it, burns the cut first and the name
second. On a honeycomb bed the cut-free part can drop or shift before it is engraved. Sort cuts
last (Decision 8) fixes it, but only as an icon in the All operations header, and nothing told the
beginner to use it.

LightBurn 2.1's Cuts / Layers page (`docs.lightburnsoftware.com/2.1/Reference/CutsLayersWindow/`,
fetched by the audit's refuter on 2026-11-03) says layers run "in the order from top to bottom",
that **Sort Cuts Last** pushes "all Line Mode layers to the end", and that "it's therefore best to
engrave images and marking/scoring lines before any cuts through the material". LightBurn does not
sort on its own; it advises. Where a new LightBurn layer lands in the list is not stated in its
docs.

### Decision

1. **Job Review and Save G-code warn.** "Cut runs before the engraving inside it: "Ellipse" runs
   before "Hi". Once a part is cut free it can drop or shift, and the engraving lands in the wrong
   place. Engrave first and cut last: use Cut last, or change the run numbers in Run order." It is a
   job-intent warning (`cut-order-warnings.ts`), so both surfaces get the same words, and it never
   gates Start (PROJECT.md rule 21).
2. **What counts.** The check reads the compiled job (`cut-before-engraving.ts`), so it follows the
   exact burn order, per-artwork overrides and sub-layers included. A Line group's closed contour is
   an outline. Any later group whose burn box sits inside that outline's box, with its centre inside
   the outline itself, is inside it. It is flagged when it is weaker than the cut by Sort cuts last's
   own measure (power × passes ÷ speed): Fill, Image, or a lighter Line such as a score. So a light
   score frame around an engraving is not called a cut, and two equal starter operations are not
   either. A contour cut in pieces (tabs, perforation) holds the part, so it is not an outline. CNC
   is not checked (Decision 4).
3. **Cut last is on the warning's row.** Job Review opens the warning's detail and shows a **Cut
   last** button that runs Sort cuts last: the same one-step, undoable rewrite of the saved orders.
   Job Review rebuilds from the new order as it does after any edit, so the warning clears and the
   new bytes need a fresh Confirm. A frozen second pass replays its reviewed program, so it gets no
   button.
4. **CNC already holds the rule.** `orderGroupsIntoToolSections` runs every clearing group (pockets,
   engraves, V-carves) before every profile, whatever the artwork order, so a profile never frees a
   part before the pocket inside it. Nothing changes there.
5. **New operations are not reordered by default.** Rejected, for three reasons:
   - Whether an operation cuts is decided by its power and speed, and every new laser operation
     starts at the same starter values (30 %, 1500 mm/min), so at creation nothing is a cut yet.
     Reordering as the operator edits power would move Run order under their pointer.
   - LightBurn runs in list order and keeps sorting a command, and advises instead (Context).
   - Existing projects keep their saved order (the returning-user rule, ADR-682 Amendment 3), and a
     second, implicit ordering rule would make the order depend on edit history.

   The warning and its one-click fix are the in-app form of LightBurn's advice.
6. **G-code is unchanged** unless the operator picks Cut last: the check only reads the compiled job.

### Consequences

- A mixed artwork (engraves and cuts) inside another mixed artwork can still be flagged after Cut
  last, because Sort cuts last keeps mixed artwork in place (Decision 8). Run order fixes it.
- The containment test uses the outline's polygon and the inner burn's box; a burn whose box centre
  falls outside a concave outline (a C shape) is not flagged.
