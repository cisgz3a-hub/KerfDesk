## ADR-691 - Shipped code never spreads an array into Math.min or Math.max

**Status:** Accepted. Fixes performance audit finding S7-P2-3 (P2, raised by the refuter)
(`docs/audits/2026-11-02-performance-s1/S7-text.md`). Builds on ADR-015 (code discipline and its lint
gates) and ADR-643 (the text worker, which runs the same path and bend code). Burn, G-code, Frame,
Start and licences are unchanged. | **Date:** 2026-11-05

### Context

`boundsForPaths` in `src/core/text/text-on-path.ts` and `src/core/text/text-bend.ts` measured the
placed text with `Math.min(...xs)` and `Math.max(...xs)`. A spread call puts every element on the call
stack, and V8 throws `RangeError: Maximum call stack size exceeded` at about 120,000 arguments. A
render passes that from about 75 characters in Special Elite, 214 to 424 in the script fonts and
about 1,000 in Roboto. Text on a path, and text with any non-zero Bend, then failed: Done did nothing
and Cancel discarded the text.

The same form appeared at about 200 other places in shipped code. Most spread a few values (layers,
corners, a dialog's rows), but many spread the points of a design, the lines of a job or the rows of
an image, which nothing bounds. `target.push(...items)` has the same limit.

### Decision

1. **Extrema fold in a loop.** Shipped code takes the smallest or largest of an array with `minOf`
   and `maxOf` from `src/core/util`. They fold through `Math.min` and `Math.max`, so every input
   gives the result the spread call gave: NaN, -0, and Infinity / -Infinity for an empty array.
   `Math.min(a, b)` with plain arguments stays as it is.
2. **A lint rule holds it.** `kerfdesk/no-spread-math-extremum`
   (`scripts/eslint/no-spread-math-extremum.mjs`) reports any spread argument to `Math.min` or
   `Math.max` in `src`, apart from tests, fixtures and test support, which build small arrays.
   Every shipped site was converted, so the rule starts with no exceptions.
3. **Appends of unbounded arrays loop.** `appendAll(target, items)` from `src/core/util` replaces
   `target.push(...items)` where `items` can hold a design's points, a job's lines, a trace chain or
   one object's paths (36 calls in core, io and ui). It reads the length first, so appending an
   array to itself copies it once, as the spread did. A `push(...)` of a few warnings, issues or
   per-glyph contours stays; no rule covers `push`, because most of those 165 sites are bounded and
   a rule could not tell them apart.
4. **Path and bend measure text in one pass.** Their box comes from `coloredPathsBounds`
   (`src/core/text/colored-paths-bounds.ts`), a loop over the same values with no copied arrays.
   Text on a path finds each point's place on the guide by binary search over the guide's
   cumulative lengths. The forward scan it replaces took one step per guide point for every text
   point; the search returns the same segment, because the lengths never decrease.

### Consequences

- Text on a path and bent text work at any length; a 2,000-character text in Special Elite
  (3.4 million points) lays out on a path and bends. The geometry hashes the same as before for
  every text that worked before (Special Elite 20 to 60 characters, Roboto 200 to 1,000).
  On the audit's 40,000-point spiral guide its placement took 145 s with the forward scan and 23 s
  with the search, in Node on a fully loaded PC; the output hashed the same.
- A new spread into `Math.min` or `Math.max` fails lint with the helper to use. A new `push(...)` of
  an unbounded array is still possible; review catches it, and `appendAll` is the fix.
- Guards: `src/core/util/spread-free.test.ts` (the helpers equal the spread calls, and work past
  500,000 values), and long-text tests in `text-on-path.test.ts` and `text-bend.test.ts` (300,000
  points), which threw before this change.
