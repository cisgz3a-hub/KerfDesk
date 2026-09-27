# Bidirectional Fill and Image investigation

Base examined: `c75ba261e22e62399dbd4d4e1f844e26dc1516c9`.
Implementation branch: `codex/bidirectional-scan-timing`.
Scope: shared scan planning, emitted GRBL traffic, calibration and diagnostics. No hardware
was operated or controller settings changed during this investigation.

## What was wrong

### Some split strokes changed speed while still burning

`boundedSplitRunwayLengths` reserved no exit distance for an internal stroke. A slower
positioning move immediately after it therefore made the controller brake inside the artwork.
This affected Image and the bounded-entry Fill path, including the 4040 profile. A scan offset
measured at steady feed cannot correct a varying delay distance along such a stroke.

The independent regression uses two 1 mm strokes separated by 15 mm, engraving at 1500 mm/min,
controlled travel at 800 mm/min, and declared acceleration of 100 mm/s². Before repair, the
first stroke on each row entered at 19.4365 mm/s and left at 13.3333 mm/s. After repair, every
stroke enters and leaves at 25 mm/s. Its 5 mm dark runways exceed the independent 3.125 mm
from-rest requirement. Both directions and one-way output are covered.

The fix divides the available gap between dark exit and entry without overlap. It keeps the
same powered coordinates and outer motion envelope. The wider gap's centre still uses the
configured positioning speed. Generic Scan Line already used this geometry; both paths now
share its rule. Explicit zero Image overscan remains zero.

Final review of the shared-gap geometry also caught a controller-rounding edge case. With
0.837125 mm pixels across a 6.697 mm row, separately expanding adjacent runways produced
midpoints of 3.3485 and 3.3484999999999996. They emitted `X3.349` then `X3.348`: a 0.001 mm
backward dark move. Fully consumed gaps now compute one shared meeting point which adjacent
sweeps, output and preview reuse. Powered coordinates stay intact. Regressions cover both
directions, signed offsets, angled Fill, translated Image origins, dot-width correction and
half-thousandth rounding boundaries. A separate cutoff probe examined 540 emitted jobs at the
floating-point neighbours of a 10 mm gap with 5 mm runways, across translated origins, signed
offsets and four Fill angles. All 6,480 within-row moves remained monotonic.

### Dense Fill sent avoidable data to the controller

Fill ignored the existing compact motion setting. Alternating 0.04 mm spans at 1500 mm/min
required 14,379 bytes per second in the baseline fixture. A 115200-baud 8N1 link can carry at
most 11,520 bytes per second before other overhead. This is a reproduced transmission-budget
failure, not a measurement of the user's board or proof that bandwidth caused the reported
double lines.

Fill now uses the existing modal writer, and the 4040 scan dialect enables it for both Fill
and Image. Its repeated F/S settings remain intact. Independent decoding checks positions,
feed, power and ordering against verbose output, including reverse, diagonal and mixed jobs.
GRBL Compatible remains the verbose fallback. Smaller output reduces avoidable transport
pressure; it cannot make an arbitrary controller process an unlimited number of blocks.

Measured command demand within those dense scan regions, excluding headers and outer runways:

| Output | Verbose bytes/s | Compact bytes/s | Reduction |
| --- | ---: | ---: | ---: |
| Default Fill | 14,379 | 6,083 | 57.7% |
| 4040 Fill | 18,126 | 9,205 | 49.2% |
| 4040 Image | 13,126 | 9,201 | 29.9% |

These three compact fixtures fit the raw 11,520 bytes/s wire ceiling. Actual firmware processing,
USB latency and controller telemetry can reduce usable throughput further.
The sender trims line ends but keeps interior G-code words, so these savings reach the serial
connection; they are not just smaller exported files.
The exported emitter revision also advances for this executable-output change while retaining
the integrated CNC provenance. Previously exported G-code must be regenerated to receive the fix.

### Calibration labels could describe a speed that was never emitted

With a profile ceiling of 1500.9 mm/min, requested calibration speeds such as 3000.75 were
burned as 1500 while the coupon said 3000.75. This could make a physical measurement unusable
or associate it with the wrong table speed. Coupon generation now applies the profile ceiling
and feed representation before creating layers, metadata and burned labels.

The existing native full signed reverse-row correction and LightBurn conversion were checked;
no new sign or double-application defect was reproduced. If a generated coupon's speed or
profile is changed later, regenerate it before measuring its labels.

### The runway diagnostic underestimated slow axes

A speed-percent reference alone does not account for acceleration. At 3000 mm/min and
100 mm/s², the from-rest distance is 12.5 mm, even though the old reference was only 2.5 mm.
The diagnostic now checks both values against actual split runways. The acceleration comes
from the profile and must be checked against the controller; missing/invalid values are not
reported as a pass. It is an advisory, with no change to Frame/Start authorization.

## What the research supports

- GRBL associates laser power with queued motion. It supports changing S during continuous
  motion; adding per-pixel dwell or M3/M4/M5 transitions would interrupt that flow.
  [GRBL laser mode](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Laser-Mode)
- Insufficient delivery can starve the planner and cause stop/start motion. The current sender
  already uses character-counted buffering and greedy refill, so no arbitrary sender delay
  was added. [GRBL interface](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface)
- Adjacent block speeds and finite acceleration constrain burn-edge velocity. A slower next
  block can force braking into the previous block.
  [GRBL planner source](https://github.com/gnea/grbl/blob/master/grbl/planner.c)
- Physical beam response and mechanics can cause directional displacement. Calibration should
  use several reachable speeds with adequate runway; LightBurn's half-gap convention differs
  from KerfDesk's full reverse-only convention.
  [LightBurn calibration guide](https://docs.lightburnsoftware.com/2.1/Guides/ScanningOffsetAdjustment/)

## Software verification

Environment: Windows, Node 24.15.0, pnpm 11.3.0, dependencies installed from the unchanged
lockfile. Focused regressions reproduced the old runway, traffic and calibration failures
before the fixes. The repaired tests cover Fill and Image in both scan directions, signed
offsets, emitted motion versus preview and Frame, randomized split gaps, independently decoded
compact output, and the real calibration dialog through compilation to G-code.

Completed checks:

- Focused regression suites and updated output snapshots pass. Snapshot changes were reviewed
  for equivalent commanded coordinates, feeds and powers.
- Final controller-grid and enlarged-J regressions pass all 12 tests. Related motion/consumer
  checks passed 81 tests across 12 suites before the final precision additions.
- `pnpm typecheck`, `pnpm lint` and `pnpm format:check` pass.
- `pnpm build:bundle` passes; Vite reports its existing large-chunk advisory.
- ADR numbering, file-size, soft-size and index-export gates pass; `git diff --check` passes.
- The 155 release-integrity tests, dependency-license check, GitHub Actions pinning check,
  Electron lint and Electron main-process build pass.
- Independent review found a runway-coverage diagnostic still counting entry alone. Its new
  regression failed before correction and passes after both sides are checked.
- An independent snapshot review confirms all four changed snapshots retain the same ordered
  numeric commands. A bounded in-memory mutation that removed the zero-length span guard
  produced a bare positive-power command; the strengthened compact-output guard test rejects it.

The full Vitest run (`--maxWorkers=3`) covered 2,802 files: **20,769 passed, 3 failed,
25 skipped**. Two failures were the old whitespace-dependent reader in
`src/ui/state/object-properties-power-mode.test.ts`; it now recognizes compact modal motion,
and its complete four-test rerun passes. The updated file also passes lint and formatting,
and the final TypeScript check passes.

The initial run also found an unrelated failure in `src/ui/state/laser-tool-change-probe-alarm.test.ts:156`
(`alarmCode` is `null`, expected `5`, after unlock). It fails both in this branch and in a clean,
detached checkout of the unchanged starting commit `c75ba261e22e62399dbd4d4e1f844e26dc1516c9`,
using the same installed dependencies. The baseline run has three passing tests and that same
one failure. Its mock controller answered every status poll with Idle, even during an alarm,
so polling supplied the exact fresh status the assertion expected not to have arrived. The
fixture now retains its explicit Run/Alarm/Idle state and separates unlock acknowledgement
from status evidence. All five tests pass, including recovery for both probe alarm codes,
polling while alarmed, and the requirement to zero the new tool after fresh Idle. Production
alarm handling is unchanged; the full focused controller cohort passes 33 tests across eight
suites. Raw JSON results for the initial full run, the corrected
power-mode tests and the baseline probe test are retained in the task's external audit
directory. The temporary baseline checkout was removed after verification.

## Physical acceptance after this code is available

1. Use the actual saved machine/head profile. Confirm its acceleration, feed limits, laser
   mode and S scale from existing controller evidence. The application must not infer these
   from a generic 4040 name or substitute another machine's calibration.
2. Choose a reachable engraving speed and enough Overscan. If the diagnostic still reports
   too little runway, lower speed or increase Overscan within the machine's available area.
   Frame the exact generated job.
3. Generate **Tools → Scan Offset Test → Uncorrected baseline** at several usable speeds.
   Compare a one-way control with bidirectional output on the same material, focus and power.
   For native horizontal rows, a reverse row displaced to the right needs a positive correction
   (the reverse row moves left); a reverse row displaced left needs a negative correction.
4. Enter the full signed pair separation under **Machine Setup → Essentials → Accessories and
   calibration → Raster scan-offset calibration → Raster Diagnostics and assisted conversion**.
   Save machine setup, generate **Verify saved table**, then accept verification only if the
   physical rows align. Zero is a valid measured correction; do not invent one from CPU speed.
5. Verify both a split Fill shape and a split Image at those speeds. Preserve the project,
   G-code, settings, photographs and measured residual. If a uniform correction cannot align
   both ends, inspect remaining speed variation, mechanics and laser response before fitting
   further offsets.

These source fixes remove demonstrated software causes. No material burn has been performed
in this task, so physical resolution on the 4040 or any other machine remains unverified.
