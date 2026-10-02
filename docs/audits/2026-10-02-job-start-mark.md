# Executable job-start mark audit

Reviewed 2 October 2026. Integration base: `df8f2a66156275f9a0123533b3982517409921c4`.
This is software and controller-model evidence; it does not qualify a physical laser or material.

## Result

**Mark job start · 1 s** prepares the current job, moves with the beam off to its first emitted powered motion, queues a nominal one-second low-power dot and shutoff together, then returns to the original reported head position. It does not use the current head or an alignment anchor as a substitute for the actual burn entry.

The default positioning request is 1%, bounded by the existing Fire profile and hard cap. A smaller same-session controller S ceiling lowers the command, and a fresh lower observation during travel lowers it again before firing. Without that current observation the saved profile supplies the scale. Integer rounding may reduce the requested share. Neither this calculation nor a nominal controller dwell establishes optical watts, an exact physical exposure duration or a visible/material-safe mark.

The feature remains an explicit local Fire opt-in and is limited to Cartesian GRBL v1.1, grblHAL and FluidNC laser jobs. Unsupported firmware, rotary, laser Z changes and unknown coordinates have no invented fallback. It adds no licence gate to Frame, Start or existing output. It cannot be invoked by the phone/MCP machine-control surface, which continues to exclude machine operation.

**Line burn start near** is an optional project setting. Centre, side and corner choices select an existing eligible contour entry near that physical region after placement and mirroring. Layer, inside-first, direction and nearest-corner constraints take precedence. An empty centre does not become a fabricated burn point. Fill/raster and CNC retain their existing ordering; marking follows the final laser output's actual first point regardless of scan order. New canvases reset this preference while preserving machine configuration. Legacy planner fields and unset serialized defaults remain unchanged.

## Findings resolved during review

- The existing held Fire control operates at the current head until release. The new action addresses the requested job-start marking behavior separately.
- A saved S1000 Fire profile could calculate too large an S command for a currently observed S255 controller. Shared Fire scaling now uses the smaller qualified range.
- A fixed three-second planner-drain timeout rejected legitimate six-second travel. The owned drain now observes controller activity while retaining the actual terminal ACK and a separate fresh Idle/position requirement. Feed, rapid and power override flags are normalized after the preflight fence.
- The always-mounted Fire control could react to an unrelated pointer release during a mark, insert an extra M5 and let its ACK satisfy the subsequent Return command. Ordinary release now respects mark ownership; a deliberate generic Laser off instead cancels through bound Abort.
- An immediate query answer could race waiter registration; a received answer could also leave an unresolved transport write holding preparation indefinitely. The waiter is installed before sending, and both completion prerequisites have a bounded same-owner cancellation/deadline.

## Qualification checklist

| Scenario | Evidence |
| --- | --- |
| Final represented coordinates; zero-power, rounded-away and blank raster entries; native arcs | Core mark tests with an independent restricted wire decoder and controller model |
| Nine physical regions, five machine origins and four placement modes | 180 actual emitted-program coordinate scenarios; existing ordering and native-arc checks |
| Persistence, clearing, Undo/Redo and new canvas with retained machine configuration | Serialization and actual store tests; mounted controls and rendered browser selector |
| Long travel and return, inherited feed override, all three pulse ACKs | Actual-store timed-controller tests; independent six-second planner before/after reproduction |
| Unrelated Fire release and ACK ownership | Mounted real Fire control plus real SafeWrite/FIFO before/after reproduction |
| Current Position, nonzero WCO, fresh queries and original XYZ return | Actual preparation/store tests and strict origin/session checks |
| Refusal, partial transport, silence, Abort, replacement connection and coordinate drift | Actual-store failure cases; no Frame resurrection or late commands to a replacement session |
| Pending compilation and simultaneous Start/Frame | Deferred preparation exercises the actual store admissions and mounted buttons |

The independent planner-timing harness uses an equivalent standalone G1 because its simulator does not parse the compound modal travel line. It therefore proves the planner-drain defect and repair, not full end-to-end controller execution. The broader store fixture exercises the complete emitted transaction with a separate timed fake transport.

A clean existing Frame survives only the privately owned excursion and confirmed return. Marking neither mints nor consumes an ordinary Start permit. Interruption or drift expires the proof; returning later to equal coordinates cannot restore it. Existing frame-first admission remains in force.

The delivery evidence records frozen source hashes, focused command results, independent before/after cases and the integrated release gate. A PR merge is source delivery, not a new installer, live service qualification or hardware proof. No real machine, laser, spindle or customer project was operated in this audit.

## Primary references

- [GRBL laser-mode semantics](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Laser-Mode)
- [Pinned GRBL dwell implementation](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L174-L180)
- [Pinned grblHAL dwell implementation](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/motion_control.c#L770-L777)
- [Pinned FluidNC P-seconds handling](https://github.com/bdring/FluidNC/blob/fdc17a2c/FluidNC/src/GCode.cpp#L1818-L1820)
- [ADR-566](../decisions/ADR-566-timed-mark-at-the-executable-job-start.md)
