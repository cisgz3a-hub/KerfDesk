## ADR-494 Amendment 1 - Placed tabs stay where they were through path commands (2026-09-29)

**Status:** Accepted; software-verified through unit tests. | **Date:** 2026-09-29

Amends ADR-494 item 4 ("Move, rotate, scale, copy and paste, break apart, recolour, path join and
text re-edits carry them as they carry `cncTabAnchors`"), which did not name the path commands of
ADR-480. Output changes only for artwork that has tabs placed by hand. No project schema change,
no new guard or refusal (ADR-228).

### Context

A tab placed by hand, laser (`laserTabAnchors`) or CNC (`cncTabAnchors`), is stored as a fraction
`pathT` of one source contour's length, measured from that contour's start in the artwork's own
coordinates (ADR-156). Any command that changes where a contour starts, which way it runs, or
which object carries it must keep each tab at the same physical place, or deliberately handle it.
The 2026-09-28 weakness audit (finding E-3) found commands that did neither for laser tabs.

- **Delete Duplicates** (ADR-480 item 5) compared placed CNC tabs but not placed laser tabs, so a
  copy carrying laser tabs matched an untabbed copy and could be the one deleted, and two copies
  with the same fractions on contours that start at different corners, which put the tabs at
  different places, counted as one.

### Decision

1. **Delete Duplicates.** Two objects are duplicates only when they cut the same thing, placed
   tabs included. Laser tabs join the comparison exactly as CNC tabs did: objects whose
   `laserTabAnchors` differ are kept, and an object carrying placed laser tabs is compared with
   its authored transform, contour order, start point and direction, as ADR-480 item 5 already did
   for CNC tabs. Laser and CNC tabs at the same fractions are different output and are kept apart.
   When a copy is deleted, the kept copy has the same tabs at the same places.

### Consequences

- Delete Duplicates deletes fewer objects only where copies differ in placed laser tabs, or where
  tabbed copies start or run differently.

### Verification

- `src/core/geometry/duplicate-shapes.test.ts`: a tabbed and an untabbed copy are both kept in
  either order and burn different outlines; copies whose start point or authored scale moves the
  same fraction are kept while a true copy, which burns the same outline, is deleted; laser and
  CNC tabs at the same fraction are kept apart.
