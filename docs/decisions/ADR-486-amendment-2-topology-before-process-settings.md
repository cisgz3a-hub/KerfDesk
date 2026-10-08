# ADR-486 Amendment 2: Resolve operation topology before process settings

Date: 2026-10-07
Status: Accepted implementation; crossing ownership is the stated working default pending user steering.

## Problem

Settings overrides and object power scales previously divided Line kerf and Fill material before their topology was known. An independently powered hole could grow outward or be filled. Inside-first sorting also stopped recognising closed parents once tabs or perforation split them, and one settings group could finish an outer contour while another group's hole remained uncut.

This amendment supersedes ADR-486's settings-bucket and crossing-probe limitations, ADR-415's fragmented-contour ordering limitation, and ADR-494's whole-group main/tab ordering when inside-first optimisation is enabled. ADR-531's valid carried source forest remains authoritative within its path. New compiled output also records the surviving operation/run forest.

## Fill material and ownership

Each actual materialized output operation, artwork run and registration-jig instance builds its own context. It includes only artwork assigned to that effective Fill operation. Canonical curves are flattened in machine space once. Each path uses its declared fill rule (text defaults to nonzero); paths are unioned within one object, then material is combined with even-odd parity across objects. Compound objects retain all disjoint components and intrinsic holes. An object cannot own a cell where its own material is absent.

Uniform effective settings AND emitted power use the existing direct hatch route before normalization or ownership arrangement. This keeps dense even-odd Sharp traces on their direct scanline path. Otherwise bounds reject disjoint material before checked intersections/differences form coverage cells. Ownership and each process bucket's resolved contours are computed once and reused for hatch styles, angles and passes.

Full component-shell containment establishes ancestry. Bounds are a candidate filter; the complete boundary must be contained, and coincident shells do not enclose each other. Area, the nearest source contour, a sampled vertex and global painter/depth order are not substitutes for ancestry. A cell uses only its actually active contributors:

- Even active parity is empty material.
- An active component with an odd number of active strict ancestors is negative and cannot own material.
- A positive descendant suppresses its positive ancestors. A true plate/hole/island therefore retains the island's own settings even if it is behind the plate.
- Among unrelated/crossing positive contributors, the frontmost canvas object owns surviving odd material. Canvas stacking is scene.objects order; persisted artworkOrder is output priority and does not change stacking.

The crossing rule is the team's stated working default, not a received answer to the optional preference. For P/H/C with H wholly inside P and C crossing them, H is negative. In triple-covered surviving material, P and C are the eligible positives: H,C,P stacking gives P ownership; H,P,C gives C ownership. A true P/H/I island remains I-owned regardless of that painter tie. Compound intrinsic holes require actual material membership, so a frontmost compound object cannot claim an unrelated shape inside its absent hole.

A checked geometry-engine failure omits only that Fill context/run and records fill-ownership-failed with the materialized operation ID/name, independent run scope and closed contributor IDs/count. The source list is collected before the checked calls, excluding open-only artwork. The plain Job Review and Save warning discloses the missing Fill; independent Line, image and other-operation output is retained. Successful empty XOR material is not an engine failure. The warning stays advisory under ADR-565 and adds no Frame, Start, Save or licence gate.

## Line compensation and contour packets

All effective closed Line contours of one context establish source parity together, including containers whose own kerf is zero. Each path uses its own effective kerf. Valid ADR-531 source nesting is carried, while other paths require full-boundary containment. After offsets finish, topology is rebuilt from actual surviving output: split results receive distinct contour IDs and dropped contours leave no phantom ancestors. Source-nearest matching remains only for placed tabs and start anchors.

Optional plain nesting.topologyContour identifies a surviving compiled parent, while group.topologyScope identifies its actual materialized operation/run. The deterministic run counter advances even if a context is empty or fails. Tabs, their low-power spans and perforation retain that parent identity. Automatic skip-inner tabs use the surviving global depth; placed tabs still override automatic eligibility.

Only insideFirst with a non-source-order travel policy activates parent packet ordering. Actual depth sorts deepest first; indexed nearest-neighbour ordering chooses peers. A parent's main groups finish all their recorded passes before its own low-power tab groups finish theirs, then the outer parent can follow. Pass counts, feed, air, power mode, runways, overcut and native arc metadata remain attached to their original process group. Final-pass overcut remains final-pass-only and applies only to closed main contours; tab spans remain continuous and are not perforated.

Overlap cleanup still compares contours within each original effective process group (including a separate tab-span group). The global parent route and starts are chosen on complete contours first. Each original process group is cleaned once in that route order, so the earliest actually ordered contour owns coincident spans as WORKFLOW F-A9b requires. Surviving fragments keep their parent ID and traversal order; neither the single-pass shortcut nor parent packets re-rank newly split endpoints. Parent depth remains based on the complete surviving compensated contours. Adjacent same-depth main peers from the same original group can retain their combined headers/passes when they have no low-power bridge barrier. Settings groups never merge merely because their emitted power happens to repeat. Keep source order and insideFirst=false retain their historical formation, traversal and cleanup path. The ordinary single-group one-pass route keeps existing open-contour ranking and arc bytes; original open paths never become invented closed parents. Their enclosure depths are still calculated with the historical per-process-group containment predicate, then placed in separate original-open depth packets. A private runtime-only splitter symbol distinguishes those packets during cleanup and is stripped before every retained segment reaches the Job, worker or archive.

The parent ID is scoped compilation identity, not an artwork ID. sourceObjectId remains the existing operation/artwork run anchor, and operationSettings remains process provenance. No nearest-source owner is fabricated for split geometry.

## Saved jobs and exact replay

Both new fields are optional plain enumerable strings/records. Runtime Maps/Sets used by geometry and planning are not stored in a Job. Historical jobs already carried nesting, sourceObjectId and operationSettings; none of those older fields opts them into the new packet planner. Only the new scope plus parent marker does.

The Start worker clones the complete prepared Job independently of the packed canvas motion manifest. The strict artifact export codec retains the new plain fields. Raster recipe hydration preserves the stored vector groups and replaces only raster buffers/providers. Exact replay emits the stored Job without path optimisation. The emitter revision advances once to v17 for this new output behaviour; it is provenance, not a historical dispatcher.

Fixed pre-K1 programs and fingerprints protect heterogeneous settings/passes with old nesting, repeated nonadjacent A80/B40/C80 source powers, uniform Fill, uniform Line passes, native arcs and original opens. A sealed v16 provenance envelope must still re-emit its fixed old prepared Job under v17; reversing its stored groups must fail the exact byte binding. Clone/worker/export and mixed raster hydration controls test actual emission and fingerprints, not the revision label alone.

## Verification and limits

The prepared process/ownership/boundary, compensated split/drop, working-policy and segmented-parent tests exercise all three Fill styles and the compile/optimise/emission path. Additional context, fixed-byte, archive and checked-failure controls qualify settings, pass barriers, skip-inner tabs, empty/failed jigs, ordinary output and partial valid output. Existing kerf, arc, tab/anchor, overlap and replay controls remain required.

Geometry booleans use the existing checked 1 micrometre grid. Peer travel remains nearest-neighbour rather than a global tour optimum. Canvas automatic-tab hints continue to describe selected source artwork; Preview and output describe the compiled topology. Code and local test evidence do not establish controller, air-cut, material or hardware qualification. No hardware was operated.
