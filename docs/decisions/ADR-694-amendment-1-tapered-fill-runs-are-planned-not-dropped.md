## ADR-694 Amendment 1 - A tapered Fill's curved hatch runs are planned, not dropped (2026-11-11)

**Status:** Accepted. Amends ADR-694 (rotary taper warp), decision 6. Fixes rolling audit v14
Z4-P1-1 (`docs/audits/2026-11-10-rolling-v14/Z4-round-glass-journey.md`). Touches ADR-034's Fill
sweeps and ADR-315 Amendment 3's row check. **Simulator-tested only; not qualified on hardware.**
| **Date:** 2026-11-11

### Context

ADR-694 warps every Fill segment and splits any edge that is not vertical into chords within
0.001 mm of the curve. A hatch run is one such edge. On a taper it came out of the warp as a
polyline of many points. The Fill planner (`groupFillScanlines`, ADR-034) had skipped every run
that was not exactly two points since June 2026, and so did `isEmittableFillSegment` and both
scan-offset shifts. The warped runs therefore vanished between the job and the G-code.

The refuter measured the result on a Ø90→Ø70 tumbler. A 45° Fill burned 0.3 % of its area, a
cross-hatch 0.6 %, and a 0° Fill 7 %. Only rows close to the warp's pivot stayed straight enough
to keep two points. Every G-code dialect lost the same burn on Y, A and Z. Start and preflight
passed, Job Review was silent, and the estimate fell from 362 s to 10.5 s. ADR-694's own emit tests
had no Fill case. Ruida and Moshi walk each polyline and were not affected.

### Decision

1. **A curved run is a sweep of its own.** A Fill run of more than two points is the curve the
   warp made of one hatch run. The planner keeps it as one sweep whose single span burns
   through its interior points (`FillSpan.via`). Its runways extend along the chord from start to
   end. A curve that close to straight leaves its laser-off runway within a fraction of a
   millimetre of the tangent. Curved runs do not join their neighbours across a hole: each piece
   is its own sweep, as any run past the 5 mm split gap already is.
2. **Every consumer follows the curve.** The GRBL-family emitter (every G-code dialect) writes a
   lit G1 to each interior point. The toolpath, which drives the preview and the estimate, draws and
   times the curve. Job bounds and start bounds include its points. A reverse row's scan offset
   moves the whole run along its travel. `isEmittableFillSegment` accepts any run with motion at
   emitted precision.
3. **The feed stays per sweep.** ADR-127 Amendment 2's surface-matched feed is taken once per
   sweep, from its chord, at the local taper factor. Along one curved row the true surface length
   differs from the chord's by second-order terms, well under 1 % on the audit's parts.
4. **A plan that burns short stops output.** `assertFillPlanKeepsBurn` runs in the Fill emitter. It
   checks that the planned spans burn the length the group was compiled with, to 0.001 mm or one
   part in a million. If they do not, emission throws, naming the layer and both lengths. This is a
   factual failure, not a policy judgement: the program cannot burn what was compiled. After this
   change no known path trips it, but any future planner loss now fails loudly.
5. **The row check sees bent rows.** ADR-315 Amendment 3 read a 0° Fill's rows where their two
   ends share a machine Y, so it went silent on a taper. On a taper it now reads the rows from the
   same job with the warp left out. It then checks them at the pitch they take at each end of the
   artwork, where the warp stretches them most and least, and warns if either end bands.
6. **The preview stays surface-true.** The audit asked for the Preview and inspector to draw the
   warped machine-space job. ADR-127 keeps the canvas in surface space on purpose: it is the
   design the operator lays out, and Frame and the bounds already read the machine-space job. The
   preview showed a full hatch while the burn was not full because the planner dropped runs, not
   because the preview was in the wrong space. With runs kept and the burn-length check in place,
   the two show the same burn. The G-code Inspector, which reads the emitted program, now shows
   the full hatch too.

### Consequences

- A Fill on a tapered part burns its whole hatch at every angle and on every rotary axis.
- A tapered Fill emits more G-code lines: one G1 per chord of each curved row. A row far from the
  pivot on a strong taper may split into a few dozen chords.
- Straight Fills (every untapered job) plan and emit byte for byte as before. The 1.0.30 rotary
  golden set, which includes a Fill, still hashes the same.

### Verification

`src/io/gcode/emit-gcode-rotary-taper-fill.test.ts` emits a 40 mm square Fill on a Ø90→Ø70 cone
at 0°, 30°, 45°, 90° and cross-hatch, on Y (GRBL), A (grblHAL) and Z (GRBL). It replays the
program onto the cone, measuring each lit move as hypot(dx, r(x)·dθ). The tapered burn is 99-103 %
of the same Fill's burn on an untapered part. Before this change each case burned about 2 %. The
same file covers a curved run planned as one sweep and the burn-length check refusing a short plan.
`rotary-fill-row-step-warnings.test.ts` shows the row check still warns on a taper, and that an
Interval that lands evenly at the rim can band at the narrow end.
