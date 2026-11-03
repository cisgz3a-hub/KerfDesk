## ADR-346 Amendment 1 - A busy moving frame strokes its small objects thin (2026-11-03)

**Status:** Accepted; browser-measured on one laptop, hardware qualification not applicable. Amends ADR-346 decision 2. | **Date:** 2026-11-03

### Context

ADR-346 decision 2 draws an object as a 1 device px hairline only when that one object has at
least 20,000 display segments. Skia's full stroker costs about 3 µs a segment for any stroke
wider than one device pixel, and the cost is per segment, so 5,000 small circles of 32 segments
(160,000 segments) cost what one huge trace does, but each stays under the per-object threshold
and takes the slow path. The 2026-11-02 performance audit (S2-P2-1) measured `line-5000` (5,000
Line circles) on main: pan p95 217 ms, zoom p95 1.4 s with single frames up to 7.2 s, drag one
417 ms. The GPU process was rasterising the canvas almost the whole time; with every stroke
clamped to 1 px the same scene panned, zoomed and dragged at 16.8–33 ms.

The maintainer chose the 1.5 px resting weight, so the look at rest must stay.

### Decision

1. **Moving frames.** A frame is moving while the view pans or zooms and for 150 ms after
   (`MOTION_SETTLE_MS`, the sprites' settle time; `canvas-motion.ts`), and while a drag or marquee
   that has moved something is held, until 150 ms after it is released. A click that moves
   nothing is not motion. A held drag never settles between steps: a slow frame can leave more
   than 150 ms between two steps, and a full-weight frame there is the slowest frame there is
   (measured: it held `line-5000`'s drag at p95 250 ms).
2. **The frame decides, not the object.** On a moving frame, if the objects the frame paints
   directly (on the canvas and below the 4,000-segment sprite size) have at least
   `MOVING_FRAME_HAIRLINE_SEGMENTS` (20,000, the same threshold as decision 2) display segments
   together, their output strokes and the outlines of the Fill pools it paints directly are drawn
   at most 1 device px wide (`movingFrameDrawsHairlines`, `hairlineFrameWidthPx` in
   `draw-complexity.ts`). Non-output layers already draw at 0.75 px and are unchanged.
3. **The settled frame rests at 1.5 px.** When the motion stops, the workspace draws once more
   after the settle time, at the objects' own widths.
4. **Sprites and rasters are left alone.** A sprite or pool raster is blitted, so its stroke
   width costs nothing on a moving frame, and thinning it would change its style key and render
   it again. Objects of 20,000 segments or more keep decision 2's hairline at rest.

### Consequences

- Measured in Chrome 156 on the Iris Xe laptop, production builds of main (`1405bc777`) and this
  change back to back, five kept runs each, frame interval p95 in ms (main → this change):

  | Scene        | Pan        | Pan over artwork | Zoom      | Margin zoom | Drag one  | Marquee   |
  | ------------ | ---------- | ---------------- | --------- | ----------- | --------- | --------- |
  | `line-5000`  | 133 → 16.8 | 300 → 16.8       | 467 → 33  | 83 → 16.8   | 233 → 150 | 200 → 83  |
  | `mix-5000`   | 50 → 16.9  | 184 → 33         | 183 → 33  | 17 → 16.9   | 117 → 67  | 67 → 33   |
  | 200 objects  | 16.8 both  | 16.8 both        | 16.8 both | —           | 16.8 both | 16.8 both |

  Drag one in `line-5000` still spends about 25 ms of main-thread work per step in the panels
  and the drag itself, as on main.
- The settled frame still strokes everything at 1.5 px: in `line-5000` that one frame, and the
  frame after a click, costs 1–2 s of GPU time, as on main. Only a change to the resting weight
  would remove it, and that is the maintainer's decision.
- While a dense scene moves, its small artwork reads half a pixel thinner, then returns to
  1.5 px about 150 ms after it stops. A scene under 20,000 directly painted segments, such as
  200 everyday objects, draws exactly as before on every frame.
- Display only: G-code, Preview, Frame, Start, saved projects and export never read a display
  width and are unchanged.

### Verification

`src/ui/workspace/draw-scene-moving-hairline.test.ts` draws real scenes through `drawScene` with a
recording context and counts the segments of each stroke by width: 5,000 Line circles stroke at
1.5 px when settled and at most 1 px while moving (only the selection chrome stays wider);
200 circles draw identically moving or settled; a Fill plate array's directly painted pool
outlines go thin while moving; sprited objects do not count toward the frame total; and the
compiled G-code is byte-identical before and after drawing moving and settled frames.
`src/ui/workspace/canvas-motion.test.ts` covers the settle timing and that a drag counts as motion
only once it moves something.
