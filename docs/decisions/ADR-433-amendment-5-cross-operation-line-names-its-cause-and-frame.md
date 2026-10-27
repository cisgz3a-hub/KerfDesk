## ADR-433 Amendment 5 - The cross-operation line names a finish allowance, and tile files give no position (2026-10-27)

**Status:** Accepted; software-verified through emitted G-code, an independent cutter-disk model
and the tiled-save core. | **Date:** 2026-10-27

This amends ADR-433 Amendment 3 Decision 2, the Job Review line for a profile cut that reaches a
part another operation keeps. Only advisory text changes. No G-code changes, and nothing blocks
Frame, Start or Save (ADR-565).

### Context

Rolling audit v3 (`docs/audits/2026-10-27-rolling-v3/G5-cnc-delta.md`) raised two P3s, each
confirmed by REPRO:

- **G5-P3-1.** The line always ended "The parts sit closer together than the bit can pass between.
  Move them further apart." A finish allowance (ADR-140) roughs the allowance further out than the
  finished wall. Two Outside operations 3.6 mm apart under a 3.175 mm bit, each with a 0.5 mm
  allowance, rough 2.0875 mm off their own parts and so 0.075 mm into each other. The line was right
  about the cut, but the bit passes between those parts with 0.425 mm to spare, and the cheaper fix,
  a smaller allowance, was not named.
- **G5-P3-2.** Tile files run CNC preflight against the whole compiled job, with no coordinate mode
  or motion offset, so the line printed whole-job machine positions ("at X 62.5 · Y 380 mm") for
  programs that `tile-plan.ts` moves to each tile's own zero. Decision 2 says a position is given
  only when the program runs where it was compiled.

### Decision

1. **A reach only the roughing ring makes names the allowance.** `cncKeptPartCuts` records the
   operation's effective allowance (`profileFinishAllowanceMm`, at most the cutter radius) on the
   `CncKeptPartCut` when the deepest reach is no deeper than that allowance, within the 0.005 mm
   gouge tolerance. Without the allowance the finishing pass alone would not be reported. The line
   then ends "Its 0.5 mm finish allowance moves the roughing pass out into it. An allowance of
   0.42 mm or less clears it, or move the parts apart." The figure is the allowance less the reach,
   rounded down to 0.01 mm. Where that leaves nothing, the line says "Remove the allowance or move
   the parts apart." A cut that runs into the part, or reaches deeper than the allowance, keeps the
   spacing sentence.
2. **Tile files give no position.** `runCncPreflight` takes `compiledPositionsHold: false` for a
   program moved off the compiled job's coordinates, and `emitTileFiles` passes it. The line still
   names the layers, the part count and the depth. The tile file's bounds and no-go checks are
   unchanged.

### Consequences

- An operator who measures the gap and finds the bit fits is told what does not: the allowance.
- Retained recovery sidecars carry the new optional field unchanged.
- Limit: the cause is judged by the operation's own allowance. A finishing recipe with a different
  bit is measured with the layer's bit, as Amendment 3 already does.

### Verification

- `emit-gcode-cnc-kept-part-cuts.test.ts`: at 3.6 mm with a 0.5 mm allowance, the independent
  model measures -0.075 mm, and both lines name the allowance and 0.42 mm. At 0.42 mm the model
  measures no gouge and nothing is reported, so the figure it gives clears. At 2.5 mm the spacing
  sentence stays.
- `tile-kept-part-positions.test.ts`: through `prepareOutput` and `finalizeTiledOutput`, two
  Outside operations 2.5 mm apart on 60 x 100 mm tiles give kept-part lines with no " at X ", while
  `emitGcode` for the same untiled job still gives the position.
