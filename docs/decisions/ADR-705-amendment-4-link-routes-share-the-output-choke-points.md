## ADR-705 Amendment 4 - Link routes share the output choke points (2026-11-11)

**Status:** Accepted. Amends ADR-705 (Moshiboard) and ADR-697 (Ruida over UDP), and the Save
`.rd` path of ADR-097. Fixes code quality audit C2 D2-P1-1, D2-P1-3, D2-P2-1, D2-P2-2, D2-P2-3,
D2-P3-2 and part of D2-P3-3. **Simulator-tested only.** | **Date:** 2026-11-11

### Context

The six G-code dialects share one choke point for options, planners and warnings. The Moshi USB
and Ruida network routes built their own, and each copy missed something:

- **Output scope (D2-P1-1).** Both link routes compiled the whole canvas. "Selected artwork
  only" and "Anchor from selected artwork" were ignored, while Preview, G-code and Save `.rd`
  honoured them, so Start burned designs the operator had excluded.
- **Fill scan offset (D2-P1-3).** The Moshi Fill burned each hatch line as drawn. The
  bidirectional scan offset and the Fill runway policy were lost.
- **Job warnings (D2-P2-1).** `detectMachineJobWarnings` (compile diagnostics, job intent,
  kerf side) ran only for G-code. Save `.rd`, the Ruida network job and Moshi showed none, even
  when a kerf side was assumed and the part came out 0.8 mm oversize.
- **Power (D2-P2-2).** On a Moshi, burned tabs and lighter layers burn at the dial power. Tabs
  set to 20 % cut through, and no warning named them.
- **Variable advance (D2-P2-3).** "After completed job" never advanced after a Moshi or Ruida
  network job, so the next tag burned the same serial.

### Decision

1. **One request for every link job.** `ui/state/link-job-request.ts` builds the job input from
   the canvas: project, placement, output scope (`currentOutputScope`, as Save G-code and Start
   read it) and a completion that runs `advanceVariablesAfter(project, 'successful-stream',
   scope)`. The Moshi and Ruida panels prepare their jobs only through it. Moshi compiles with
   `{ outputScope }`; Ruida passes it through `EmitRdOptions`, as Save `.rd` does.
2. **Each store runs the completion when the machine reports the job finished.** That is the
   board reporting ready after the last program, or the controller reading idle after the run.
   A Frame or Home never runs it. `advanceVariablesAfter` applies the project's own policy.
3. **The Moshi Fill uses the G-code Fill planner.** `moshi-fill-plan.ts` takes Scan Line sweeps
   from `planFillSweeps(group, scanOffsetMm)`, with the layer's offset, else the machine's speed
   table. It walks them as `grbl-fill-emission.ts` does: the runway, laser-off up to the first
   ink, a cut over each span, laser-off over the gaps, then the exit runway. Every row therefore
   moves half the offset along its travel, as G-code does (ADR-052 Amendment 2). The runway
   policy follows the group, and the Moshi-only `withRunways` copy is gone. A runway that would
   pass the home corner is shortened at 0; a burn never is. An Offset fill still burns its
   contours as lines.
4. **One job-warning list on every route.** Save `.rd` (window and worker), the Ruida network
   job and the Moshi job add `detectMachineJobWarnings(project, null, null, prepared)` to their
   own advisories. This is the list Save G-code and Start show. For `.rd` it comes through
   `emitPreparedRdWithJobWarnings`, which fills the new optional `EmitRdResult.jobWarnings`. The
   warnings are shown from the Frame on (Amendment 3) and in the Save `.rd` toasts. They never
   refuse.
5. **What a Moshiboard cannot express is named per job.** `moshiPowerNotes` names three cases:
   - burned tabs above 0 % ("they burn at the machine's dial power and cut through");
   - layers set to different powers, which all burn at the dial power;
   - layers asking for air, which the board cannot switch.

   The encoder still names grey image pixels. These are notes, and the bytes do not change.

### Evidence

- `link-job-routes.test.ts`, for both Moshi and Ruida:
  - with "Selected artwork only" on, the job's footprint covers the selected square only, while
    the whole-canvas job covers both;
  - in the kerf-side case, every warning G-code shows appears in the job's advisories.
- `moshi-fill-plan.test.ts` decodes the program bytes: hatch lines without an offset burn where
  they are drawn, and a 0.4 mm offset moves each sweep 0.2 mm along its travel, whether it comes
  from the layer or from the machine table.
- `moshi-power-notes.test.ts` covers tabs, mixed powers and air, and stays silent for a single
  power with no air.
- `moshi-usb-store.test.ts` and `ruida-network-store.test.ts`: the completion runs once after
  the job finishes and never after a Frame.
