## ADR-341 Amendment 9 - Painted passes retain motion context and dark transitions

**Status:** Accepted. | **Date:** 2026-09-28

### Context

The selected-area audit reproduced five defects on `be04c885b`: air/mode changes could
drain a constant-power program while its beam remained powered; trimming to a short
original overscan could change the speed through a selected region; a late archive
activation failure lost the second-pass offer; rotary runs received a flat-only editor
offer; and a short viewport clipped Start. It also measured dense preview drawing on
the UI thread and identified missing selected-stroke and power-cap feedback.

The ordinary laser emitter already protects transitions after M3 cutting. The painted
writer had reconstructed its own transitions without that contract. Retaining programmed
F/S and geometric coverage alone did not prove equivalent execution: at F6000 with
500 mm/s² acceleration, a 2 mm selection with 1 mm runways cannot reach the original
100 mm/s at the selected centre; its acceleration bound is 44.72 mm/s.

### Decision

1. **New painted output uses writer 3.** Writers 1 and 2 remain available for byte-exact
   replay of saved stages. A new stage records version 3, including when its source
   contains an older stage. The Frame permit and recovery chain continue to bind the
   exact source, selection and generated program.
2. **Preserve connected motion context.** Without sealed evidence that a shortened
   approach has the same velocity envelope, writer 3 retains the original connected
   moves around selected burning motion. Rapid travel, feed changes and dark turns do not alone prove
   a stop, so they remain connected. Unselected parts receive S0; contexts with no selected
   burn can be omitted between actual synchronising state changes. Those stops remain in
   the output even if the final beam/air state is unchanged. This intentionally allows a
   longer dark route than writer 2. Matching controller/material behaviour remains a
   hardware qualification question.
   The boundary rules follow the spindle/coolant execution and laser-force-sync
   handling in the [pinned GRBL parser](https://raw.githubusercontent.com/gnea/grbl/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c).
3. **Make draining transitions dark.** Air and beam-mode changes after constant-power
   burning follow a real dark move. If adjacent burns share an endpoint, use a bounded
   dark excursion along the upcoming path instead of assuming a coincident move turns
   off the beam before a planner drain. The exact resulting motion, including the
   excursion, remains in the prepared bounds and Frame.
4. **Keep accepted runs after either archive failure phase.** A failure while activating
   a successfully staged archive receives the same page-only source fallback as failed
   staging. That fallback belongs to the accepted run; interruption or a newer run must
   not resurrect its completion offer. Only existing clean-settle evidence offers a
   second pass. Missing persistent recovery remains disclosed truthfully.
   All accepted unarchived runs keep a lifecycle identity, even when no eligible
   second-pass artifact is retained. Proven completion retires only its own pending
   Start intent; interruption stops that run's lease and reconciles its uncertainty.
   Delayed cleanup and retries bind to run, arm time and repository generation.
5. **Use one supported-source check.** The offer, retention and worker agree on flat
   laser/controller eligibility. Rotary runs receive no flat-only editor offer. This
   does not add rotary, Marlin or Smoothieware transformation support.
6. **Improve workbench feedback and layout.** A scrollable body keeps footer actions
   reachable at short heights. Selecting a stroke highlights it without changing the
   painted mask. Preview immediately discloses capped power; Job Review retains the
   same warning. Rendering, selection and machine output remain separate.
7. **Cache only display pixels during interaction.** Dense backgrounds use a bitmap
   during pan/zoom and redraw exact visible paths after settling. Source changes,
   preview changes, size changes and display-mode changes invalidate the appropriate
   cache. Brush hit coordinates and all emitted geometry remain unchanged.

### Consequences and compatibility

- A narrow selection can travel farther than writer 2, including across unselected raster rows.
  This removes an unsupported speed-equivalence assumption; it is not a new Start gate.
- Historical writer versions reproduce their recorded bytes and historical behaviour.
  They are not silently rewritten or represented as having received writer 3's repairs.
- G17 XY I/J arcs remain supported using stock GRBL `$12 = 0.002 mm` (ADR-432).
  Sealing actual arc settings and new controller/rotary dialect support remain separate
  work. The workflow documentation now states the implemented subset.
- No new dependency, archive-budget increase or physical-machine operation is required.
  Frame remains the sole ordinary Start policy gate under ADRs 228/230/232/237.

### Verification

The repair record under `docs/audits/2026-09-28-second-pass-quality/` records final
commands and results. Regression coverage must exercise independent lit-transition and
kinematic checks; fixed legacy writer bytes; interruption/replacement during storage
failure; supported-source eligibility; small-screen action reachability; stroke/cap
feedback; cache invalidation and interaction cost; and writer-3 Start/archive/recovery
through the browser's simulated serial transport.

Software and simulated-controller results are distinct from physical alignment,
material darkness, real controller timing and hosted publication.
