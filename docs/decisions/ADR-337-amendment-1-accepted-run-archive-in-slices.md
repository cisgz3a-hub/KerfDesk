## ADR-337 Amendment 1 - The accepted run's archive is built in slices that leave the job's thread to Abort (2026-11-04)

**Status:** Accepted. A pure performance change: the stored archive and the G-code are
byte-identical. | **Date:** 2026-11-04

### Context

ADR-337 moved the execution archive off the path between Start and motion: it is built and
stored once the controller has accepted the program. It did not move it off the window's
thread. Performance audit S4 (finding S4-P2-3, ledgered as P1) measured what that costs. Right
after the first line reaches the controller, `archiveAcceptedFreshRun` runs as one task:

- `createExecutionProvenance` encodes the whole program twice, once for its byte count and
  once to hash it;
- `createExecutionArtifact` packs the motion manifest, validates the packed copy, fingerprints
  the program, counts its sendable lines and walks the finished artifact to measure it;
- `stageArtifact` validates it again (fingerprint, packed manifest, sendable lines), encodes
  and hashes the program a third and fourth time for the integrity check, and walks it once
  more for the size budget;
- a run too large to archive then builds its short record (ADR-341 Amendment 8), which
  fingerprints and counts the program again.

The window was blocked for 94–113 ms on a 200-object mix, 260–334 ms on a 100 mm photo and
270–305 ms at 375k lines (606–622 ms in 2 of 10 cycles). The running-job budget is 50 ms. An
Abort pressed then reached the controller 125–504 ms late at 375k lines, and the window-side
stream, status and Pause waited too.

### Decision

1. Every whole-program and whole-manifest pass on this path is written once, as resumable steps
   (`WorkSteps`, `src/core/recovery/work-steps.ts`): the fingerprint, the sendable-line count,
   the checkpoint and start intent, measuring and validating the manifest's block columns
   (`isMotionBlockColumnDataSteps`), the archive size walk, artifact building and validation,
   and the UTF-8 encoding that feeds SHA-256. Packing the parser's columns copies nothing
   (ADR-244 Amendment 3), so only a manifest held as objects is walked to measure it. A step
   covers a bounded chunk: 64 Ki characters of program text, 16 Ki manifest blocks, 64 Ki
   stored doubles, 4 Ki measured values or 256 Ki encoded characters. A yield is a checkpoint,
   never a decision. The synchronous functions every other caller uses (`fingerprintGcode`,
   `createExecutionArtifact`, `isExecutionArtifact` and the rest) drain the same steps in one
   call, so there is one definition of each and the two can never disagree. This is the shape
   the tracer already uses (`src/core/trace/trace-steps.ts`).
2. The accepted run's archive drains them with a cooperative runner
   (`createCooperativeArchiveRunner`): steps run for 8 ms, then the work resumes on a later task
   through a `MessageChannel`, after input, rendering and the stream had their turn. A timer
   would clamp to 4 ms per yield and be throttled in a hidden window. `stageFreshExecutionArtifact`,
   the repository's `stageArtifact` and the short record all take the runner; with none they
   drain synchronously, exactly as before.
3. The program is encoded once for provenance and once for the integrity check, each time a
   slice at a time, with each encoding serving both its byte count and its digest. A slice never
   ends between the halves of a surrogate pair, so the bytes are `TextEncoder`'s.
4. What ADR-337 guarantees is unchanged. The operator-facing handoff is still armed from the
   intent before the first byte. The archive still begins only after the controller accepted the
   program. It now takes longer to finish, and that is safe for the reason ADR-337 gave: until it
   is stored, the armed intent is the record, and a run that ends or is aborted first is settled
   by the existing terminal precedence (`activateFreshRunMutation`) and retention checks. The
   stored archive is byte-identical, so replay, recovery and second-pass offers read it as
   before.

### What still runs in one task

IndexedDB's structured clone of the finished record runs inside `add` and cannot be split.
It was already its own task before this change; on the measured jobs it is the only task after
the first line that can still reach 50–61 ms (see Evidence). CNC's recovery event
manifest (`buildCncRecoveryEventManifest`) is not sliced; it reads the compiled job, not the
program text. The supervised recovery flows build their archive before the wire, as before.

### Evidence

Production bundles of main `a96bc8950` and of this change, measured under the audit's rules
(AREAS.md): Chrome, the simulated GRBL controller over a fake serial port on the USB worker
route, a fresh context per set, six Frame → Start → Abort cycles per set with the first
dropped, the calibration loop before and after every set, and each fixture's before and after
sets run back to back on a quiet PC. "Block" is the longest task that starts after the job's
first line reached the controller. These sets were run before #1572 (block columns) reached
main; the merged build was measured again below.

Longest task after the first line, median of the five kept cycles (range), with the
calibration loop before / after each set:

| Job | main `a96bc8950` | This change |
| --- | --- | --- |
| 200-object mix | 145 ms (124–150), cal 59 / 72 ms | 0 ms (0–61), cal 72 / 59 ms |
| 100 mm photo | 293 ms (277–363), cal 42 / 47 ms | 0 ms (0–0), cal 41 / 69 ms |
| 375k lines | 298 ms (281–332), cal 41 / 46 ms | 0 ms (0–56), cal 43 / 47 ms |

0 ms means no task of 50 ms or more (the long-task threshold) started after the first line.
Each worst cycle above 50 ms after this change is the IndexedDB `add` that stores the record,
profiled on the mix: its structured clone of the record's object-shaped parts (the prepared
project and job) runs inside `add`. main has the same separate task, 50–73 ms on the mix,
behind its larger archive task. Shrinking it means storing a different shape, which this
amendment does not do; it is left as a follow-up.

Abort on the 375k-line job, the key pressed 700 ms after confirm (the first line reaches the
controller at about 620–790 ms), a garbage collection between cycles so the before bundle
stays within the PC's memory: time from the key being issued to 0x18 at the controller,
median of five kept cycles (range).

| Route | main `a96bc8950` | This change |
| --- | --- | --- |
| USB, worker | 249 ms (56–290), cal 44 / 47 ms | 18 ms (8–39), cal 41 / 47 ms |
| USB, window | 262 ms (22–379), cal 44 / 58 ms | 24 ms (7–111), cal 51 / 51 ms |

On main, every cycle whose key came after the first line waited behind the archive task
(266–290 ms on the worker route, 372–379 ms on the window route). After this change, those
cycles took 7–25 ms. The 111 ms cycle pressed the key before the first line reached the
controller, inside the 85–136 ms Start task that begins before the first line and ends just
after it (it draws the job's route on the canvas). That task is unchanged by this amendment
and is the "overlapping" figure in the Abort sets (median 85 ms worker, 96 ms window); it is
left as a follow-up.

MERGED_LINE

Byte identity: `start-job-archive-slices.test.ts` stores the archive of a 60,000-move laser
program (packed manifest, arcs, blanks, a non-ASCII comment) through
`stageFreshExecutionArtifact`, drained in one call and with a yield after every step. Both
records hash to the digest the same test produced on main `ede14589b` (`58b026e9…`; before
#1572 changed the stored manifest encoding, the same check matched main `a96bc8950`'s
`7462f0a5…`). The digest covers key order, every double's bits, every string's code units
and every view's bytes. The G-code is not touched by this change: no emitter or preparation
file is in the diff, the archive above stores the program string itself, and the repository's
G-code golden fixtures pass unchanged.

The regression guard in the same file is an operation count, not a clock: while the archive
and the short record are built through a runner that yields after every step, no synchronous
drain crosses a single checkpoint, no `TextEncoder.encode` call sees more than one slice of the
program, and the number of steps scales with the program's length. The unit suites compare
each step function with the single-pass definition it replaced, including chunk and surrogate
boundaries and arbitrary strings.

### Transports and the desktop app

The archive runs in `transmitPreparedStart` after `startJob` resolves, the same code for every
transport: Web Serial on the worker or window route, network serial, Marlin, grblHAL and the
Electron renderer, which runs this bundle against its own IndexedDB. Both Web Serial routes
were measured above. Network serial, grblHAL and the desktop app reach the same function with
the same arguments. A Marlin set was attempted with the simulated Marlin controller but its
fixture did not reach Start in the harness on either bundle, so Marlin rests on the shared code
path too.

### Limits

Synthetic fixtures on one PC; no hardware. The archive's total work is unchanged (slightly
less: two whole-program encodings fewer), but it now ends later in wall time.
