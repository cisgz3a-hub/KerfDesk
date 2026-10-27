## ADR-392 Amendment 5 - Tile bit files are read below their metadata header, and a stopped bit file ends its bit at the next Idle (2026-10-27)

**Status:** Accepted. | **Date:** 2026-10-27
**Fixes:** rolling audit v5 J1-P2-1 (P2) and J1-P3-1 (P3), both confirmed by an independent
refuter (`docs/audits/2026-10-27-rolling-v5/J1-fix-recovery.md`). The Frame-first contract
(PROJECT.md non-negotiable 21, ADR-565) is unchanged: Frame's existing Work Z requirement does
the refusing, and no new Start gate is added.

### Context

Amendment 4 made Run G-code file treat the gap between KerfDesk per-bit files as a bit change, for
setup package files and, in its Context, for a tile's bit files. Two parts of that did not hold:

- **Tile bit files were never recognised (J1-P2-1).** `kerfDeskBitFile` read only a file's first
  four lines. A setup package file opens with its `; bit N of M:` line, but a tile file writes
  `; bit N of M for this tile:` below the metadata header (five lines), the machine profile (up
  to four), the CNC assumptions (two) and `; tile: row …, column …`, so at line 13 in a real
  tiled save. Every tile bit file read as no bit file: the next tile file framed on the previous
  bit's Work Z, and Set origin stayed open between them. The unit test fed a bare tile header
  with no metadata above it, so it passed while every real file failed.
- **A stopped bit file never ended its bit (J1-P3-1).** Amendment 4, Decision 2 says Work Z goes
  where the streamer is released, "completed, stopped or failed". Abort, an alarm and a reset
  leave the streamer `cancelled`, which is never released: it stays until the next Start. So the
  end patch never ran: no X/Y hold for the later bits, and a stale `bitFileRun`. GRBL-family
  Abort already voids Work Z through its reset, so the depth half held; the X/Y half did not.

### Decision

1. **The bit line is read from the whole leading comment block.** `kerfDeskBitFile`
   (`src/core/external-program/kerfdesk-bit-file.ts`) reads until the first line that is not a
   comment, as before, but no longer stops at line 4; a 64-line cap bounds a file that is all
   comments. Tile files keep their layout, so files already saved by earlier versions are
   recognised too.
2. **A stopped bit file ends its bit at the first Idle after the stop.** Where a status report
   shows Idle, no controller operation is open, the streamer is `cancelled` and a per-bit file is
   recorded, the status handler applies the same end patch a completed file gets
   (`stoppedBitFileRunEndsAtIdle`, `src/ui/state/laser-terminal-stream-release.ts`): Work Z goes,
   and while later bits remain the X/Y origin holds. The streamer itself stays, as before. Idle
   is the moment motion has stopped, which is the reasoning the Idle release already uses; one
   site covers Abort, an alarm (after the operator unlocks or homes) and a reset.

### Consequences

- An operator running a tile's bit files gets what package files already had: the next file's
  Frame waits for the new bit's zero, and the X/Y origin holds until the tile's last bit has run
  or **End bit sequence** is chosen.
- After an Abort or alarm part-way through a bit file, Set or Reset origin and the XYZ corner
  probe stay refused until the set ends, so re-running the same file keeps its X/Y zero. Starting
  over on new stock needs **End bit sequence**, as after a completed file.
- A Zero Z sent between the stop's end and the next Idle report would be voided by the end patch.
  That fails closed: the next Frame asks for the zero again.
- Regression tests:
  - `src/ui/app/tiled-bit-files.test.ts`: the real tiled save's four bit files each read as their
    bit and order, with the bit line past line 4.
  - `src/io/cnc/cnc-tool-programs.test.ts`: the real setup package writer's three files read as
    bits 1 to 3 of 3.
  - `src/core/external-program/kerfdesk-bit-file.test.ts`: a tile header below a twelve-line
    metadata block, and a header past the cap reads as none.
  - `src/ui/gcode-inspector/external-run-bit-files.simulator.test.ts`: Abort of bit 1's file on
    the GRBL simulator alarms (ALARM:3), and after the unlock's Idle the run is cleared, the
    X/Y origin is held and Work Z is not current.
- Red checks: with the four-line read restored, the tiled-save test reads `null`; with the Idle
  arm disabled, the Abort test keeps `bitFileRun`.
- Not hardware-tested.
