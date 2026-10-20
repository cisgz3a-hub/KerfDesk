## ADR-486 Amendment 3 - Kerf sides are judged across the scene (2026-10-20)

**Status:** Accepted; software-verified through compile, preparation and G-code tests, no material
cut. | **Date:** 2026-10-20

Amends ADR-486 decision 1 ("decided across the operation's layer") and the Line compensation
paragraph of [Amendment 2](ADR-486-amendment-2-topology-before-process-settings.md) ("All effective
closed Line contours of one context establish source parity together"). Advisory only: nothing here
refuses Frame, Start or export (rule 7, non-negotiable 21).

### Context

The 2026-10-20 audit of the laser lead PR found that kerf compensation and laser leads disagreed
about which side of a contour is scrap. [ADR-626 Amendment 1](ADR-626-laser-lead-in-and-lead-out.md)
judges a lead's side among every Line contour of the scene; the kerf still judged it among the
contours of the one operation being compiled (`compile-line-topology.ts`, called once per
operation). Reproduced end to end with a 0.5 mm Kerf Offset, a 40 mm plate and a 10 mm hole:

- the hole on its own Line operation was offset as an outline, cut 11 mm wide instead of 9 mm, so
  the hole came out 2 mm too large (G-code X34.5 to X45.5 instead of X35.5 to X44.5);
- the hole on the plate's own operation, with **Cut selected graphics** and only the hole selected,
  was cut 11 mm wide too, and so was a hole whose plate's operation had output off.

### Decision

1. **Judged among the scene** (`core/job/kerf-scene-sides.ts`). Preparation hands compile the
   project's whole scene, before the output scope (`CompileJobOptions.sideScene`, from
   `prepareOutput` and `prepareOutputAsync`); any other compile reads its own scene. The contours
   are the ones laser leads read (`sceneLeadSideContours`): every closed polyline of every Line
   operation and sub-operation, with each artwork's own settings, output on or off, selected or
   not, in scene coordinates; one that burns nothing (judged as the job start mark judges it) holds
   no part. Copies count once, by identity and by shape, as for leads (`laser-lead-copies.ts`).
   Compile stamps each kerf source with the scene contour it comes from (`KerfSource.sceneContour`)
   and looks its holders up by that key, so the job origin, a jig slot or a rotary cannot change
   them. The scene is read only when an operation compiles a kerf contour.
2. **Part edges.** A closed shape that holds a kerf contour counts towards its parity when it is
   cut by the contour's own operation (as before: every closed contour of one operation counts, its
   own kerf zero or not) or by an operation whose settings say it cuts parts out: a kerf offset,
   leads, or tabs. This is a superset of the operations that decide a lead's side, so wherever
   leads know the side, the kerf offset goes the same way. The contour's own path keeps the depth
   compile already gives it (its own rings, or the depth carried with a traced path, ADR-531).
3. **Other closed shapes are taken for score lines and borders, and reported.** A closed shape on
   any other burning Line operation may be a part cut without compensation, or only a score line, a
   sheet border or a guide, and parity cannot tell which. The kerf takes it for the latter, which is
   what it always did with shapes on other operations, so a score ring between a plate and its
   hole, or a sheet border round the plate, cannot flip either. Every kerf contour such a shape
   holds is counted, and Job Review warns once per layer and surrounding operation
   (`kerf-side-assumed`): if that operation cuts parts out, these shapes went to the wrong side and
   are off their drawn width by four times the Kerf Offset; give it a kerf offset, or cut both on
   one layer. A registration jig's box (ADR-057) is a placement scribe on its reserved layer and is
   left out altogether, so jig jobs get no such warning.
4. **Why not "no offset" when unsure.** Leads leave a lead off when the side is unknown, which
   costs nothing but the lead. Cutting such a contour uncompensated would cost the kerf of every
   part inside a burning guide outline and of every hole inside a score ring, with no setting that
   could restore it (a score line given a kerf offset would count as a part edge and flip the hole).
   Taking the shape for a non-part keeps those cases exact, never does worse than before this
   amendment, and the warning names the one case it gets wrong.
5. **Nothing else moves.** Each path's contours are still offset together (decision 1), output
   topology is still rebuilt from the surviving contours (Amendment 2), and a layer whose sides do
   not change compiles to the same output. A kerf contour the scene does not know (its operation
   burns nothing) keeps the operation's own judgement.

### Limits

- A part edge cut without compensation on an operation without kerf offset, leads or tabs is still
  read as a non-part, so a hole drawn on its own kerf operation inside it is offset as an outline;
  Job Review says so before Start.
- A sheet border on an operation with a kerf offset, leads or tabs counts as a part edge, and turns
  the parts inside it into holes, as a border on the parts' own operation always did.
- A container that burns nothing (0% power, or a power that rounds to S0) no longer counts, also on
  the contour's own operation, as for leads.
- Frame's spatial signature leaves out artwork outside the output scope, so editing an unselected
  plate does not ask for a new Frame although it can change a selected hole's kerf side; Start
  still compares the newly prepared motion bounds with the framed ones (ADR-565), as it does for
  leads.
- Code and test evidence only. No material was cut and no hardware was run.

### Tests

`io/gcode/kerf-scene-sides.test.ts` prepares real projects and measures every cut contour: a hole on
its own operation (also in the G-code), a hole on the plate's operation and in one compound path
(unchanged), the hole selected alone on either operation, the plate's operation output off, a plate
whose operation has tabs or leads, a score ring between plate and hole on one and on two operations,
a burning, an output-off and a 0% sheet border, a plate cut by two operations, and a plate on an
operation without kerf, with the Job Review wording. The own-operation, selected, output-off,
tabs/leads, two-operation and sheet-border cases failed before this amendment (the hole cut 11 mm
wide), and the score-ring and no-kerf-plate cases had no warning. `core/job/kerf-scene-sides.test.ts`
covers the holder count, own-path and copy handling, the assumed shape and the jig box directly.
`core/job/compile-job-process-topology.test.ts` pinned the old rule (a hole on a second kerf
operation cut 22 mm wide as an outline) and now expects it shrunk, with a plate operation without
kerf as the control.
