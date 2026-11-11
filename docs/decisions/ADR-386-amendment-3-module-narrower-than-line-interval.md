## ADR-386 Amendment 3 - Job Review names a code whose modules are narrower than its line interval (2026-11-12)

**Status:** Accepted. | **Date:** 2026-11-12

### Context

ADR-386 makes every barcode outline exact on the module lattice, and a new code lands on a Fill
operation because only filled modules scan. A scanline Fill burns one line every line interval
(`hatchSpacingMm`). When that interval is wider than a module, whole rows of modules lie between
two lines and are never burned. The outlines stay exact but the burned mark cannot scan.

Oracle audit O1 (`docs/audits/2026-11-11-oracle-o1/O1-barcode-truth.md`, finding O1-P2-1) burned
codes through `fillHatching` and read them with an independent decoder. A 0.25 mm QR Code module
under a 0.3 mm interval left 234 dark modules with no line, and the code never decoded. The only
warning was "Modules of ... mm need a fine beam", which appears below 0.2 mm and does not mention
the interval. The minimum-feature check (ADR-433) skips Fill operations.

### Decision

1. Job Review (every machine, like the 144 x 144 Data Matrix warning) names each barcode used by an
   output Fill operation whose effective line interval, including a per-object override, is wider
   than the code's module as placed (the dialog's module size times the object's scale). The
   message gives both sizes and advises an interval of half the module or less.
2. Matrix codes (QR Code, Data Matrix) are checked at any scan angle. A 1D code is checked only when
   every line runs along its bars (within 1 degree, in machine coordinates, with no cross-hatch).
   Any other angle crosses every bar, so bar widths stay exact.
3. Follow Shape (offset) fills trace each outline first and are not checked. Line operations are
   not checked.
4. It is a warning and never a refusal (PROJECT.md non-negotiable 21). At most four codes are named,
   and a fifth line counts the rest.

### Consequences

- No toolpath changes. Projects whose codes have modules at least as wide as their interval, which
  includes every default size at the default 0.1 mm interval, see nothing new.
- The advice of half the module is a design rule, not a published standard. The audit found no
  primary source that sets a number of lines per module. The warning itself rests on geometry:
  above one module, some rows get no line.
- `src/ui/laser/barcode-line-interval-warnings.test.ts` burns a code at both intervals and decodes
  it with the test QR reader, then pins the warning, its silence at default sizes, scale and
  per-object overrides, the 1D angle rule, cross-hatch, offset fills and the cap.
