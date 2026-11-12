## ADR-357 Amendment 6 - DXF and STL numbers are read whole (2026-11-12)

**Status:** Accepted. Amends ADR-357 (reusable artwork processes and document import). Fixes
Oracle audit O1 finding O8-P2-2. | **Date:** 2026-11-12

### Context

The DXF importer (`dxf-entities.ts`) and both ASCII STL readers (`parse-stl-ascii.ts`,
`parse-stl-blob.ts`) read numbers with `Number.parseFloat`, which returns the longest numeric
prefix. A value written by a comma-decimal locale, such as `12,5`, therefore read as 12, and a
Windows NaN spelling such as `1.#QNAN` read as 1. The DXF "unreadable geometry" guard used the same
call, so it let these values through. The audit reproduced this through the real drop path: a DXF
LINE to `12,5 / 7,25` imported at 12 × 7 mm instead of 12.5 × 7.25, a CIRCLE of radius `2,5` at
radius 2, and an ASCII STL vertex `12,5 0 0` at x 12. Each import reported success with no note.

The DXF Reference calls these values "double-precision floating-point" without naming a decimal
separator. Reference readers decide it: ezdxf reads them with `float()` and refuses the file
(`DXFStructureError`). Writers with a locale bug have produced such files in the wild.

### Decision

1. **The whole token or nothing.** `parseDecimalReal` (`src/core/util/decimal-real.ts`) accepts
   only an optionally signed decimal with an optional exponent, with surrounding spaces. It
   returns NaN for anything else, including `12,5`, `1.#QNAN`, `0x10` and an empty value.
2. **DXF.** Entity values and the unreadable-geometry guard use it. An entity with such a value in
   a geometry code is skipped and named in the import's skipped summary, as a non-numeric value
   already was (IMP-08). A non-geometry code falls back to its default as before.
3. **STL.** An ASCII STL vertex that is not a whole real is the existing "Non-numeric vertex"
   error. The file is refused, not truncated, because a relief carved from a silently wrong mesh
   is worse than no import.
4. **Unchanged.** Every legal spelling reads as before: ` -.5`, `+0`, `5.`, `1.0E+01`, `1e-7`.
   `$INSUNITS` and other integer header values are untouched.

### Evidence

`parse-dxf-decimal-comma.test.ts`, `parse-stl.test.ts` and `parse-stl-blob.test.ts` each gain a decimal-comma
case that failed before the change. `decimal-real.test.ts` lists the accepted and refused
spellings. The existing DXF and STL suites pass unchanged.
