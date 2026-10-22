## ADR-392 Amendment 2 - Tile files park at their own origin and change bits between files (2026-10-23)

**Status:** Accepted. | **Date:** 2026-10-23

Controller audit v4 found two faults in tiled CNC export (WORKFLOW F-CNC19), both confirmed by an
independent refuter (`docs/audits/2026-10-22-controller-v4/E3-ctl-cnc-routines.md`, E3-P2-1 and
E3-P2-2). This amendment fixes both. The Frame-first contract (PROJECT.md non-negotiable 21,
ADR-228) is untouched: every new message is a warning, and nothing here refuses Frame, Start or a
save.

### Context

**E3-P2-2, the park.** ADR-392 placed a configured park inside `prepareOutput`
(`placeCncParks`). Tiling runs after that, and `clipGroupToTile` moved only the passes into each
tile's frame. The registration bores took the raw Machine Setup numbers (`parkFields`). A bed park
of X0 Y380 was written as `G0 X0.000 Y380.000` in every tile, in G54 work coordinates. Each tile is
zeroed by hand ("slide the stock, re-zero XY on the next tile frame"), so 200 mm tiles zeroed at
bed (100, 100) parked at bed (100, 480), 80 mm past a 400 mm bed. That is CO-1 again. The external
Frame traces the park, so the overrun happened at Frame, and on stock GRBL defaults (soft limits
off) the carriage hit the end of travel and lost steps. Nothing warned.

**E3-P2-1, the bit change.** A tile that needs a second bit (a two-bit job, or a registration
cutter other than the job's bit) carried KerfDesk's bit-change block: retract, `M5`, park,
`; tool change: load …`, `M0`, then the new bit's `G0 Z`, `M3`, `G4` and plunge. Project Start
never sends that `M0`: it holds host-side and lets the operator re-zero Z (F-CNC15). Tiles have no
project Start; they run only through Run G-code file, which sends an `M0` unchanged
(`toolChangePause: false`, ADR-630). On stock GRBL the `M0` sets a feed hold and runs
`protocol_exec_rt_suspend()`, which loops `while (sys.suspend)` and parses no further line until
cycle start ([gcode.c](https://github.com/gnea/grbl/blob/master/grbl/gcode.c),
[protocol.c](https://github.com/gnea/grbl/blob/master/grbl/protocol.c)). A jog is accepted only
in Idle or Jog ([GRBL v1.1 jogging](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Jogging)), and
KerfDesk refuses jog and Zero Z while a job streams. The refuter counted 12 lines in flight at the
`M0`, the new bit's plunge among them. The file's own instruction, "re-zero Z on the stock top,
then cycle-start", could not be followed, and cycle start cut with the new bit on the old bit's
Z zero.

Three fixes were open: (a) write each bit of a tile as its own file, (b) let Run G-code file
recognise KerfDesk's bit-change markers and enter the project's tool-change hold, (c) only warn.

(a) is chosen. It removes the `M0` from tile files altogether, so the fault cannot occur, and it
changes nothing in the streamer, the hold, or Run G-code file's exact-bytes contract (ADR-630).
Between files the machine is Idle, so the ordinary jog, probe and Zero Z tools work with their
own guards. One file per tool is also how GRBL routers without a tool changer are usually run.
(b) would need a tool plan, tool IDs and work-Z evidence the external path does not have, and it
would teach Run G-code file to treat comments in an outside file as commands. (c) alone leaves the
file unusable. (c) is kept for files that still hold a KerfDesk bit change: tiles saved before
this amendment, and a single-file save of a multi-bit job run through Run G-code file.

### Decision

1. **A tile that needs more than one bit is written as one file per bit.** `splitTileJobByBit`
   (`src/core/cnc/tile-bit-files.ts`) cuts the tile's tool-ordered job wherever the bit changes,
   using the emitter's own tool key, so each piece emits as a single-tool program with no `M0`.
   Run order is kept: registration and clearing before profiles (ADR-310), and a bit that comes
   back later is its own later file. Files are named `job_tile-r1-c2_bit-1-of-2.nc`,
   `…_bit-2-of-2.nc`. A one-bit tile keeps its name, `job_tile-r1-c2.nc`. When the tile set uses
   more than one bit, every file's header names its bit and what to zero: "load this bit and zero
   Z on the stock top" for a tile's first file, and "keep this tile's X/Y zero; change to this bit
   and re-zero Z" for the rest. A bit that only touches a tile at one point (a vertex on its edge)
   writes no file there. Each file is preflighted as the exact program it is. The save warns once
   that tiles are one file per bit and why they hold no `M0`.
2. **Tiles set the bed park aside.** Each tile is zeroed by hand, so where its frame sits on the
   bed is unknown, and Decision 2 applies: `tileJobs` passes every tile job through
   `placeCncParks(job, null)`, the registration bores included. A tile parks at its own X0 Y0. The
   park height (ADR-491) is not a bed position and still lifts the bit first. The save warns that
   the Machine Setup park is not used in tile files. A `G53` park is not used, for the reasons
   ADR-392 gives.
3. **Run G-code file names KerfDesk's bit change.** When the file as opened carries KerfDesk's
   `; tool change: load` comments and stops at `M0`, the Run review warns that the `M0` goes to
   the controller, that no jog or Zero Z reaches it there, and that the new bit would cut at the
   old bit's Z zero. It says to Start the job from its project, or to save the tiles again. The
   labels are read from the opened text, because the bytes an external run sends carry no
   comments. A warning, never a refusal (ADR-630).
4. **The tiled save names files it replaces** in the chosen folder (controller audit v4
   E3-P3-2), and the one-file tile an earlier save left where this save writes per bit, so an old
   tile with an `M0` is not cut by mistake.

The emitter revision advances to `cnc-tile-files-per-bit-20261023-v25`: tile output changes for
every tiled job with a configured park or more than one bit. The same revision covers the
surfacing ladder fix (E3-P3-1): depth passes and rows are counted with the job emitter's rounding
tolerance (`zPassCount`), so 0.3 mm passes to 0.9 mm run three passes, not four.

### Consequences

- A two-bit tile is two runs of Run G-code file, each with its own Frame and CNC setup
  confirmation. The operator re-zeroes Z between them with the machine Idle.
- No tile file contains `M0`, `; tool change: load` or a bed-park move. A configured park still
  works for single-file saves and project Start, as ADR-392 decides.
- Tile files saved by earlier builds still hold `M0` bit changes. The Run review now warns about
  them, and saving the tiles again replaces them with per-bit files.
- Not changed: registration-hole placement and indexing (audit AC-5), the bit-change park height
  (MC-4), and grblHAL or FluidNC behaviour in a program `M0`, which the audit did not verify.

### Evidence

- `src/ui/app/tiled-bit-files.test.ts`, through the production tiled-save core
  (`prepareOutput` → `finalizeTiledOutput`) on a two-tile project:
  - with a 1/4" registration cutter and a 1/8" job bit, each tile is two files, in order, each
    header names its bit, no file contains `M0` or `; tool change: load`, and the save advises
    the per-bit files;
  - every file streams to `done` through the streamer with `toolChangePause: false`, as Run
    G-code file sends it, and no `M0` is ever sent;
  - with a park at bed X0 Y380, no tile file contains `Y380.000`, every file ends
    `G0 X0.000 Y0.000`, the save warns, and the single-file preparation still parks at Y380;
  - a one-bit tile set keeps one file per tile, unchanged names and no bit header;
  - the Run review warns for a single-file two-bit program, naming the first bit.
- `src/core/cnc/tile-bit-files.test.ts`: the split, names and headers, and `tileJobs` dropping
  `parkXMm`/`parkYMm` (registration bores included) while keeping `parkZMm`.
- `src/core/external-program/external-program-review.test.ts`: the warning appears only with both
  KerfDesk labels and an `M0`.
- `src/core/cnc/surfacing.test.ts`: 0.3/0.9, 0.15/0.45 and 0.7/2.1 run three passes, and a
  101.6 mm height at a 10.16 mm step has no duplicate final row.
- Red checks: placing tile parks with a zero translation instead of setting them aside fails the
  park cases, and emitting each tile as one file fails the `M0` and streaming cases. The old
  surfacing ladder fails the four surfacing cases.
- Not tested on hardware, in an air cut, or in the rendered app.
