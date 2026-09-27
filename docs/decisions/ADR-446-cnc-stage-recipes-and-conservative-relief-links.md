## ADR-446 - CNC stage recipes and conservative relief links (2026-09-27)

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
the nominal chipload after feed limits. Relief rows kept independent entries even
on flat interior regions, while an indiscriminate link could cross unknown stock
or take longer than a retract. The surfacing form concealed its cutting recipe.

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
4. Optionally join only equal-height unmasked planar finishing rows. Retrace exact
   existing vertices to an interior connector and back to the next original row
   start; preserve every original row vertex and one recovery pass per row. A full
   cutter-cylinder envelope must remain inside the known physical domain and
   above every overlapping height sample plus an interpolation halo. No external
   stock is assumed clear. Include actual formatted/GRBL-parsed XY endpoint error
   under the residual isometry and parsed Z. Non-isometric residual transforms,
   masks, obstructions, incomplete evidence and boundaries retain independent
   entries. This model does not qualify fixtures or unsampled source detail.
5. After the geometry proof, retain a link only when the represented extra
   connector/retrace distance at the final capped finishing feed costs less than
   the removed plunge at the final capped plunge feed. Ignore removed rapid
   savings. Missing or nonfinite values restore independent entries. This cheap
   filter avoids demonstrated slow-feed regressions; acceleration, transport and
   actual elapsed time still require qualification.
6. Record the exact prefix length of an optional row link. Any nonzero later job
   origin translation, or tile clipping/translation, restores the original row
   before transforming it; the old placement proof must not travel to new
   coordinates. Zero translation retains it. The prefix metadata is not G-code.
7. Reuse supplied compiled output in dropped-vector diagnostics before collecting
   or planning geometry again. Existing compiled completeness evidence remains
   authoritative. Legacy diagnostic calls without compiled output retain their
   prior planning path.
8. Expose surfacing feed, plunge, RPM and stepdown. Seed from the active cutter and
   material when available, preserve manual edits while that source is unchanged,
   and refresh defaults when cutter/material/machine/project changes. Save the
   explicit recipe with existing machine limits and precise final depth. Generic
   values remain labelled as starting values.

### Consequences and limits

- Frame for the exact reviewed job remains the sole ordinary Start policy gate.
  No machine family is enabled beyond its existing CNC output capability.
- Old projects compile with inherited recipes until the operator explicitly
  enables a stage recipe. Version 11 files need a compatible reader.
- Links can add points and G-code lines while saving Z travel. A representative
  21-row flat fixture removes 13 of 22 safe-Z commands and changes the software
  estimate from 63.561 to 36.271 seconds at F1000/plunge200. The same geometry at
  F100/plunge1000 retains all entries because retracing would be slower.
- These are software geometry, persistence and emitted-output guarantees. They
  do not establish spindle accuracy, cutter life, surface finish, controller
  throughput, workholding, stock removal forces or physical cycle-time savings.
  Validate cutter/material/machine combinations with controlled coupons.

### Verification

Focused regression coverage includes independent stage feeds/depths; per-part
ordering with leads, ramps and tabs; material/schema persistence and malformed
recipes; represented fractional feeds; explicit surfacing fields through saved
G-code; reused diagnostic geometry; conservative relief domain/obstruction/Z
bounds; rotated large-coordinate parser errors; and exact original-row restoration
after origin and tile changes. Browser coverage exercises wall-recipe editing,
compilation, Save As/reopen and disabling the recipe. The remediation ledger holds
the commands and measured fixture details; integration gates are reported there
by the coordinating task.
