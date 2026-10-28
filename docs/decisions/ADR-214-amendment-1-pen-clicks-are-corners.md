## ADR-214 Amendment 1 - The pen's plain clicks are corners

**Status:** Accepted; unit-tested, not hardware-tested. | **Date:** 2026-10-28

Fixes rolling audit v7 L2-P2-2 (`docs/audits/2026-10-28-rolling-v7/L2-shapes-dimensions.md`).
ADR-214 version-stamps the pen-drawing fairing; no ADR had decided that plain clicks lose their
corners.

### Context

The Line/pen tool passed plain click-by-click paths to `createPolyline`, whose default `'round'`
fairing fits least-squares cubics through every path with 4 or more open or 5 or more closed
points, declaring no corners (`roundPolylineCurve`). A 5-click 100 × 100 house burned with walls
bowed up to 1.51 mm and read W 102.535 × 100.298. With any one node dragged, every plain click
stayed a straight corner (100 × 100). The behaviour came from PRs #188 and #194. It contradicted
the tool's own tooltip ("Draw connected line segments"), its draft preview ("straight between
corner clicks") and `pen-curve.ts`.

LightBurn 1.7 Draw Lines (https://docs.lightburnsoftware.com/1.7/Reference/DrawLines/): "Placing
corner nodes and creating lines is the default behavior of the Draw Lines tool". Smooth nodes come
from click-and-drag, or from the Auto-Smoothed mode the S key toggles.

### Decision

1. **The PC pen materializes plain clicks exactly** (`createPolyline` fairing mode `'exact'`):
   each click is a corner joined to the next by a straight line. A dragged node still makes the
   cubics beside it, and segments between two plain clicks stay straight (`pen-curve.ts`).
2. **Fairing stays where the input is a freehand stroke.** The phone's finger drawing and the MCP
   `add_polyline` command share one remote write and keep `'round'`; the MCP description now says
   so instead of naming the PC pen. The fairing migration keeps re-fairing unstamped legacy
   drawings with `'round'`.
3. **The fairing version is not bumped.** A drawing stamped at version 1 keeps the curves it was
   saved with, and new pen drawings carry the stamp, so the migration never re-fairs their corners.

### Consequences

- A clicked outline burns at its clicked size, matching the draft preview and LightBurn.
- A LightBurn-style smooth-node toggle (S) and an exact mode for `add_polyline` are not added here.
