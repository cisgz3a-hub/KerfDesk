# Pro loop v2 — T7 image transforms, T12 pocket islands

- **When:** 2026-11-08   **Tree:** `devin/pro-loop-v2`
- **Harness:** `audit/loop-v1/r2-image-pocket.test.ts` (outside the repository): `emitGcode`, the
  round's GRBL model for the image, and a flat end-mill stamp on a 0.1 mm grid for the pocket.
- **Counts:** 0 raised.

## T7 Image transforms

A 20 × 10 mm threshold image whose left half is black, placed at (100, 100) and transformed about
its own origin, as the scene transform defines.

| Transform | Burn bounds (machine mm) | Burn centroid | Read |
|---|---|---|---|
| none | x 100–120, y 290.25–299.75 | x 106.25 | black half on the left, rows at pixel centres |
| mirror X | x 80–100 | x 93.75 | black half now on the right, mirrored about the origin |
| rotate 90° | 10 wide × 20 tall | — | turned, same area |
| rotate 180° | x 80–100, y 300.25–309.75 | x 93.75 | turned through the origin |
| scale 2 | 40 × 20 | — | doubled |

Every transform lands where the object's transform says, so Preview, Frame and burn agree with the
canvas. Clean.

## T12 Pocket with an island, 1/8" end mill, 3 mm deep

| Stepover | Island cells cut | Cells cut outside the pocket | Floor cells short of depth, away from walls |
|---|---|---|---|
| 40 % | 0 | 0 | 0 of 110,000 |
| 70 % | 0 | 0 | 0 of 110,000 |

Clean: the island and the outside stay untouched, and the floor is fully cleared even above 50 %
stepover (ADR-289 Amendment 1's core clearing).
