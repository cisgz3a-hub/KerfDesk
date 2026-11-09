## ADR-480 Amendment 5 - A per-second unit covers the whole speed expression (2026-11-09)

**Status:** Accepted. Amends ADR-480 Decision 7 ("Math in number boxes") for the Speed and CNC
feed boxes, which UX audit U8-P3-4 (#1605) taught to take mm/s, cm/s and in/s. It fixes
rolling audit v12 finding X5-P3-4 (`docs/audits/2026-11-09-rolling-v12/X5-fix-ux-sweep.md`),
which the refuter re-rated to P1.

### Context

#1605 converted a speed per second by rewriting only the number beside the unit:
`(\d…)\s*mm/s` became `(n mm * 60)`.

- "1/2 mm/s" became 1/(2 mm × 60) = 0.0083, which the Speed box clamps to 1 mm/min, so the
  G-code emitted F1. On the first-burn lesson's 90 mm circle that keeps a lit beam on the
  material for 283 minutes instead of 9.4, with no invalid mark and nothing in Job Review.
- "60/2 mm/s" read 1, "1/2 in/s" read 1, "50+50 mm/s" read 3,050, and "(50+50) mm/s" was
  refused.

The length boxes already read "1/2 in" as 12.7 mm: there, a unit after the expression covers
all of it.

### Decision

1. A per-second unit at the **end** of a feed box covers the whole expression. The box
   evaluates the rest as a length in that unit, as a length box does, then multiplies by 60:
   "1/2 mm/s" = 30 mm/min, "60/2 mm/s" = 1,800, "1/2 in/s" = 762, "(50+50) mm/s" = 6,000.
2. A per-second unit **anywhere else**, such as "100 mm/s + 5", "2 mm/s * 3" or "1 mm/s + 1 mm/s",
   is refused with "write mm/s once, after the whole speed, such as 1/2 mm/s". It is never
   read as a different speed.
3. Bare numbers, mm/min, plain "100 mm/s" and the length boxes are unchanged.

### Verification

`src/ui/tutorials/lightburn-path-u8.test.tsx` holds every value above and the refusals, with
the display unit in mm and in inches.
