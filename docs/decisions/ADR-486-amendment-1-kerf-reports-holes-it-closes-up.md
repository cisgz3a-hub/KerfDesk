## ADR-486 Amendment 1 - The kerf offset reports holes it closes up (2026-09-29)

**Status:** Accepted; software-verified through unit tests, no material cut. | **Date:** 2026-09-29

Amends ADR-486 decision 2 ("A failed offset still drops only that path's contours and reports
`kerf-offset-failed`"). Advisory only: nothing here refuses Frame, Start or export (rule 7,
non-negotiable 21).

### Context

Kerf Offset grows every part and shrinks every hole by the offset, and the other way round when the
offset is negative. A hole or slot narrower than twice the offset has no inside left, so the offset
engine returns nothing for it and the cut is missing from the job. The engine did not fail, so no
diagnostic was raised. The weakness audit (E-4) reproduced it: a 0.25 mm by 20 mm slot inside a
60 mm by 40 mm plate with a 0.15 mm Kerf Offset compiled to the plate's outline alone.

Job Review's minimum-feature check (ADR-433) does flag the slot, as "1 gap between cut shapes or
lines narrower than the 0.3 mm kerf, the cuts on each side merge". With Kerf Offset set, nothing
merges: the slot is not cut at all. That check reads the artwork and cannot know what the offset
did.

### Decision

1. **Count what closed up.** An offset contour never touches a source contour, so it lies in exactly
   one region of the source layout: inside the deepest source contour around it and outside that
   contour's children. A contour that shrinks under the offset (a hole, or a part when the offset is
   negative) whose region holds no offset contour has closed up (`kerf-closed-up.ts`). That covers a
   narrow slot, a hole whose channel around an island closes, and a thin part under a negative
   offset. A path offset one ring at a time (decision 1's second case) counts a shrinking ring whose
   own offset is empty.
2. **Report it.** The line compile adds `kerf-offset-closed-up` with the layer name, the count and
   the offset. Job Review says how many holes or slots (or parts) narrower than the kerf are missing
   from the job and will not be cut, with one line per layer when objects on it compile apart.
3. **Nothing else moves.** The G-code is unchanged. Offsets finer than the engine's 1 µm grid are not
   checked, because an offset contour can then lie on its source.

### Limits

- A hole that only narrows in places (a dumbbell whose neck closes) keeps some offset contour and is
  not counted, although part of it is not cut.
- Two parts of one path closer than the kerf merge into one outline; the minimum-feature check
  already reports that gap.
- Code and test evidence only. No material was cut.

### Tests

`compile-job-kerf-closed-up.test.ts` (a slot as its own object, a slot in the plate's own path, a
channel around an island, a thin part under a negative offset, a path offset ring by ring, and
layouts that report nothing); `compile-diagnostic-warnings.test.ts` (the wording for holes and parts,
and one line per layer). The compile tests fail without the change.
