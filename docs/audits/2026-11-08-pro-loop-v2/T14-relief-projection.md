# Pro loop v2 — T14 Relief projection

- **When:** 2026-11-08   **Tree:** `devin/pro-loop-v2` (main) and `devin/audit-loops-20261108` (#1622)
- **Harness:** `audit/loop-v1/r2-projection.test.ts` (outside the repository): a 24 mm line projected
  onto a 30 × 20 mm depth-map ramp (0.5 mm pixels, 6 mm rise) with a 60° V-bit, vertical depth 0.5 mm.
- **Counts:** 0 raised (the only deviation is the KNOWN L6-P2-1, already fixed in #1622).

| Tree | Points read | Depth error against (surface − 0.5 mm) |
|---|---|---|
| main `82458c902` | 196 | 0 to **+0.100 mm** shallow, growing with the slope: the highest-pixel cells of a 0.5 mm pixel map |
| #1622 (ADR-580 Amendment 2) | 196 | 0.0000 |

With #1622 the projected engraving sits exactly 0.5 mm under the surface everywhere along the ramp, in
the vertical convention the setting names. Clean once #1622 merges.
