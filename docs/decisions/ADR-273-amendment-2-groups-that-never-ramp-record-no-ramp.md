## ADR-273 Amendment 2 - Groups that never ramp record no ramp entry (2026-09-28)

**Status:** Accepted; software-verified through compile, emitter and Job Review tests; motion
unchanged. | **Date:** 2026-09-28

Amends ADR-273 item 1, which lets a compiler record only values that truthfully describe a group,
and extends Amendment 1 from relief groups to every CNC group. The Frame-first Start contract
(ADR-228, PROJECT.md non-negotiable 21) is unchanged: nothing here adds a guard, a refusal or a
warning, and no motion changes.

### Context

A layer's Ramp entry angle (`rampEntryDeg`) ramps only two kinds of pass list through
`applyRampEntry` (`motion-polish.ts`): the ordinary contour ladder of profile, pocket and engrave
cuts (`passesForCncLayerWithEvidence`), and rest-pocket roughing. Other groups built from the same
layer never pass through it:

- `specializedPassesForLayer` returns adaptive, drill and V-carve passes as planned. Adaptive
  roughing enters each level on the planner's own fixed 3 degree helix, and its finishing rings
  plunge. A drill pecks straight down.
- A helical pocket (`helixEntry`) is all helical passes, which `applyRampEntry` leaves alone.
- An inlay pair compiles its pocket and its insert through `compiledInlayGroups`, without it.

`cncGroupProvenance` copies the layer's angle unless told not to (`includeRampEntry ?? true`), and
all of these groups used the default. Amendment 1 fixed the same fault for relief groups only. The
layer card shows Ramp entry for every pocket, adaptive included. Drill and inlay layers hide the
row, so an angle they carry is left over from an earlier cut type and cannot be cleared there.

Found on main 0f516c35b during the ADR-471 ramp work, which recorded it for follow-up, and
reproduced on main 52cb50cce and again on 8e037c2fc, after ADR-471 landed, with `compileCncJob`
and `cncGrblStrategy.emit`, a 5 degree ramp and 1.5 mm per pass:

- adaptive pocket, 30 mm square, 3 mm deep: `; cnc entry: contour-ramp; max-angle-deg: 5.000`
  above roughing that enters on its helix (`G3 X33.814 Y365.005 Z-0.188 I-1.191 J0.000 F300`) and
  three straight descents at the plunge feed: onto each level's finishing ring
  (`G1 Z-1.500 F300`, `G1 Z-3.000 F300`) and back down the first level's helix bore. No descent
  runs along a path.
- inlay pair, 30 mm square: the female pocket (22 straight descents) and the male insert (13)
  both printed the line, and both first descend with `G1 Z-2.000 F300`.
- drill, two holes 3 mm deep, with a ramp left from an earlier cut type: the line above four
  straight pecks.
- a pocket carrying both `helixEntry` and `rampEntryDeg`, which the layer card keeps exclusive but
  a saved project can hold: the line claimed 5 degrees above 22 helical entries at the helix's
  3 degrees.
- a hand-built `rampEntryDeg: 0`, which project loading drops: `max-angle-deg: 0.000` above 22
  plunges.
- Job Review's operation line read `… · ramp entry 5° · …` for all of them.

The ramping cuts were right: offset and raster pockets, outside profiles with and without tabs,
an engrave, and both groups of a rest-machined pocket claim the ramp and first descend along their
paths. A V-carve's request (`vCarveRampEntryDeg`) belongs to the V-carve: its header names the
spiral ramp its planner cuts, or discloses that the medial depth profile governs (ADR-285 item 6),
and its clearing group already records none.

### Decision

1. **A group records the layer's ramp angle only when its passes ramp.**
   `passesForCncLayerWithEvidence` reports `rampedEntry`, true only for the ordinary contour ladder
   with a positive angle and passes the ramp can shape (contour passes and tabbed profile paths).
   `compile-cnc-job.ts` passes it on as `includeRampEntry`, so adaptive, drill and helical pocket
   groups record no ramp; `compiledInlayGroups` passes `includeRampEntry: false` for the pocket and
   the insert. Rest-pocket roughing ramps and keeps its claim, as do profile finishing stages,
   which ramp with their roughing. The ramp still decides per path: a path it leaves as a
   disclosed plunge (ADR-471 item 4) does not take the claim from its group. A V-carve keeps its
   own request and disclosure, and relief keeps Amendment 1 and ADR-424. A group without a
   `; cnc entry:` line enters its own way: on a helix, or by plunging.
2. **Job Review qualifies the ramp from the compiled job.** When an operation asks for a ramp and
   none of its compiled shape groups records one, the operation line keeps the request and names
   the shapes it misses: `ramp entry 5° (not used by adaptive clearing)`, `(not used by
   drilling)`, `(not used by the inlay pocket or insert)` or `(not used by the helical pocket)`.
   Relief notes follow: `ramp entry 5° (not used by adaptive clearing; relief finishing plunges)`.
   Helix and V-carve requests read as before.
3. **Motion is unchanged.** Only the entry comments of these groups change. `EMITTER_REVISION`
   advances to `trace-arcs-relief-width-ramp-contact-air-scan-v2-unramped-groups-20260928-v8`.

Not chosen:

- Making these groups ramp. Adaptive roughing already enters on a helix, a drill pecks by design,
  and drill and inlay layers never offer the setting. Ramping them is a motion change that needs
  its own evidence, as ADR-471 does for short paths.
- Defaulting `includeRampEntry` to false. Every site that ramps would have to opt in, and a
  group-building site on another branch would silently stop recording a ramp it cuts. Instead the
  regression test states the rule for every cut type.
- Hiding Ramp entry for adaptive pockets. On a layer that also carries reliefs the angle still
  ramps relief roughing (ADR-424); Job Review now says that adaptive clearing does not use it.

### Consequences

- No CNC header claims the layer's contour ramp above a helix or a straight plunge.
- Job Review no longer shows an unqualified ramp on an operation whose shapes never ramp.
- Unchanged: the adaptive helix and a helical pocket's helix have no header line of their own, and
  a generic ramp on a path shorter than one cut width plunges under a ramp header (ADR-471 discloses
  it).
- Found, not changed: an inlay insert keeps no lead-in when its layer carries a ramp.
  `applyProfileLeadPasses` leaves the entry to "an active ramp" whenever `rampEntryDeg` is
  positive, but the insert never ramps. On the 30 mm inlay, a leftover 5 degree ramp moves the
  insert's plunge from its lead start (`X93.119 Y316.839`) onto the part edge (`X91.570
  Y318.464`) and drops the ADR-250 arc. That is motion and needs its own decision.
- Found, not changed: the layer card's Entry & travel summary still reads `Ramp 5°` on an
  adaptive pocket. It already leaves the helix out for adaptive pockets, but not the ramp.
- Integration: built on main 8e037c2fc, after PR #959 (stage recipes: the group builder moved to
  `compile-cnc-pass-group.ts`, and profile-finish stage groups take the same `includeRampEntry`),
  PR #975 (ADR-471: `rampedEntry` sits beside its `applyRampEntry` call) and PR #967 (ADR-224
  Amendment 3: the unramped note is the Job Review entry part's input beside the relief facts,
  and the notes compose). `EMITTER_REVISION` carries main's value forward.

### Verification

- `compile-cnc-entry-provenance.test.ts` compiles an adaptive pocket, an inlay pair, drilled
  holes, a helical pocket, an offset pocket, a rest-machined pocket, an outside profile and an
  engraved open path with a 5 degree ramp, and emits each. It states the rule for every group: a
  group records `rampEntryDeg` and its header names the ramp exactly when its first descent below
  the stock top travels along its path. A peck that restates its X and Y counts as a plunge.
  Against main's compiler (8df936df8) the adaptive, inlay, drill and helical cases fail
  (`expected 5 to be undefined`); the four ramping cases pass either way.
- `job-review-unramped-entry.test.ts` checks which operations count as unramped, each note, that
  helix and V-carve requests stay unqualified, and the line read from compiled drill, inlay and
  offset-pocket jobs. The compiled-job case fails against main's compiler.
  `JobReviewLayersTable.test.tsx` checks the note in the rendered table.
- A probe (not committed) emitted 13 jobs before and after the change, on 52cb50cce and again on
  8e037c2fc. The only changed lines are the removed entry lines: one each for the adaptive, drill,
  helical and zero-angle pockets, and two for the inlay pair. The offset, raster, rest-machined,
  profile, tabbed profile, engrave and V-carve programs, and an inlay pair without a ramp, are
  byte-identical.
- The CNC, output, G-code and Job Review suites pass on 8e037c2fc: 262 files, 1,860 tests, 1
  skipped, run with `--testTimeout=60000` on a loaded machine. After rebasing onto 8df936df8,
  which touches none of these files, the entry, Job Review and G-code tests (78 files, 587 tests)
  pass again. `pnpm typecheck`, ESLint and Prettier on the changed files, and the ADR, file-size
  and index-export gates pass.
- No hardware run was made. Motion is unchanged.
