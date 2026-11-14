## ADR-441 Amendment 15 - A kept Material height comes back only for what it was set for (2026-11-15)

**Status:** Accepted. Fixes camera audit v2 K6-P1-1 (P1, a regression from Amendment 14) and
K6-P3-2 (P3). Amends Amendment 14's "At start: the job material's thickness when the project names
one, else the height kept from the last session", and Amendment 13's rotary rule. Code and synthetic
evidence only. | **Date:** 2026-11-15

### Context

Amendment 14 kept the Material height between sessions and restored it whenever the project named
no material. A new project names none, so 85 mm set for a tumbler came back for the next flat job.
After a restart, that drew the picture 46-83 mm off. Amendment 13's rule could not warn, because
there was no material to compare with. Before Amendment 14, the height started at 0 mm each session.

The rotary rule took the part's diameter as its lowest possible top. A rotary never rests a part's
bottom on the bed, so 80 mm on an 80 mm tumbler whose top was 85 mm drew the picture 5.4 mm off,
and nothing was said.

### Decision

1. **The height is kept with what it was set for:** a rotary part of one diameter, a material of
   one thickness, or nothing named.
2. **A project starts at its material's thickness.** Without a material, it starts at the height
   kept for the same rotary part when a rotary applies, else at 0 mm. This holds at start, and
   whenever a project is opened or made (New project included).
3. **Job Review says when a project that names no material is drawn above the bed** (more than
   1 mm). The note under Material height asks whether the stock is that thick.
4. **The rotary rule wants the top above the diameter.** A part's top is its diameter plus the
   height its bottom sits above the bed, taken as at least 3 mm. Job Review and the note say
   "measure the part's top".
5. A height saved by an older version as a plain number is read as nothing kept.

### Consequences

- A height set for a tumbler no longer reaches a flat job, and a flat job drawn above the bed with
  no material named is said before Start.
- A user who sets a height by hand for every job without naming a material sees the new Job Review
  line, which is advice only (ADR-228).

### Verification

- `src/ui/camera/helpers/material-height.test.ts`:
  - a project naming no material starts at 0 mm after a kept 85 mm, in the next session too;
  - the same rotary part gets its height back;
  - an opened project starts at its material, and another rotary part at 0 mm;
  - a plain-number value is ignored.
- `src/ui/laser/camera-height-warning.test.ts`:
  - 80 mm on an 80 mm part warns;
  - a project naming no material at 85 mm warns, and at 0 or 0.5 mm it does not.
