## ADR-116 Amendment 1 - The slide lid runs a tongue to the back wall

**Status:** Accepted. Fixes a fit defect found by the 2026-11-10 Box Generator audit. Builds on
ADR-116 Decision 3 (slide lid) and ADR-106 Amendment 1 (reachable CNC relief). Burn, G-code,
Frame and Start are unchanged. | **Date:** 2026-11-10

### Context

ADR-116 V3 stops the side-wall channels one thickness inside the wall body, leaving a post that
keeps the captive top strip joined to the wall. The lid stopped at those posts: it was full outer
width and `outer depth − 2T` long. The back wall's inner face is at `outer depth − T`, so an
assembled slide-lid box had an open slit, one thickness wide and the full inner width long, across
the back of the lid band. The referee comment said the lid "stops at the back wall's inner face",
but the code and the 3D occupancy test both encoded the slit as intended. Nothing located the lid
sideways either: the channels cut through the walls, so the lid could slide left or right until
friction held it.

### Decision

1. The lid keeps its full-width body up to the posts and carries a tongue, one inner width wide,
   on to the back wall's inner face. The tongue closes the slit, and its sides run between the
   posts' inner faces, so the lid is located sideways with play/4 on each side. Its shoulders and
   its back edge stop together, against the posts and the back wall.
2. The lid takes CNC corner relief like any other part. Panel fit relieves only seat corners, now
   defined as corners where the ring turns through at least 60°. Every joint corner the generator
   draws turns 90°. The thumb notch's polyline arc turns 15° per vertex and is never relieved. With
   the old lid exemption removed, the two tongue shoulders get dogbones the bit can reach, so the
   shoulders seat on the posts instead of stopping on a bit-radius fillet.
3. The slide-lid referee checks the tongue: its end runs between the wall faces with play/4 per
   side, the shoulders span exactly the posts, and the lid length reaches the back wall less
   play/2. The 3D occupancy test now requires the lid band to be solid wall to wall.

### Consequences

- Slide-lid lids generated before this change are one thickness short and leave the slit. Regenerate
  the box (or just the lid) to get the tongue; the walls are unchanged.
- No other style changes: their corners all turn 90°, so the seat rule relieves exactly the corners
  it did before.
- Physical fit is still unverified until the named slide-lid cut in ADR-116 V4 is made.
