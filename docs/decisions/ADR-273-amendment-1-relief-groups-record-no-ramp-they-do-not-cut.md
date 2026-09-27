## ADR-273 Amendment 1 - Relief groups record no ramp entry they do not cut (2026-09-27)

**Status:** Accepted; software-verified through compile, emitter and Job Review tests; motion
unchanged. | **Date:** 2026-09-27

Amends ADR-273 item 1, which lets a compiler record only values that truthfully describe a group,
and which already keeps a relief group from claiming the layer's requested depth. The Frame-first
Start contract (ADR-228, PROJECT.md non-negotiable 21) is unchanged: nothing here adds a guard, a
refusal or a warning, and no motion changes.

### Context

A CNC layer's Ramp entry angle (`rampEntryDeg`) ramps the layer's profile, pocket and engrave
paths through `applyRampEntry` (`motion-polish.ts`). Relief objects on the same layer compile
through `compile-cnc-relief.ts`, which never calls it. Every roughing ring is a flat contour pass
and every finishing row a surface path, and the emitter reaches each start with a rapid at safe Z
and a straight plunge at the plunge feed. But `reliefGroup` built its provenance with
`cncGroupProvenance`, whose ramp entry defaults on, so both relief groups carried the layer's
angle, and the G-code header claimed an entry the group never made.

This was found during the ADR-427 relief direction work and reproduced on main 1b12a71ce with a
20 mm flat relief, 3 mm deep, 1.5 mm per level and a 5 degree ramp:

- relief roughing: 8 contour passes under `; cnc entry: contour-ramp; max-angle-deg: 5.000`,
  entered by `G0 X0.000 Y399.603` then `G1 Z-1.500 F300`;
- relief finishing with a 3.175 mm ball nose: 63 rows under the same line, entered by
  `G1 Z-3.000 F300`;
- the whole job: 71 straight descents below the stock top, none along a path;
- Job Review's operation line: `… · ramp entry 5° · …`.

On a layer holding a 20 mm square and the relief, the square's profile did ramp, from `Z0` to
`G1 X51.430 Y360.000 Z-1.000 F1000`. The layer setting is real for its other shapes; only the
relief groups misreported it.

Two remedies were weighed: stop claiming the ramp, or make relief rings ramp. A prototype applied
`applyRampEntry` to relief roughing passes to measure the second.

- **The envelope holds.** Every ramped vertex lies on its own ring (at most 1.2e-14 mm off) and
  at or above the ring's level. The ramp therefore sweeps a subset of the ring's own sweep, which
  ADR-289's dilated heightmap already covers. The removal simulator agreed: plain and ramped
  roughing of the flat relief differ in 0 of 69,696 cells at 0.1 mm.
- **It does not avoid the plunges.** The helper's rule for where a ramp starts serves profiles,
  which deepen one contour level by level. In a relief ladder, which cuts every ring of a level
  before the next, every ring after a level's first ramps from the stock top. On a 60 mm dome,
  8 mm deep, with 2 mm levels and a 3.175 mm end mill at 40%, 60 of 62 rings ramped from Z0, so
  rings below the first level spent most of their ramp descending through stock already cleared,
  and roughing gained about 1.75 m of path. 28 rings were shorter than their ramp and ended in
  straight descents of up to 5.4 mm.
- **Inside out it misses the plunge that matters.** Cut inside out (ADR-427, PR #952), each level
  enters fresh stock on its smallest ring. On the dome's second level that ring is 0.13 mm long,
  so 1.99 of its 2 mm descent stayed a plunge.

A relief ramp that works has to start from the level above, wrap round short rings, and deal with
loops too small to ramp on. ADR-424 (PR #939) ramps relief roughing that way. It merged on
2026-09-27 while this amendment was in review; this amendment does not duplicate it. On current
main, relief finishing is the stage that still plunges under a claimed ramp.

### Decision

1. **A relief group records no ramp entry it does not cut.** `reliefGroup` passes
   `includeRampEntry: false`, as the V-carve clearing group already does and as relief already
   declines the layer's requested depth, so a relief group's generic provenance never copies the
   layer's angle. A relief stage that ramps records its angle itself: since ADR-424 the roughing
   group sets `rampEntryDeg` when it ramps, and its header keeps `; cnc entry: contour-ramp`.
   Relief finishing, whose rows plunge, carries no `; cnc entry:` line, which is how every group
   that plunges reads.
2. **Job Review names the relief stages that plunge.** The compiled job decides: a relief group
   without `rampEntryDeg` plunges. The operation line keeps the layer's request and adds those
   stages: `ramp entry 5° (relief finishing plunges)`, `(relief roughing plunges)`, or
   `(relief passes plunge)` when both do. The same note qualifies a helix entry request and a
   V-carve's `requested entry 3° (medial depth profile governs; relief passes plunge)`.
3. **Motion is unchanged.** Only the entry comments of relief groups that plunge change.
   `EMITTER_REVISION` advances; merged with main after ADR-424 it reads
   `adaptive-flat-slices-relief-entry-20260927-v1`.

Not chosen: keeping the angle on relief groups as `requested-max-angle-deg` with a plunge
advisory, the pattern ADR-285 item 6 uses for V-carve. A V-carve's ramp request belongs to that
operation alone, while a layer's ramp belongs to its other shapes. The advisory would also have to
learn which relief planner ramps, and would mislabel ADR-424's roughing, which does.

### Consequences

- No relief header claims a contour ramp over a straight plunge: roughing records only the ramp
  it cuts (ADR-424), finishing records none.
- Job Review no longer shows an unqualified ramp on a layer whose relief passes plunge.
- The layer card still shows Ramp entry on relief layers whose cut type has it. It ramps the
  layer's other shapes and, since ADR-424, relief roughing.
- Not changed: a generic ramp on a path shorter than the ramp finishes its descent straight down
  at the path end (WORKFLOW F-CNC18) under a `max-angle-deg` header. That concerns profiles and
  pockets, not relief, and needs its own decision.
- Integration: PR #939 (ADR-424) merged first. Its roughing group sets `rampEntryDeg` itself, so
  on the integrated branch roughing records the ramp it cuts, finishing records none, and Job
  Review reads `(relief finishing plunges)`. Only the emitter metadata conflicted. PR #952 also
  changes `EMITTER_REVISION`; whichever lands later takes a combined value.

### Verification

- `compile-cnc-relief-entry-provenance.test.ts` compiles the flat relief with a 5 degree ramp,
  with a finishing ball nose and beside a square profile, and emits it. It states the rule: a
  group records `rampEntryDeg` and its header names the ramp exactly when its first descent below
  the stock top travels along its path; otherwise that descent is a straight `G1 Z… F300`. Before
  ADR-424 the relief groups claimed nothing and plunged; after it, roughing claims its ramp and
  descends along its first ring while finishing claims nothing and plunges. The square claims its
  5 degree ramp and descends along its path. Against the compiler before this amendment both
  cases fail: `expected 'G1 Z-1.500 F300' to match` the along-path pattern.
- `job-review-relief-entry.test.ts` checks which compiled relief stages count as plunging, and
  the operation line for ramp, helix and V-carve requests. `JobReviewLayersTable.test.tsx` checks
  the line in the rendered table. Against the previous code the first file fails in all three
  cases.
- Before ADR-424 landed, a 40 mm dome relief with roughing and finishing, emitted before and after
  this change: the programs differ only by the two removed
  `; cnc entry: contour-ramp; max-angle-deg: 5.000` lines; all 18,248 other lines are identical.
- Before ADR-424 landed, in the running app (Vite dev server, CNC mode, the flat relief with a
  5 degree ramp and a finishing bit), the app's own output preparation gave both relief groups no
  ramp and no entry line, and Job Review's operation line read
  `… · ramp entry 5° (relief passes plunge) · …`. The Job Review dialog itself was not opened:
  Start preparation needs a connected controller.
- A trial merge with PR #939 at 7832643af: relief roughing claims the ramp and enters along its
  path (`G1X8.890Y391.110Z-0.097F1000`), finishing claims nothing and plunges
  (`G1 Z-3.000 F300`), Job Review names only relief finishing, and all the tests above pass. PR
  #939 alone still has its finishing group claim the ramp above that plunge.
- On the branch integrated with main after ADR-424 (9f5c09a12), the same flat relief with a
  finishing bit: roughing claims its ramp and enters along its first ring, finishing claims none
  and enters with `G1 Z-3.000 F300`, and Job Review reads
  `… · ramp entry 5° (relief finishing plunges) · …`. `pnpm typecheck` passes. The relief, CNC,
  output, G-code and Job Review suites pass 2,222 tests. Five others timed out under machine
  load. Run alone, three pass; the other two pass their assertions given more time, in 5.1 to
  6.3 s with or without this change, against vitest's 5 s default.
- No hardware run was made. Motion is unchanged.
