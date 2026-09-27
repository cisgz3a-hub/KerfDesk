## ADR-460 - Dense Fill uses lossless modal motion spelling (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

Extends ADR-332's raster spelling policy to scanline and Island Fill.

### Context

The Fill emitter assumed that each span was long enough to make serial byte
volume irrelevant. Fine traced detail can instead contain thousands of
sub-millimetre spans, separated by short laser-off gaps. Repeating G1, unchanged
axis values, spaces and trailing zeroes on each span can consume more serial
bandwidth than the equivalent raster output. Increasing the feed cannot fix
that bottleneck and can reduce quality if the controller is starved.

### Decision

Use the existing modal motion writer for Fill sweep segments when the selected
dialect already enables compact motion words. Keep every segment and power
transition, coordinate precision, feed, pass order, scan offset, runway, air
transition and beam mode unchanged. A spelling change must not simplify artwork.

Reset the writer for every sweep. Its first emitted move explicitly establishes
G1, X, Y, F and S, so a preceding G0 seek or deferred mode transition cannot leave
an assumed modal state. Subsequent moves may omit G1 and an unchanged axis;
each still contains an axis word and reasserts its S value. Existing checks drop
moves that collapse to zero length at controller precision before updating the
writer. Laser-off entry/exit and seek lines retain their existing representation.

GRBL Dynamic and GRBL Raster use this spelling. GRBL Compatible retains its
historical text. ADR-445 supersedes this decision's original Neotronics exception:
4040 Safe also uses compact motion and axis spelling while retaining its required
explicit feed and power words. Its independent decoder and wire-demand tests
verify the same represented moves, feeds and powers. Marlin and Smoothieware
post-processing continues to force verbose output. Ruida binary export and CNC
toolpath generation are separate and unchanged by this emitter.

The underlying GRBL modal/whitespace contract is the one already used by
ADR-332; see the primary [GRBL G-code parser](https://github.com/gnea/grbl/blob/v1.1h.20190825/grbl/gcode.c)
and [streaming documentation](https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md).

### Verification

`grbl-fill-compaction.test.ts` compares compact and verbose programs using an
independent burn interpreter, including coordinates, feed, power, beam mode,
work frame, air, passes and reverse-row compensation. The complete motion
manifest, including raw line indices, is identical. Every restart line in a
representative two-pass Fill program preserves the exact remaining burns after
arbitrary repositioning. GRBL Compatible remains byte-identical; the 4040
compact-output equivalence and explicit F/S checks are covered by ADR-445.

A 40 by 10 mm alternating 0.1 mm detail fixture has 20,000 powered spans. The
paired probe emitted 932,023 verbose bytes and 366,203 compact bytes, a 60.7 percent
reduction, with the same 40,210 text lines and all 20,000 burns. Its regression
requires at least 40 percent fewer bytes and proves that no span is lost.
This is an output-volume reduction, not a promised machining-time
improvement. Actual runtime still depends on line processing, transport,
acceleration, commanded feed, and material. No physical machine was operated.
