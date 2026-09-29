## ADR-268 Amendment 1 - SVG `<use>` expansion has a budget (2026-09-29)

**Status:** Accepted. | **Date:** 2026-09-29

### Context

Item 4 made the SVG import budgets advisory because "every one of those loops is bounded by the
input". Expanding `<use>` is not. Each `<use>` instantiates a copy of its target, and a target can
hold more `<use>` elements, so every level of a use-of-use chain multiplies the copies. A 1 KB file
of five levels of ten `<use>` elements imported 100,000 polylines and held the import for about
106 s, and each further level multiplies that by ten (audit A-05, 2026-09-29). This is the SVG form
of the "billion laughs" entity expansion that item 2's XML bounds exist to stop. Neither the walk's
depth cap nor the advisory size notes bounded it.

The same audit found that Illustrator's "Save As SVG" files, which declare their namespace URIs and
styles as internal-subset entities (`<!ENTITY st0 "fill:none;stroke:#0000FF;">`), were refused with
"undefined entity" on the worker path and misread on the main-thread path (A-01). There, item 2's
DOCTYPE and ENTITY refusal was the only guard against entity amplification, so accepting those
files needs a bound of its own.

### Decision

1. **Expanding `<use>` has a budget; past it the import is refused.** Every element a `<use>`
   instantiates counts, including the `<symbol>` or group it names, at any nesting. A file may
   instantiate 250,000 elements, or 10 per element of the file itself if that is more. Past the
   budget the import stops with "SVG `<use>` references expand to more than N elements, far more
   than the file holds; such files are refused because they expand without bound (for example,
   uses of uses of uses)." The object bounding box that an `objectBoundingBox` clip measures
   expands `<use>` the same way, under the same budget.
   - The floor: 250,000 instantiated elements took about two seconds on the worker import path
     (measured under Node on 2026-09-29: 250,000 two-point paths instantiated through `<use>` in
     2.1 s, 100,000 in 1.2 s). That is five times the 50,000 polylines at which item 4 already
     reports an import as large, and more than a 20 × 20 sheet of tiled clones of a 600-element
     motif needs.
   - The ratio: files that draw real content through `<use>` instantiate a few elements per
     element of their own. Cairo and pdftocairo draw text as one glyph `<symbol>` per character,
     two elements per `<use>`. Ten per element leaves room for that, and keeps the worst case
     within ten times what walking the file itself costs, where an unbounded chain grows
     exponentially.
2. **A circular `<use>` renders nothing.** A `<use>` whose target is itself, its ancestor, or an
   element the expansion is already inside is skipped, as SVG 2 requires ("in error and must not
   be rendered", struct.html#UseElement), and an import note counts it. Before this the walk
   re-entered it until the depth cap, importing the same geometry up to 128 times (A-09).
3. **Literal internal entities are read; the rest of item 2's entity refusal stands.** An SVG's
   internal subset may declare general entities whose values are literal text: at most 64, each
   at most 4 KB, and none containing `&`, `%` or `<`, so no entity refers to another. All
   references together expand to at most 8 MiB or 100 times the file's length, whichever is
   larger (expat's billion-laughs bound); past that the import is refused. External entities
   (`SYSTEM` or `PUBLIC`), parameter entities, and any declaration after a parameter-entity
   reference (XML 1.0 §5.1) are not read, so references to them still fail as undefined and XXE
   stays impossible. LightBurn projects and CLB libraries still refuse any DOCTYPE.

### What changes in ADR-268

Item 2's genuine integrity bounds gain the `<use>` expansion budget. Its "`<!DOCTYPE`/`<!ENTITY`
rejection (XXE)" now reads: for SVG, external and parameter entities are refused and literal
internal entities are expanded within the bounds of item 3 above. Item 4 is unchanged: the SVG size
budgets stay advisory, because they measure work that the input bounds.

### Consequences

- A file built to expand without bound is refused after walking the budget (about one second on
  the worker path, measured under Node) instead of holding the import for minutes or more. Real
  files stay far below the budget.
- Illustrator files that use entity references import on both SVG import paths.
- Verified with unit tests and the audit's repro files, not against a corpus of real exports.
