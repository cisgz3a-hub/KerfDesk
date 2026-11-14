## ADR-258 Amendment 9 - A stock thickness typed in Production Nest counts as set (2026-11-14)

**Status:** Accepted (maintainer decision 2026-11-14: "Save the mark"); software-verified, hardware qualification pending. |
**Date:** 2026-11-14

Amends ADR-258 Amendment 6. Frame remains the sole ordinary Start policy gate (PROJECT.md non-negotiable 21).

### Context

Amendment 6 marks a CNC stock thickness as set (`CncStock.thicknessSet`) when the operator commits it in Machine Setup, at any value, 6.35 mm included. Production Nest is the only other place a stock thickness is written. It wrote the typed thickness onto every generated sheet but never wrote the mark.

The audit of the last 200 PRs (#1892) found what that leads to. A 6.35 mm (¼") sheet typed in Production Nest still read as "never set", so the holding tabs kept the cut-floor rule instead of standing on the stock bottom. This is the J1-P3-3 symptom that Amendment 6 fixed for Machine Setup only.

### Decision

1. **Typing the thickness marks the nest stock.** `ProductionNestStock` gains an optional `thicknessSet: true`. The nest dialog writes it whenever the operator types into Stock thickness. A stock filled in from a project whose stock already carries the mark starts with it.
2. **A generated sheet carries the mark.** When the nest stock is marked, the generated sheet's CNC stock carries `thicknessSet: true` beside the thickness. Without the mark it keeps the project's own mark, as before.
3. **The mark is saved with the nest.** The project's production nest validator accepts the optional `thicknessSet: true` on each stock. There is no schema bump, following Amendment 6.

### Consequences

- KerfDesk 1.0.32 and older reject a project whose saved nest carries the mark ("Invalid quantity nesting definition"). The maintainer accepted this in place of a schema bump, which would make older versions refuse every newly saved file.
- An untouched prefilled 6.35 mm still reads as unset, as Amendment 6 intends.
- Test: `src/ui/state/production-nest-actions.test.ts` covers a typed and an untouched 6.35 mm stock through sheet generation, reopening and saving.
