## ADR-386 Amendment 1 - A new barcode takes only a saved Fill default (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

### Context

ADR-386 item 4 puts a new code on its own Fill operation, and keeps it Fill "even when layer
defaults would start it as a line". Only the mode was forced. The rest of the saved default still
applied, and a saved default is a whole operation (`captureLayerDefaultSettings`). New operations
look up their default by artwork colour, and a code is always black artwork, so a code took the
`#000000` or all-colours default in full.

A default saved from a black line cut (for example 100 %, 480 mm/min, 3 passes) therefore made a
25 mm QR code a three-pass Fill at cutting power, which can char or ignite wood. Only the operation
row in Job Review showed it. The 2026-09-25 audit of PRs #845-#904 found this (LBG-1).

### Decision

1. A new barcode's operation takes a saved default only when that default's mode is Fill. A Line
   default is skipped as if it were not saved. The lookup falls through from the colour default to
   the all-colours default, and then to a plain new operation.
2. The operation is still forced to Fill. Editing a code still keeps its operation and settings.

### Consequences

- A saved Fill default for black, or for all colours, still seeds new codes.
- An operator who wants more power on a code sets it on the operation after inserting.
- Unit tests cover a Line default, a Fill default, and the fall-through from a black Line default
  to an all-colours Fill default.
