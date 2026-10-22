## ADR-626 - Laser lead-in and lead-out on Line cuts, with the scrap side found automatically

**Status:** Accepted on 2026-10-18. The maintainer asked whether KerfDesk has "the lead-in fix" after
reading complaints about scorch marks where laser cuts start, and asked for it built better than
LightBurn's. Builds LBG-C14 from `docs/audits/2026-09-26-lightburn-gap-audit.md`, which recorded it as
needing a decision because PROJECT.md listed laser lead-in/out as out of scope; this ADR is that
decision. Laser only and off by default: an existing project emits the same G-code. No new guard or
refusal (ADR-228). Software verification only; no air-cut, material or hardware qualification. A
scrap test cut is still needed before relying on it.

### Context

Where a Line cut starts, the beam is on while the head is still speeding up, and where it stops the
head slows down with the beam on; on many machines it also dwells for a moment either side. That
leaves a heavier burn, a small notch or a blob on the finished edge. A lead moves both onto scrap: the
cut starts a little way off the part, runs onto the contour, round it, and off again.

LightBurn (Cut Settings Editor → Line mode → Advanced, read 2026-10-18 at
`https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/LineMode/`) has Lead-In and
Lead-Out switches with an Angle, a Length and a Style (Line or Arc), per layer. The sign of the angle
picks the side: positive outside, negative inside. LightBurn does not know which side is scrap, so a
layer with outlines and holes needs the user to split them onto layers with opposite signs, and the
lead goes where Set Start Point put the start, fitting or not. Its documentation notes that acute
nodes may not work for inside leads and does not say how leads interact with overcut, passes, tabs,
perforation or kerf offset.

KerfDesk already had CNC profile leads (`core/cnc/profile-lead.ts`, ADR-250), closed-shape starts
(`core/job/closed-shape-start.ts`, ADR-494), overcut (ADR-415), the 4040-safe laser-off contour entry
(ADR-239), laser tabs (ADR-494), kerf offset and inside-first topology (ADR-486, ADR-531).

### Decision

1. **Six optional operation settings.** `leadInEnabled`, `leadOutEnabled`, `leadStyle` (`'arc'`, the
   default, or `'line'`), `leadLengthMm` (0.1 to 20, default 2), `leadAngleDeg` (arc: 10° to 180°,
   default 90°; line: 10° to 90°, default 45°) and `leadSide` (`'auto'`, the default, `'outside'` or
   `'inside'`) join `LayerOperationSettings`, artwork overrides and sub-operations, like the ADR-415
   and ADR-494 settings: absent means no lead, captured only when set, carried by Copy and Paste
   settings and process recipes, not stored by material presets. Validators accept them and the
   loader drops unusable values. Cut Settings writes them only once an operation has had leads or
   the form moves one off its default, so saving the dialog leaves an operation that never had
   leads, and its link to a recipe, unchanged. A bulk edit of the angle alone keeps each selected
   artwork's angle within its own style's range (an arc lead up to 180°, a line up to 90°). Saved defaults and recipe steps hold lead fields only
   when they have leads, so applying one clears the operation's own leads first. No schema bump: an older build ignores them and cuts
   the same contours without leads. One length, style, angle and side serve both leads.
2. **Geometry** (`core/job/laser-lead-path.ts`). The length is the lead's own path length, so it is
   also the extra burn per lead. An arc is tangent to the cut where it joins, turns through the arc
   angle, and has radius length ÷ angle; it joins without a corner, so the head need not slow down
   where it meets the part. A line meets the cut at its angle. A lead-in ends on the start heading
   along the cut; a lead-out leaves the end heading along it. Directions are read over 0.05 mm of path,
   or, for a contour that goes out as G2/G3, from its first and last moves, so an arc lead meets an arc
   move tangentially.
3. **The scrap side is found** (`core/job/laser-lead-rings.ts`; Amendment 1 changes which contours
   are counted and how copies are matched). Automatic puts a lead outside an outer
   contour and inside a hole, by containment parity judged as line topology judges it
   (`proper-contour-containment.ts`: the whole outline must lie inside, so a contour that crosses
   into a concave neighbour is not read as its hole), counted over every closed contour of every
   Line cut group in the job that burns. A group at zero power, artwork at 0% power, or a power the
   controller rounds to zero emitted power (judged as the job start mark judges it,
   `hasJobStartPower`, including Ruida's 14-bit power scale) cuts nothing
   and holds no part, so it is neither an obstacle nor a container, and gets no leads. A hole cut by its own operation is therefore still a hole. A contour that tabs or
   perforation broke into pieces still counts: compile keeps its whole outline on the cut group
   (`CutGroup.topologyRings`, matched to the pieces by their topology identity, ADR-486 Amd 2;
   translated with the job, dropped from the prepared job once leads are placed, and kept only when
   some operation or artwork in the scene asks for leads). Copies of one outline, such
   as an outline cut by two operations, count once, or a hole inside a twice-cut outline would read as
   an outer contour. A copy has the same bounds and length within 0.01 mm and is the same loop corner
   by corner within 0.01 mm, however it starts or runs; a vertex that only splits a straight edge (an
   outline started mid-edge has one) does not count, and shapes that only share bounds and length
   stay apart. Every copy directly matches its representative; a chain of approximate matches
   cannot widen that tolerance.
   Containment is judged from the outlines here, not from the depth compile carries, because that
   depth already counts a container on the same path that may also have a copy. The same judgement
   says which contours hold a contour for the free-end check below. **Always outside**
   and **Always inside** override it for the whole operation, for the cases parity cannot know (a
   closed score line around a hole counts as a container).
4. **A lead only goes where it fits** (`core/job/laser-lead-fit.ts`). It must stay on the bed when
   the bed's place in program coordinates is known (on an active rotary only the bed's X limits
   apply: the rotary rebases Y, so where the artwork sits on the flat canvas does not change its
   leads). On an active rotary the job wraps round the object, so every cut line and placed lead
   within a lead's reach of either end of the job is also checked one circumference (π × the object
   diameter, in surface Y) up and down (`core/job/laser-lead-rotary.ts`): a lead near one end keeps
   clear of a cut near the other, across the seam. The rotary rebases the job and allows it one
   turn, so a lead there also keeps the job, with every lead placed so far, within one circumference
   (less 0.01 mm), measured from the job's own Y extent rather than its place on the flat bed; a lead
   that would push it past is shortened or left out like any other. Walking out from the join it may never come nearer its own contour than it already was
   (within 0.03 mm, up to the clearance), and its free end, where the mark lands, must be on the scrap
   side and at least the clearance from the contour, or, for a lead too short to reach that far, 90%
   of the way its own shape takes it into the scrap, so every length the setting allows can fit. From
   its very first step, measured along the whole walk between its samples and not only at them, it
   must keep the clearance from every other cut line, including the bridged
   gaps of a tabbed or perforated outline (a lead slipping through two tab gaps would burn across that
   part) and the leads already placed for earlier contours, so two leads aimed into the same scrap
   cannot burn over each other (a placed lead that goes out as G2/G3 is indexed as its arcs); copies
   of its own outline on another operation, and their leads, are
   exempt. Its free end must lie inside exactly
   the closed contours that hold its own contour, so it can never end inside another part or past the
   hole or sheet its contour sits in. The clearance is 0.2 mm or one kerf width (twice the kerf
   offset), whichever is wider, at most 1 mm. When the contour goes out as G2/G3, its arc leads do
   too: the bed check then measures their full sweep, as job bounds do, and they keep 0.005 mm more
   clearance, their sampling sag; a lead written as chords is measured by its chords. A neighbour
   that goes out as G2/G3 is measured by its arcs sampled to 0.002 mm, not by its chords. Cut lines
   longer than 1 m are checked by every query rather than gridded, so one long line cannot fill the
   index. A lead that does not fit is tried at ¾, ½ and ¼ of its length, then left out.
5. **Where leads join.** Leads are added in preparation (`core/job/apply-laser-leads.ts`, called by
   `completePreparedOutput`) after the planner has chosen every closed contour's start (ADR-494) and
   the job start point has been applied, so each lead joins where the beam really starts. With
   **Nearest corner**, an outer contour's leads therefore start at a corner, where a line lead can run
   straight on from the edge. Where an asked-for lead does not fit at the planned start, the contour
   is tried starting in the middle of each of its four nearest straight runs of at least 1 mm
   (consecutive chords heading within 1° of each other, so a side split into short chords is one
   run; every run is considered), alternating forward and back, and the first start where every lead
   fits wins. This matters for holes: inside a
   hole, a corner leaves no room for a lead that joins along the edge, and rectangles are drawn from a
   corner. The new start is half an edge from the planned one.
6. **One open burn.** A led contour becomes one open segment: lead-in, the whole contour, lead-out.
   Every reader of the prepared job (GRBL, Marlin and Smoothieware, which transform GRBL output, the
   Ruida motion plan, the preview route, both time estimates, Frame and Job Review bounds, coordinate
   checks and the job start mark) reads segments, so all of them carry the leads without code of
   their own. A job whose groups ask for no leads is returned as the same object, so its output is
   byte-identical. Lead shape or side stored with both lead switches off changes nothing either: it
   does not split artwork into separate process groups, and an artwork override that holds only
   such fields does not count as an override (no requested-override comment); recipe steps leave
   such fields out, as do captured and applied saved defaults, so reapplying a recipe or default
   does not revive inactive lead geometry. The GRBL layer
   comment adds `leads in+out arc 2.000 mm at 90 deg` only when the operation asks for leads.
7. **Passes and overcut.** Every pass cuts lead-in, contour, lead-out, because every pass starts and
   stops. Overcut stays on the final pass only (ADR-415): that pass runs past the start first and
   leaves by a lead-out from where the overcut ends, fitted on its own, whether or not the other
   passes' lead-out fits. Preparation stores that pass's
   burn on the segment (`finalPassBurn`); `finalPassCutSegments` hands it to every pass walker, and
   bounds, coordinate checks, the Ruida export's range check and the rotary Y mapping read it too.
   Compiled-work advisories count ordinary passes and that final-pass burn separately.
   The overcut's lead-out takes its heading from the overcut run alone, so a run shorter than the
   tangent window keeps its own direction. With one pass the final pass is the only one, so its burn
   is the segment's own and no reader can count a path that never runs; the ordinary lead-out, which
   that pass never cuts, is not fitted at all, so it can neither block the contour nor be kept as a
   line other leads must clear.
8. **Arcs (ADR-432).** A contour that goes out as G2/G3 keeps its arc moves, and its leads join them
   as moves: a line lead as G1, an arc lead as G2/G3 (quarter turns at most; chords below the arc
   fitter's 0.1 mm radius). A contour that goes out as chords gets its arc leads as chords within
   0.005 mm. A final pass with an overcut is written as chords, as overcut already was, so its
   lead-out, and with one pass its lead-in too, is fitted as chords. A restart in
   the middle of an edge keeps arcs only on an edge that is a single line move.
9. **What gets no lead.** Open paths (no scrap side). Shapes with tabs: they start and stop at their
   tabs, where the edge is broken anyway. Perforated lines: every dash starts and stops, and no closed
   shape is left. Job Review says how many shapes tabs, or perforation, left without leads (counted
   per artwork group, so perforation on some artwork of an operation is not reported for all of it),
   and how many shapes got a shorter lead or lost one, per operation (by its id, since two
   operations can share a name). Those shapes are cut exactly as
   without leads. A contour so small that every point rounds to one written coordinate (0.001 mm
   in G-code, a micrometre in Ruida; `isEmittableCutSegment`) is left out of the output, so it gets
   no lead and is not counted, or the lead would burn on its own.
10. **Other settings.** Leads follow the kerf-offset path, the path the beam really cuts. The ADR-239
    laser-off contour entry (4040-safe profile) runs up collinear with the lead's first chord, before
    the lead. Job origin placement still anchors on the artwork, not on the leads; Frame traces the
    leads, so a lead outside the bed shows there and in the existing bounds checks. CNC jobs have no
    Line cut groups and never change; CNC keeps its own ADR-250 leads. Preparation is routed to the
    background worker when a scene's work units reach the budget (`preparation-complexity.ts`); each
    asked-for lead on a closed contour adds one unit per 0.25 mm of lead, so thousands of contours
    with long leads are not fitted on the UI thread. The contours counted are the ones compile cuts:
    the canonical curve subpaths when a path has them, as saved projects do, else its polylines.

### Why this is better than LightBurn

- The scrap side is found per contour, so one operation can lead outlines outside and holes inside,
  across operations, and through tabbed outlines. LightBurn's sign is per layer and user-chosen.
- A lead never runs into a neighbouring part, out of a small hole or off the bed: it is shortened or
  left out, and Job Review says so. LightBurn places it regardless.
- A hole started at a corner still gets its leads, from the middle of a nearby edge.
- Overcut, passes, tabs, perforation, kerf, arcs and Ruida output each have a defined behaviour.
- Preview, both estimates, Frame and Job Review show exactly what will be burned.

### Consequences

- A led contour is no longer closed in the prepared job. Everything after preparation treats it as
  an open burn, which is what it is. The planner's travel was chosen for the contour's start, so
  travel to the lead's start can be up to one lead length longer.
- PROJECT.md no longer lists laser lead-in/out as out of scope; the gap audit marks LBG-C14 built.
- The fit checks cost a grid query per 0.05 mm of lead; only operations with leads pay it.

### Verification

Unit tests (`core/job/apply-laser-leads.test.ts`) cover outer and clockwise contours, line angles,
holes on the same and on another operation, a tabbed outline read through its pieces, the side
override, a small hole (shortened) and a tiny one (left out) with the Job Review counts, a neighbour
(shortened, or a restart on a free edge), a corner-started hole restarted mid-edge, copies of the same
outline, the bed, open paths, overcut on the final pass with its own lead-out, and arc moves.
`core/job/laser-leads-edge-cases.test.ts` covers a hole inside an outline cut by two operations, an
arc lead whose sweep bulges past its samples at the bed edge, and the final-pass burn through the
rotary Y mapping and the Ruida export's range check. `core/job/laser-leads-geometry-guards.test.ts`
covers an arc's sag near another cut, a corner a tab gap skips, mirrored shapes with equal bounds
and length, a 1 km cut line, the rotary bed, a one-pass overcut and the lead-out it never cuts;
`layer-default-settings-leads.test.ts` covers saved defaults and recipe steps without leads.
`core/job/laser-leads-arcs-and-pieces.test.ts` covers the arc tangent at a G2/G3 join, neighbours
measured by their arcs and an outline cut as 3,000 dashes. `core/job/laser-leads-review-guards.test.ts`
covers a cut beside the join, broken outlines read whole from compile, final-pass
coordinates in the G-code check and a very short overcut. `core/job/laser-leads-restart-and-rings.test.ts`
covers a corner-started hole on finely divided sides, outlines kept only when leads are asked for,
copies started elsewhere or run the other way, and an outline that burns nothing.
`core/job/laser-leads-scope-and-wrap.test.ts` covers a contour crossing a concave neighbour, the
one-pass overcut lead-out beside a blocked seam, a cut across the rotary seam, a rotary job kept
within one turn, artwork that stores lead shape with leads off, and perforation on one artwork only.
`core/job/laser-lead-clearance.test.ts` covers a short cut between two samples of a lead, and
`core/job/laser-leads-review-followups.test.ts` copies that drift a little each and a power Ruida
still writes. `core/job/laser-leads-routing.test.ts` covers a contour that rounds to one written
point and lead-heavy jobs routed to the worker.
`core/job/laser-leads-copies-and-power.test.ts` covers a copy started mid-edge, a power that rounds
to S0, the chord-only final pass beside another cut, and recipe steps with leads off.
`laser-lead-override-angle.test.ts` covers a bulk angle edit across arc and line leads.
End-to-end tests (`io/gcode/laser-leads-output.test.ts`) pin byte-identical G-code, prepared jobs and
Ruida plans with leads off (set or absent) on GRBL, arc GRBL, Marlin and Smoothieware with 1 and 3
passes and with and without overcut, and show leads on every pass, in Marlin, Smoothieware and Ruida
output, in Frame bounds, the preview route and the time estimate, unchanged CNC output, and the
settings surviving save and load. Not qualified on a machine: a scrap test cut is still needed.

### Amendment 1 — the scrap side is judged among the scene's lead operations (2026-10-20)

An audit of the open PR found two ways **Scrap side (automatic)** could burn a lead into the
finished part, both reproduced end to end:

1. The side was judged among the prepared job's contours only. **Cut selected graphics**, an
   operation with output off and a disabled sub-layer take contours out of the scene before compile,
   so a 10 mm hole selected alone, or whose plate's operation was off, had nothing round it, was read
   as an outer contour, and both its leads went about 2 mm into the plate at cut power.
2. Every closed contour of every burning Line operation counted as a container. A 10% score ring
   between a plate and its hole, a sheet border round the plate, or the plate cut again by a second
   operation with a 0.1 mm kerf offset (beyond the 0.01 mm copy tolerance) flipped the parity and
   sent leads into the part, or dropped the plate's own.

Decision:

1. **Judged among the scene** (`core/job/laser-lead-sides.ts`). Preparation hands
   `applyLaserLeads` the project's whole scene (`prepareOutput`'s source project, before the output
   scope). Its contours are every closed polyline of every Line operation and sub-operation, read
   with each artwork's own settings, output on or off, selected or not, in scene coordinates;
   containment does not depend on the job origin. One whose power burns nothing (judged as the job
   start mark judges it, `vectorPowerReachesController`) still holds no part. The bed, clearance and
   free-end checks stay with the prepared job: they are about the lines actually cut.
2. **Matched by identity.** Compile stamps each closed Line contour with the scene contour it comes
   from (`CutSegment.leadSource`: artwork id, path index, polyline index), only when some operation
   asks for leads (the same switch that keeps broken outlines). A kerf contour takes the source
   contour of its path nearest to it (`kerfRingOwners`, sampled distance among the sources within
   its mitre reach), and a broken contour's kept outline carries the stamp too. Preparation drops the
   stamps with the kept outlines, so a prepared job never carries them and output with leads off is
   unchanged. All rings of one scene contour are copies, whatever kerf offset each operation applies;
   artworks drawn on top of each other are still matched by shape within 0.01 mm
   (`laser-lead-copies.ts`, unchanged rule), now on their source outlines, so a kerf offset cannot
   separate them. Two rings of one cut group from one scene contour that are not the same outline
   are the pieces a kerf offset split it into: they are not copies, and each keeps clear of the
   other.
3. **Only operations with leads decide.** Asking for a lead says an operation cuts parts out, so its
   closed shapes are part edges. A contour held only by such shapes is a hole when an odd number
   hold it. A closed shape on an operation without leads may be a part (an outline whose operation
   simply has no leads) or only a score line or sheet border, and parity cannot tell which: guessing
   either way can lead into a part. So under **Scrap side (automatic)** a contour any such shape
   holds gets no leads and is cut as with leads off, and Job Review warns
   (`laser-leads-side-unknown`), naming the operation and saying to turn on its leads if it cuts
   parts out, or to choose **Always outside** or **Always inside**. "A hole cut by its own operation
   is therefore still a hole" now holds when the outline's operation has leads too. The fixed sides
   are unchanged.
4. **No outline rebuilt from pieces.** `laser-lead-chain.ts` rebuilt a broken outline from its
   pieces for a job compiled before outlines were kept. Every job `applyLaserLeads` sees is compiled
   in the same preparation, which keeps the outlines whenever the scene asks for leads
   (`sceneAsksForLaserLeads`), the only case in which a group carries leads, so that path could not
   run in the app. It and its two chain-only tests are removed; a broken contour with no kept outline
   is not a ring.

Consequences: a burning sheet border or score ring on an operation without leads costs the leads of
the shapes inside it, with a warning, where it used to risk a lead into a part; a guide outline only
stops counting at 0% power or when deleted. Line kerf compensation judged a contour's side among
its own operation's contours only, so a hole cut by its own operation with a kerf offset was offset
as an outline; [ADR-486 Amendment 3](ADR-486-amendment-3-kerf-sides-across-the-scene.md) judges it
among the same scene contours, counting operations with a kerf offset, leads or tabs as part edges,
so wherever leads know the side the kerf offset goes to the same side. Leads are fitted to the path
actually cut and go only to the side the scene's lead operations say is scrap.

Verification: `io/gcode/laser-leads-scrap-side.test.ts` prepares real projects and checks where
every lead ends: a separate hole selected alone, the plate's operation output off (with and without
leads on it), a score ring between plate and hole, a burning and a 0% sheet border, the plate cut
again with a 0.1 mm kerf offset (with and without leads), a plate drawn with its hole under a
±0.1 mm kerf offset, and a tabbed plate. The selected-hole, output-off, score-ring, sheet-border
and kerf-copy cases failed before this amendment (leads in the part, or none on the plate).
`core/job/laser-lead-sides.test.ts` covers parity among lead operations, the unknown side, copies
by identity and by shape, and kerf pieces of one group. `io/gcode/laser-leads-output.test.ts` pins
the G-code of an arc-capable GRBL disc with two passes and a 1 mm overcut: G2/G3 lead-in and
lead-out on the first pass, and a chord final pass that runs past the start and leaves by its own
lead-out. `ui/laser/laser-lead-warnings.test.ts` pins the new warning. Not qualified on a machine.

### Amendment 2 — review of the scene-judged sides (2026-10-20)

A review of Amendment 1 and the rest of the PR found five gaps, and one proposal this ADR declines:

1. **A lead-out never runs back along its lead-in.** Line leads at a right-angle corner leave along
   the very line they came in on, so one pass burned that stretch twice. A lead-out that leaves
   within 30° of the way its lead-in came (`retracesLeadIn`) counts as not fitting, so the contour
   is restarted mid-edge, where the two part at a right angle. Arc leads at a corner already part at
   a right angle and meet again only at their free ends, in the scrap, so they are unchanged.
2. **Each operation that leaves a side unknown is named on its own.** Shapes held by different
   operations without leads were counted under the first one's name; Job Review now gives one
   warning per holding operation, with its own count.
3. **Turning leads off for one artwork is an override.** An artwork override that sets a lead
   switch counts as an override (the group records its effective settings, and output and Job
   Review show it), since it may turn off leads its operation has on. Only an override of lead
   shape or side alone, with leads off, is still ignored.
4. **Recipe reseeding ignores inactive lead fields.** A linked operation that had leads turned on
   and off again still switches to the new mode's recipe, because lead fields with both leads off
   are left out of that comparison, as of every other.
5. **Job-start editing sees the closed outline.** A led contour is one open burn, so the start
   editor saw only its leads' two ends. Each led segment records where its contour lies in the burn
   (`CutSegment.leadContour`), and the editor reads the contours back (`jobWithoutLeads`), so any
   supported point on the outline can be the start; preparation already moves the start on the
   contour itself before leads are added. Native-arc contours retain their validated original
   moves for editing and keep ADR-594's existing move-boundary snapping. The editor must not offer
   an arbitrary sampled-chord point that the next prepared native-arc output cannot use.

Declined: treating a copy offset by another kerf as a cut a lead must keep clear of. The sliver
between two cuts of one outline is cut free of the part whichever way the offset goes, so a lead
crossing it burns nothing that stays; and every lead from the inner cut must cross the outer one.
As obstacles, such copies only cost leads: the kerf-copy plate of Amendment 1 lost its lead.

Verification: `core/job/apply-laser-leads.test.ts` shows a square started at a corner with
45-degree line leads restarted mid-edge, its leads parting; `io/gcode/laser-leads-scrap-side.test.ts`
names a score ring and a border separately; `core/job/laser-leads-scope-and-wrap.test.ts` records an
artwork override that turns leads off; `ui/state/laser-recipe-seeding.test.ts` reseeds after leads
were turned on and off; `ui/state/canvas-start-editing-leads.test.ts` picks a start halfway along an
edge of a led contour. Each failed before this amendment.

### Amendment 3 — further review (2026-10-20)

1. **The overcut's lead-out is held to the same rule.** With one pass and an overcut a whole lap
   long, the final pass ends back at the seam, and its lead-out could run back along the lead-in. The
   retrace rule of Amendment 2 now applies to it too, when it leaves within the clearance of where
   the lead-in joins, so the contour restarts mid-edge.
2. **Split kerf pieces stay copies across operations.** When a kerf offset splits one scene contour
   into pieces and two operations cut it with the same offset, each operation's later pieces were
   given classes of their own, so the other operation's identical piece sat right at the join and
   blocked every lead. A later piece now takes the class of the piece it matches by shape
   (`laser-lead-copies.ts` rule) in another operation; pieces of one operation stay apart.
3. **A lead never crosses its own contour.** The walking checks read the distance to the contour
   at samples 0.05 mm apart, and right by the join that distance is small anyway, so a lead could cut
   through a narrow tongue of the part beside the join between two samples. The lead's path is now
   also tested against the contour (`laser-lead-own-crossing.ts`); only a crossing within 0.2 mm of
   the join, measured along the contour, where a lead joins and may ride its chords, is allowed.
4. **Curve-backed artwork counts for routing.** The lead work estimate counts the contours compile
   cuts: the canonical curve subpaths when a path has them, else its polylines.

Verification: `core/job/apply-laser-leads.test.ts` restarts a lap-long overcut started at a corner;
`io/gcode/laser-leads-scrap-side.test.ts` leads all four pieces of a dumbbell two operations split
with the same kerf; `core/job/laser-leads-geometry-guards.test.ts` keeps a lead-in off a 0.01 mm
tongue beside the join; `core/job/laser-leads-routing.test.ts` routes curve-backed triangles. Each
failed before this amendment.

### Amendment 4 — the crossing and pairing checks, reviewed (2026-10-21)

1. **An overcut's lead-out keeps clear of the whole lead-in.** When it leaves the contour more than
   the clearance from where the lead-in joins (an overcut that stops short of the seam), it must keep
   the clearance from the lead-in along its whole length, or the two cross in the scrap and that
   spot burns twice. Where both join at one point, the 30-degree retrace rule of Amendment 2 decides,
   as before.
2. **Arc leads are checked along the arc the machine runs.** On an arc machine the own-contour
   crossing check of Amendment 3 follows the G2/G3 arcs, sampled to 0.001 mm, not the chords a lead
   is drawn with, which the arcs bulge past by up to 0.005 mm.
3. **The crossing check reads only nearby edges.** Each contour's edges go on a 1 mm grid once
   (cached per contour), so every fit, length and restart reads only the edges round the lead; a
   contour of tens of thousands of edges no longer costs a full scan per attempt.
4. **Split pieces pair across operations whatever their kerf.** Amendment 3 matched a split piece to
   another operation's only by shape within 0.01 mm, so two operations with different kerf offsets
   lost the pairing. A piece now takes the class of the earlier piece of another operation whose
   bounds overlap its own most (at least half of the smaller), which is its counterpart however that
   operation offsets it, or which holds it when that operation cuts the contour whole. An exact copy
   in the same operation (drawn twice) still shares its class, and two different pieces of one
   operation never do.

Verification: `core/job/apply-laser-leads.test.ts` gives a near-lap overcut no lead-out where it
would cross the lead-in, and leaves an ordinary overcut alone; `core/job/laser-leads-geometry-guards.test.ts`
keeps an arc lead-in off a spike between its chord and its arc; `io/gcode/laser-leads-scrap-side.test.ts`
leads all four dumbbell pieces with kerfs of -0.25 and -0.3 mm. Each failed before this amendment.

### Amendment 5 — pieces, near-seam overcuts and long edges (2026-10-21)

1. **Every piece is exempt from the outline it was split from.** When one operation cuts a contour
   whole and another's kerf splits it, Amendment 4 paired only the first piece with the whole
   outline, so the other pieces met it at their joins and lost their leads. Copy classes stay as they
   are, but each ring now has an exemption list (`LeadJobLines.exempt`): its copies, and every ring
   another operation cuts from the same scene contour that overlaps it by at least half of the
   smaller. A lead may cross those and end inside them. Pieces of one operation are still never
   exempt from each other.
2. **The direction rule only where the joins coincide.** A lead-out that leaves anywhere but the
   lead-in's own join, however near (an overcut stopping 0.1 mm short of the seam), is checked along
   its whole path: past the clearance from its own start, it must keep the clearance from the
   lead-in. The 30-degree rule of Amendment 2 is for a shared join only.
3. **Long edges are gridded by the cells they pass through.** The crossing check's grid walks each
   edge through its cells, so a long or diagonal edge is found only where a lead is near it; only an
   edge passing more than 100,000 cells (100 m) is checked by every query.

Verification: `io/gcode/laser-leads-scrap-side.test.ts` leads the whole dumbbell and both pieces
when one operation cuts it whole and the other splits it; `core/job/apply-laser-leads.test.ts`
gives an overcut stopping 0.1 mm short of the seam no crossing lead-out;
`core/job/laser-lead-own-crossing.test.ts` finds crossings of 100 mm diagonal edges walked either
way. The first two failed before this amendment.

### Amendment 6 — pieces by containment, leads between samples (2026-10-21)

1. **Pieces correspond by containment, found through a box index** (`core/job/laser-lead-pieces.ts`).
   Two rings that different operations cut from one scene contour are one part when a point just
   inside one lies inside the other: a piece lies inside the whole outline it was split from, and
   counterpart pieces at different kerf offsets nest. Bounds overlap alone, which Amendments 4 and 5
   used, also paired unrelated pieces whose bounds interlock. Candidates come from a box index of the
   rings, so a contour split into thousands of pieces costs each ring only its neighbours, not a scan
   of every ring of the contour.
2. **Only pieces are copies of pieces.** Copy classes pair a piece with its counterpart piece in
   another operation that split the contour too, and a ring with its exact duplicate. A whole outline
   is no longer a copy of the first piece split from it: they are different burns, so their leads
   keep clear of each other. The piece is still exempt from the outline itself (Amendment 5), and
   only a true copy's placed leads are ignored.
3. **A lead-out from a distinct start is checked continuously.** Past the clearance from its own
   start, each walking step of the lead-out is measured against the lead-in as a segment, so a graze
   between two samples is caught.
4. **The crossing check reads the contour as it burns.** For a contour that goes out as G2/G3 the
   own-contour crossing check (Amendment 3) uses its arcs sampled to 0.002 mm (the obstacle line),
   not its chords.

Verification: `core/job/laser-lead-pieces.test.ts` pairs a piece with the L it lies in but not with
a square in the L's corner; `io/gcode/laser-leads-scrap-side.test.ts` keeps each piece's leads a
kerf width from the leads of the outline it was split from; `core/job/laser-lead-fit-continuous.test.ts`
catches a lead-out grazing the lead-in between samples and a tongue present only in the burned
contour. `core/job/laser-lead-sides.test.ts` now expects the whole outline to be exempt from, not a
copy of, its pieces.

### Amendment 7 — edges of the edge cases (2026-10-21)

1. **A large lead box reads only the filled cells in it.** When a lead's box spans more grid cells
   than the contour fills, the crossing check reads the filled cells inside the box, not every edge.
2. **The step across the clearance is clipped, not skipped.** For a lead-out from a distinct start,
   the walking step that crosses the clearance from that start is measured from where it crosses.
3. **A chord-only pass checks against its chords.** The context a chord-only final pass fits with
   (Amendment 2) also swaps the burned contour of Amendment 6 for the chord ring that pass runs.
4. **A probe point inside any piece.** A ring's probe point lies halfway along the inward normal
   from the middle of an edge to the ring's next wall, edges tried longest first, so it stays inside
   a piece only one output step wide.
5. **Coincident artworks are one outline for exemptions too.** Pieces are exempt from rings of the
   same scene copy class, not only of the same scene contour, so a whole outline cut from one artwork
   and the pieces another, coincident artwork's operation splits are exempt from each other.

Verification: `core/job/laser-lead-own-crossing.test.ts` finds a long lead crossing a small dense
circle; `core/job/laser-lead-fit-continuous.test.ts` catches a graze on the step across the
clearance; `core/job/laser-lead-pieces.test.ts` pairs a 0.001 mm sliver with its counterpart and
two coincident artworks' rings.

### Amendment 8 — outlines cut as open lines (2026-10-21)

Rolling audit v2 (`docs/audits/2026-10-21-rolling-v2/03-laser-output.md`) reproduced, end to end,
three ways an outline cut as open lines defeated the scrap side:

1. **03-P1-2.** A CAD plate drawn as four LINE entities imported as four open paths, so no closed
   shape held the r5 hole inside it. The hole was read as an outer contour, and its arc lead-in and
   lead-out burned about 1.5 mm into the plate at cut power (a 90° line lead about 2 mm), with no
   warning.
2. **03-P1-3.** With Optimization → Remove overlapping lines, the second of two parts that share an
   edge loses that edge and becomes an open three-sided path, which is not a ring. The first part's
   leads at the shared edge then went into it: 1.27 mm with arc leads, and 1.41 mm with 45° line
   leads once the clause 5 restart moved the start to the middle of that edge.
3. **03-P2-9.** The same DXF plate lost kerf compensation and inside-first order with no Job Review
   line, although Fill and CNC both say when they leave open contours out.

Decision:

1. **DXF import joins touching pieces** (`io/dxf/dxf-join-touching.ts`). Open pieces of one colour
   join where an end meets exactly one other end within 0.0001 mm, by the pairing rule of Join paths
   (`joinCurveEndpointsWithin`, ADR-350): a T-junction, or three ends at one point, stays apart, and
   a chain whose last end meets its first closes. 0.0001 mm is the tolerance at which the importer
   already closes a single entity whose ends meet (`CLOSURE_EPS_MM`): it absorbs float rounding, such
   as an ARC end computed from its angles against a LINE end written as a number, and leaves every
   drawn gap open; wider gaps are for Join paths and for decisions 2 and 4. LightBurn closes such
   shapes on DXF import too (a staff forum post; forum reports put its DXF auto-close tolerance at 0
   by default, so only ends that meet join there). Closed entities and pieces of different colours
   are unchanged, and pieces that touch end to end in a line, such as instances of a block array,
   join into one path that cuts the same lines.
2. **Open lines that close a region leave the side unknown** (`core/job/laser-lead-open-outlines.ts`).
   The open paths of every burning Line operation in the scene, read as Amendment 1 reads closed ones
   (output on or off, selected or not), are drawn as strokes 0.5 mm wide (the gap Fill offers to
   close, `CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM`), round at their ends, and united. A hole of the
   union is a region the lines close, whether their ends meet, cross past each other or stop up to
   0.5 mm short. Under **Scrap side (automatic)**, a contour with a point in such a region gets no
   leads and is cut as with leads off, and Job Review gives the side-unknown warning of Amendment 1
   D3 (`laser-leads-side-unknown` with `aroundOpenPaths`), naming the operation of the open lines and
   saying to close the outline with Tools > Join paths or to choose a fixed side. Where a closed shape
   without leads also holds the contour, that shape is named. Lines are clustered by the grid cells
   their grown bounds cover (a cell size chosen so each line covers about eight, so the work grows
   with the lines, not their pairs; lines that share a cell may join a cluster they need not, which
   costs time only), and only clusters whose bounds reach a contour are united, after simplifying
   the lines to 0.05 mm (their ends kept) and sampling the round caps to 0.01 mm, so ends up to
   0.48 mm apart always close. Line art away from every contour costs nothing, and the work only
   runs when some operation asks for leads. Open paths are still neither containers
   nor part edges for parity, as ADR-486 Amendment 2 holds for the kerf offset. The fixed sides are
   unchanged.
3. **A part split by Remove overlapping lines keeps its outline** (`core/job/remove-cut-overlaps.ts`).
   When some operation asks for leads (compile then stamps each closed contour with its scene
   contour, `leadSource`), a closed contour that overlap removal, exact or with a merge tolerance,
   breaks into pieces keeps its whole outline on its group (`CutGroup.topologyRings`), as one broken
   by tabs or perforation does (clause 3). That holds on every route overlap removal takes: inside-first
   ordering cleans a multi-pass or tabbed operation packet by packet (`topology-cut-cleanup.ts`),
   and the outline rides on the first part of its group that still cuts something, and survives
   when parts are joined again. Leads read it as a ring and as a cut line: they keep the
   clearance from the removed edge and never end inside the part. The pieces still get no leads
   (clause 9). The outline is lead scaffolding and is dropped with it, so a job without leads emits
   the same bytes.
4. **Line-layer advisory** (`core/preflight/line-open-outline-issues.ts`, `line-open-outline`).
   Open paths of one output Line operation that Join paths would close at 0.5 mm are named in Job
   Review and on Save when their artwork runs them with a kerf offset or leads, or when the outline
   holds a closed Line contour that inside-first would cut before it; the message says which of
   those the outlines miss. As in Join paths, only paths cut with the same settings join, so each
   outline is judged by its own artwork's settings, never by another path on the operation. It is a warning only (rule 7, ADR-565): the lines are cut as drawn.

Not covered: open lines that close a region only together with a closed shape's edge, such as a
part drawn by hand as three lines against another part's side, are not read by decision 2. Remove
overlapping lines, which produces exactly that in output, is covered by decision 3.

Consequences: an outline CAD drew as touching LINEs and ARCs now imports as one closed shape, so it
gets kerf compensation, inside-first order, leads and Fill, where before it was cut as open lines.
Open line art that closes a region round a contour (a sketch, or cross-hatching on a Line
operation) costs that contour its automatic leads, with a warning. A scene with no open Line paths
prepares as before, and so does every job without leads.

Verification: `io/gcode/laser-leads-open-outlines.test.ts` imports the plate with `parseDxf`, emits
G-code and reads it back. With arc and 90° line leads no lit G1, G2 or G3 sample lies in the plate
material; both joined contours get their leads, outward and inward; with a 0.1 mm corner gap, and
with lines drawn past the corners, the hole gets no lead and one side-unknown warning. Two squares
sharing an edge, with overlap removal on, keep every lit sample out of both parts with arc, 90° and
45° leads, in one pass and in two (the packet cleanup route). An outline whose artwork turns its
kerf off gets no warning because of another path on the operation. The joined plate is kerf-offset as a part with its hole as a hole (mean hole radius
4.8 mm, plate −0.2 to 80.2 mm) and the hole is cut first; the 0.1 mm-gap plate on a kerf layer gets
the `line-open-outline` warning, while open lines that close nothing, or an open outline that no
setting needs closed, get none. Every case except those last two and the 90° overlap case failed
before this amendment. `io/dxf/dxf-join-touching.test.ts` covers LINEs drawn in any direction, a
slot of LINEs and ARCs, a real gap, three ends at one point, two colours and closed entities, and
`io/dxf/dxf-nested-insert.test.ts` and `ui/import/parse-dxf-blob.test.ts` now count the 150,000
MINSERT instances as line pieces, since the few whose ends meet are joined;
`core/job/laser-lead-open-outlines.test.ts` the gap limit, crossing lines, a single looped path,
nested contours, dangling lines and 20,000 hatch lines across one span; `core/job/remove-cut-overlaps.test.ts` the kept outline with and
without a merge tolerance and its absence without leads; `ui/laser/laser-lead-warnings.test.ts` the
wording. Not qualified on a machine.

### Amendment 9 — bounded work and collinear overlaps (2026-10-22)

1. **Containment in a large ring goes through its edge index.** A ring with more than 32 points is
   asked whether it holds a probe point through a `PolygonEdgeIndex` built once, so a whole outline
   that thousands of pieces lie in costs each piece a short lookup, not a scan of its edges.
2. **A lead running along its own contour is a crossing.** A lead step that runs along one of its
   contour's edges touches it over the whole stretch they share; both ends of that stretch are
   measured from the join, so riding the contour more than 0.2 mm from the join rejects the lead.
3. **Whole outlines stay copies of each other.** When two operations cut a contour whole and a third
   splits it, each whole outline pairs with the other (a piece pairs only with a piece), so their
   identical leads still ignore each other.
4. **A contour's grid has a total budget.** Its edges take at most 2,000,000 grid places in all; the
   edges past that are checked by every query, so unit-mismatched artwork with many very long edges
   cannot exhaust memory.

Verification: `core/job/laser-lead-own-crossing.test.ts` rejects a lead along its contour's edge
past the join and allows one beside it; `core/job/laser-lead-sides.test.ts` keeps two whole cuts
copies beside a split one; `core/job/laser-lead-pieces.test.ts` tests containment in a 400-point
ring. The first two failed before this amendment.
