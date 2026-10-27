## ADR-392 Amendment 3 - CNC setup packages default to one file per bit (2026-10-26)

**Status:** Accepted. | **Date:** 2026-10-26

CNC audit v1 found that the CNC setup package (Save G-code → "Save setup sheet + program…") makes
the same `M0` mistake that Amendment 2 fixed for tiles. An independent refuter confirmed it
(`docs/audits/2026-10-23-cnc-v1/F8-cnc-output-viewer.md`, F8-P2-1, P2). The same report's F8-P3-5
(per-tool files carry no bit or zero header) is fixed here too. The Frame-first contract
(PROJECT.md non-negotiable 21, ADR-228) is untouched: nothing here refuses Frame, Start or a save,
and the Run review change is a warning's wording.

### Context

The setup package is one HTML file holding the exact programs, their manifest and a printable
sheet. It has two modes: one combined program that stops at an `M0` before each later bit, or
ordered separate-tool files, one per contiguous cutter section, with no `M0`. It opened in the
single-file mode (`CncSetupDocumentExport.tsx`, and `exportMode ?? 'single-file'` in
`cnc-setup-package.ts`), and the sheet told the operator: "At each M0, load the indicated cutter,
keep the same G54 XY datum, re-zero Z on stock top and remove the touch-off plate before
resuming."

A program downloaded from the package never runs under project Start, which compiles from the
project and holds host-side before the `M0` (F-CNC15). It runs through Run G-code file or another
sender. Run G-code file sends the `M0` as written (`toolChangePause: false`, ADR-630). On stock
GRBL (gnea/grbl `bfb67f0c`) the `M0` sets a feed hold and suspends (`gcode.c` L1084-1089).
`protocol.c` L546 loops `while (sys.suspend)` and parses no line, so a `$J=` or `G10 L20 Z0` only
waits in the RX buffer behind the program. `system.c` L131-132 refuses `$J=` outside Idle and Jog
in any case. The refuter streamed the package program as Run G-code file does: at the `M0`, 13
lines were already in GRBL's buffer, the new bit's `M3S12000` and its plunge `G1Z-1.500F200` among
them. Cycle start then cuts with the new bit at the old bit's Z zero. The sheet's instruction could
not be followed, and it contradicted KerfDesk's own Run review warning (Amendment 2, Decision 3).

The refuter also read three other senders' sources at pinned commits (read, not run).
Sienci-Labs/gsender `426eaa19` rewrites the `M0` to `(M0)` and pauses host-side, so the
controller goes Idle and a re-zero works there. cncjs/cncjs `747ffcd5` sends the `M0` and stops
streaming after it. UGS `67d626525` intercepts only `M6` and passes the `M0` through with the
following lines buffered.

### Decision

1. **A multi-bit package defaults to one file per bit.** `defaultCncSetupExportMode`
   (`src/io/cnc/cnc-setup-package.ts`) picks the separate-tool mode when the job's tool plan has
   more than one cutter section and the Save worker prepared the per-section programs. The setup
   dialog opens on it, and `cncSetupPackage` uses it when no mode is passed. A one-section job
   stays single-file: its one file has no `M0` and is the combined program. A package with no
   prepared section programs (an older artifact) also stays single-file, because the files cannot
   be made from the facts alone. In the dialog the separate-tool option comes first, labelled
   "One file per bit · ordered separate-tool files".
2. **Single-file stays as an explicit choice, with a true instruction.** The option reads "Single
   file · M0 bit changes". For a multi-bit job the dialog shows a note when it is chosen, and the
   sheet replaces the old re-zero instruction. The sheet now says: do not change bits at an `M0`
   the controller has received; stock GRBL takes no jog or Zero Z there, and the next bit's spindle
   start and plunge are already sent. It says to change bits at those stops only where the `M0`
   never reaches the controller: by starting the job from its KerfDesk project, or in a sender that
   holds at the `M0` itself, as gSender does. It says that Run G-code file sends the `M0`, and so
   do other senders such as UGS, and that for them the package should be saved again as
   separate-tool files. A one-cutter single file gets a plain "load it, zero Z" line instead.
3. **Every file of a multi-bit package names its bit and what to zero** (F8-P3-5), as tile bit files
   do under Amendment 2. `cncToolProgramHeader` (`src/io/cnc/cnc-tool-programs.ts`) adds two
   comment lines before the provenance header: `; bit 2 of 4: End mill 2`, then "load this bit and
   zero Z on the stock top before running this file" for the first file, or "keep the same X/Y
   zero; change to this bit and re-zero Z on the stock top before running this file" for the rest.
   The header is part of the prepared bytes, so each file's SHA-256 and byte count in the manifest
   cover it. A one-section job writes no header. The motion bytes are unchanged, so the emitter
   revision does not change.
4. **The Run review's remedy names the separate files.** Amendment 2, Decision 3's warning said to
   Start the job from its project "or save its tiles again". A setup-package file is not tiled. It
   now says to save it again as one file per bit, which the CNC setup sheet does by default, and so
   do tiles.

### Consequences

- A multi-bit job saved from the setup sheet is, by default, several runs of Run G-code file (or of
  another sender). Each run has its own Frame and setup confirmation, and the operator re-zeroes Z
  between them with the machine Idle.
- Packages saved by earlier builds in the single-file mode still print the old instruction. The Run
  review still warns about their `M0` bit changes and now points to the separate files.
- The single-file mode keeps its bytes. Its `M0` blocks are unchanged, because project Start (which
  never sends them) emits the same program.
- Not changed: the separate-tool files' motion, names, order and validation; grblHAL and FluidNC
  behaviour at a program `M0`, which the audit did not verify; the other F8 P3 findings (Cut 3D
  pooling, the arc radius gate, exponent spindle words, entered against emitted feeds on the sheet).

### Evidence

- `src/io/cnc/cnc-setup-tool-package.test.ts`, on the A-A, B, A fixture:
  - with no mode passed, the package is separate-tool, its manifest says so, it holds the three
    ordered files and none of them has an `M0`;
  - the explicit single-file mode keeps the combined bytes and their two `M0`s, prints the bit
    order and the new instruction, and no longer prints "At each M0" or "before resuming";
  - a one-bit job, and a multi-bit job with no prepared section programs, stay single-file.
- `src/io/cnc/cnc-tool-programs.test.ts`: each of the three files opens with its bit and zero lines
  ahead of the provenance header, a one-section job's header is empty, and a bit name with a line
  break stays on one comment line.
- `src/ui/app/CncSetupDocumentExport.test.tsx`: the dialog opens on separate-tool output for the
  A-B-A project and writes the three files with matching digests. Choosing single-file shows the
  note and saves the corrected sheet. A one-bit project opens on single-file with no note.
- `src/core/external-program/external-program-review.test.ts`: the Run review's new remedy text.
- Red checks: restoring the single-file default and dropping the header fails four of these tests
  (the package default, the dialog default and both header tests).
- Not tested on hardware, in an air cut, or in the rendered app. gSender's host-side `M0` hold is
  read from its source, not run.
