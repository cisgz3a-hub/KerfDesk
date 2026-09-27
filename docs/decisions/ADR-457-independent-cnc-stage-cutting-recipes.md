## ADR-457 - Independent CNC stage cutting recipes (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

### Context

The speed and quality audit examined an older checkout. Current main already
preserves single-peck drilling, global clearing-before-profile dependencies,
finishing-only reliefs, machine-space cutter geometry, bounded requested planar
scallops, and stock-aware V-floor finishing. Remaining improvements must preserve
these contracts. A faster program is useful only when it retains the intended
cutting conditions, surface and operation completeness.

Secondary cutters and wall finishing previously inherited the primary operation's
feed, plunge, RPM and stepdown. A calculator's chart chipload also differed from
the nominal chipload after feed limits. The surfacing form concealed its cutting
recipe. During publication, main gained exact-contact relief finishing, linked
rasters, waterlines and finished-flat skipping (ADR-412/421/423/450). The stage
recipes must compose with those planners rather than replace them.

### Decision

1. Add optional cutter-bound recipes for pocket roughing, V clearing, relief
   finishing and profile wall finishing. Missing recipes preserve legacy
   inheritance; a recipe applies only to its named cutter. Explicit manual values
   survive material changes. The editor offers material/tool starting values as an
   explicit action, and labels them as starting values requiring qualification.
   Relief finishing follows its surface directly and does not present stepdown as
   an active control. Profile finishing may now use its own depth ladder; enabling
   that recipe initially preserves the prior single full-depth finishing pass.
2. Carry recipe provenance through compiled groups, output comments and Job
   Review. Keep each part's rough/finish sequence, tabs, ramps, leads, tool sections
   and existing dependency order. Changing feeds or RPM with the same cutter is
   not a manual tool change. Warn about inherited secondary feeds only when a
   secondary group actually inherits them. Display chart chipload separately from
   programmed nominal chipload computed from the emitter's represented F/S words.
   Nominal chipload is not measured instantaneous chip thickness.
3. Raise the project schema to 11. Version 10 migrates without invented recipes;
   malformed present recipes are rejected structurally before normalization.
   An older reader must not silently discard motion settings. Existing complete
   scene/machine preparation identities and prepared-project recovery persistence
   include recipes and tool edits without a second allowlist.
4. Preserve the active relief planner's exact-contact calculation, requested row
   spacing, raster-axis choice, waterlines, finished-flat evidence and established
   mask behavior. Apply the finishing recipe to its actual finishing groups while
   roughing and flat finishing retain their proper cutter and cutting values.
   Keep the upstream planner's own contact, sampling, representation and path
   reduction qualifications. This change does not add a second link algorithm.
   The earlier planar-only prototype and its cost/prefix metadata are superseded
   before publication; its archived benchmark is not a measurement of this final
   planner and its clearance proof must not be attributed to upstream links.
5. Reuse supplied compiled output in dropped-vector diagnostics before collecting
   or planning geometry again. Existing compiled completeness evidence remains
   authoritative. Legacy diagnostic calls without compiled output retain their
   prior planning path.
6. Expose surfacing feed, plunge, RPM and stepdown. Seed from the active cutter and
   material when available, preserve manual edits while that source is unchanged,
   and refresh defaults when cutter/material/machine/project changes. Save the
   explicit recipe with existing machine limits and precise final depth. Generic
   values remain labelled as starting values.

### Consequences and limits

- Frame for the exact reviewed job remains the sole ordinary Start policy gate.
  No machine family is enabled beyond its existing CNC output capability.
- Old projects compile with inherited recipes until the operator explicitly
  enables a stage recipe. Version 11 files need a compatible reader.
- Relief motion follows the planner already on main. Its bounded one-sided point
  reduction can leave up to 0.002 mm more stock relative to its unreduced sampled
  path (ADR-421); that is distinct from the lossless laser Fill compaction. There
  is no universal cycle-time improvement claim for every recipe or strategy.
- These are software geometry, persistence and emitted-output guarantees. They
  do not establish spindle accuracy, cutter life, surface finish, controller
  throughput, workholding, stock removal forces or physical cycle-time savings.
  Validate cutter/material/machine combinations with controlled coupons.

### Verification

Focused regression coverage includes independent stage feeds/depths; per-part
ordering with leads, ramps and tabs; material/schema persistence and malformed
recipes; represented fractional feeds; explicit surfacing fields through saved
G-code; reused diagnostic geometry; immutable artifact/stage separation; and
stage recipes combined with the current relief strategies. Existing upstream
contact, mask, path, waterline and flat-finishing checks remain applicable.
Browser coverage exercises wall-recipe editing,
compilation, Save As/reopen and disabling the recipe. The remediation ledger holds
the commands and measured fixture details; integration gates are reported there
by the coordinating task.
