## ADR-250 Amendment 2 - A ramp owns a profile's entry only where it ramps (2026-09-28)

**Status:** Accepted; software-verified through compile, emitted G-code and emit-hash probe
checks, hardware qualification pending. | **Date:** 2026-09-28

ADR-250 carries one unnumbered amendment in `DECISIONS.md` (2026-09-12: `profileLead` round-trips
through `.lf2`, the inspector offers Arc, Line and None, and "a requested ramp owns entry while the
lead settings remain stored"). This is the second. It changes motion in one case only: the insert
of an inlay pair on a layer that carries a ramp angle. The Frame-first Start contract (ADR-228,
PROJECT.md non-negotiable 21) is unchanged: nothing here adds a guard, a refusal or a warning.

### Context

`applyProfileLeadPasses` (`profile-lead-passes.ts`) turns each closed profile-outside or
profile-inside pass into a led path3d pass: a plunge in the waste, a tangent lead-in, the contour,
a lead-out. It returns the passes unchanged whenever `settings.rampEntryDeg` is positive, which is
how the 2026-09-12 rule was built. It has two callers:

- The layer ladder (`cncGroupForLayerResolvedWithEvidence`, `compile-cnc-job.ts`). Its passes come
  from `passesForCncLayerWithEvidence`, which runs `applyRampEntry` exactly when the angle is
  positive, and profile cut types never take the adaptive, drill or V-carve route. Here the
  setting describes the passes.
- The inlay pair (`compiledInlayGroups`, `compile-cnc-operation-groups.ts`). Audit finding 1.12
  (commit 87555599a, 2026-07-25) added this call so the insert would get its lead: the insert is
  cut as profile-outside, and its wall is the one that has to fit the pocket. The pair compiles
  both groups without `applyRampEntry`, so neither ramps. ADR-273 Amendment 2 (PR #987) records
  that.

An inlay layer hides the whole Entry & travel section (`CncEntryFields` applies only to profile,
pocket, engrave and V-carve cuts). A ramp angle on an inlay layer is left over from an earlier cut
type, and the operator can neither see nor clear it. That angle made the helper hand the insert's
entry to a ramp that is never cut.

This was found while writing ADR-273 Amendment 2. It was reproduced on main 7b0e09798, and again
on 0bbb5ba78, with `compileCncJob` and `cncGrblStrategy.emit`: a 30 mm square pair, 6.35 mm deep
at 2 mm per pass, pocket 3 mm, allowance 0.1 mm, spacing 10 mm, the 3.175 mm end mill, default
origin.

- No ramp: each insert depth starts with `G0 X93.119 Y316.839` and `G1 Z-2.000 F300` in the waste.
  It then feeds `G1 X93.075 Y317.251 Z-2.000 F1000` and on round the arc to the contour at
  `X91.570 Y318.464`.
- A leftover 5 degree ramp with tabs off: `G0 X91.570 Y318.464`, then `G1 Z-2.000 F300`. The
  plunge lands on the insert's wall. Each further depth retracts (`G0 Z3.810`) and plunges again
  at the same point (`G1 Z-4.000 F300`), with no lead-out.
- With the default tabs, all five insert passes (Z -2, -4, the -4.35 tab top, -6, -6.35) plunge at
  `X91.570 Y318.464`. Without the ramp, all five start at `X93.119 Y316.839`.

### The question and the evidence

Should a lead apply where the ramp does not? Yes. ADR-250 exists because a straight plunge at the
tangent point marks the finished wall. The 2026-09-12 rule assumed that the ramp replaces that
plunge. Where no ramp is cut, the rule leaves the very plunge ADR-250 was written to move, and here
it lands on the wall of an insert that has to fit.

Three ways to do that were measured with an emit-hash probe (not committed). The probe compiles and
emits 3,246 programs on main and on a candidate, then compares their hashes. It ran on main
7b0e09798 and again on 0bbb5ba78, which emits all 3,246 programs unchanged. The matrix covers:

- outside and inside profiles over seven shapes: a square, a part with a 10 mm hole, a part with a
  4 mm hole, a circle, two parts, two coincident copies and a 3.9 mm square;
- for each shape: no ramp, 5 or 20 degrees; tabs off and on; four lead settings (the default arc,
  line, none, a 0.2 mm arc); finish allowance off and 0.3 mm; 6.35 mm at 2 mm and 3 mm at 1.5 mm;
  climb and conventional;
- a ball nose, a 60 degree V-bit, a 6.35 mm end mill, and the mirrored front-right frame;
- on-path, engrave, and offset, raster, adaptive, rest-machined and allowance pockets, drilling
  and a V-carve;
- inlay pairs over five shapes with every ramp, tab and lead setting, in both frames.

1. **The helper decides per pass**, leading every closed pass the ramp left level. This was
   prototyped by removing the setting check. 238 programs change: the 120 intended inlay programs
   and 118 ramped profiles.
   - In a ramped outside profile of a 40 mm part with a 4 mm hole, the ramp leaves the hole's
     passes as disclosed plunges (ADR-471). The outer loop's ramped passes are no longer closed,
     so the hole is the only closed loop left. `dominantWindingSign` takes it for the outer
     boundary, and its lead runs outward into the kept part.
   - With the default lead, the first plunge moves from `X60.180 Y339.634` on the hole's path to
     `X59.441 Y337.514`, 2.55 mm from the hole's centre. The hole's radius is 2 mm, and the same
     happens at every depth.
   - In 88 of the 96 outside profiles of that part with a lead, the cutter reaches 0.23 to 2.14 mm
     past the hole's edge. All 96 lose `; cnc entry-advisory: N passes plunge: path shorter than
     one cut width`, which main prints for every one of them.
   - The other 22 are 3.9 mm inside squares with the 0.2 mm arc. They gain leads inside the square,
     and 14 of them lose the same disclosure.
   The passes alone cannot say whether a ramp owns their entry.
2. **Each caller says whether its passes ramped**, as an explicit argument.
3. **The inlay callback hands the helper its settings without the ramp.** Options 2 and 3 give the
   same programs: the helper uses the angle only for its early return, and the layer ladder's angle
   already describes its passes. Option 3 was measured: 120 programs change, all of them inlay pairs
   with a ramp and a lead. The other 3,126 are byte-identical, including every ramped profile and
   every pair without a ramp or with `shape: 'none'`.

### Decision

1. **A ramp owns a profile's entry only where it ramps.** The lead helper still reads the ramp from
   the settings it is given, and those settings must describe the ramp its passes were compiled
   with. The layer ladder passes the layer's settings. `compiledInlayGroups` passes each inlay
   group's settings without `rampEntryDeg`, because neither group ramps.
2. **An inlay insert enters the same way with or without a leftover angle.** It plunges in the
   waste at its lead start, then takes the tangent lead-in and lead-out on every depth and tab ring.
   `profileLead: { shape: 'none' }` still opts out. The pocket takes no lead and is unchanged. Only
   the group comments still differ: `; cnc entry: contour-ramp` stays on both inlay groups until
   ADR-273 Amendment 2 removes it.
3. `EMITTER_REVISION` advances to
   `relief-ramp-plunges-disclosed-masked-relief-inlay-lead-20260928-v3`, carrying ADR-484's value
   forward.

Not chosen:

- Deciding per pass (option 1). The measurements above show it gouges parts with small holes and
  hides ADR-471's plunge disclosure. Leading the passes a ramp leaves as plunges would need the
  ramped loops kept as the winding reference, and its own evidence.
- An explicit ramp argument (option 2). It gives the same programs but changes the signature at
  both callers and in two test files. Once ADR-273 Amendment 2 lands, its `rampedEntry` for the
  layer ladder could feed such an argument.
- Ramping the inlay pair with the leftover angle. ADR-273 Amendment 2 keeps both groups unramped,
  and inlay layers never offer the setting.

### Consequences

- An inlay insert's motion no longer depends on a setting its layer card does not show. The Frame
  envelope follows the passes, so it covers the lead, as it already did without a ramp.
- Unchanged: every ramped profile, including the passes ADR-471 leaves to plunge.
- Found, not changed: an inlay layer also hides Profile leads. A lead shape, radius or sweep stored
  from an earlier profile cut type still shapes the insert's lead, and a stored `shape: 'none'`
  removes it.
- Integration: PR #987 (ADR-273 Amendment 2, open) edits the same inlay callback. The callback and
  WORKFLOW.md merge without a conflict, and the merged callback keeps both changes. Only the
  `EMITTER_REVISION` lines conflict, as #987's already do against main, so whichever lands second
  needs a combined value.

### Verification

- `compile-cnc-inlay.test.ts` compiles the 30 mm pair with and without a 5 degree ramp, with tabs
  off and on. It requires the same pocket and insert passes, with every insert pass led. Both cases
  fail on main 7b0e09798 and on 0bbb5ba78 (`expected false to be true`) and pass with the change.
- The probe above was run on main in a separate worktree and on the change, before and after
  rebasing from 7b0e09798 onto 0bbb5ba78, with the same results. With the comment lines that start
  `; cnc entry` removed, all 160 ramped inlay programs match their unramped programs after the
  change. On main, only the 40 with `shape: 'none'` matched.
- The CNC, output and G-code suites pass on 0bbb5ba78: 228 files, 1,621 tests, 1 skipped, run
  with `--testTimeout=60000` on a shared machine. `pnpm typecheck`, ESLint and Prettier on the
  changed files, and the ADR number, file-size and index-export gates, pass.
- No hardware run was made. The insert's entry is verified in emitted G-code only. An air cut or a
  scrap coupon is still needed before a hardware claim.
