// Reusable construction archetypes. Each one is a joinery scheme whose fit is
// guaranteed by construction, so individual projects can be authored as
// dimensions and decoration rather than as fresh joint maths.

import {
  centered,
  mortise,
  notches,
  panel,
  panelOutline,
  pins,
  sockets,
  toothRuns,
} from './joinery.mjs';
import { OP, poly } from './svg.mjs';
import { part } from './project.mjs';

/**
 * Open-top tray: four walls corner-jointed with complementary fingers, plus a
 * captured floor whose pins pass through mortises in every wall.
 *
 * Corner scheme: front/back walls take 'odd' notches and left/right walls take
 * 'even', so at every height exactly one panel owns the corner prism.
 *
 * Returns { parts, innerWidthMm, innerDepthMm } — `parts` is ready for sheet().
 */
export function tray(options) {
  const {
    widthMm: w,
    depthMm: d,
    heightMm: h,
    thicknessMm: t,
    clearanceMm: c = 0,
    floorHeightMm: floor = 8,
    cornerFingers = 3,
    floorPins = 2,
    decorateFront,
    decorateSide,
  } = options;
  const innerW = w - 2 * t;
  const innerD = d - 2 * t;
  // Floor sits `floor` mm up from the wall's bottom edge; walls are drawn with
  // their top at panel y = 0.
  const mortiseY = h - floor - t;
  const widthRuns = toothRuns(innerW, floorPins);
  const depthRuns = toothRuns(innerD, floorPins);

  const wall = (span, runs, phase, decorate) => (ox, oy) => {
    const outline = panel({
      x: ox,
      y: oy,
      width: span,
      height: h,
      thickness: t,
      clearance: c,
      edges: { left: sockets(cornerFingers, phase), right: sockets(cornerFingers, phase) },
    });
    // Floor pins start at box x = t, which is panel-local x = t on every wall.
    const slots = runs
      .map((run) =>
        mortise({
          x: ox + t + run.at,
          y: oy + mortiseY,
          length: run.width,
          thickness: t,
          clearance: c,
        }),
      )
      .join('');
    return outline + slots + (decorate === undefined ? '' : decorate(ox, oy, span, h));
  };

  const pinSpec = (runs) => pins(runs.map((run) => ({ ...run, depth: t })));
  // Drawn inset by one stock thickness: the floor's pins stand `t` proud of the
  // panel on every side, so the part's true footprint is innerW+2t by innerD+2t.
  // Declaring the bare panel would let the pins overrun the sheet margin.
  const floorPart = (ox, oy) =>
    panel({
      x: ox + t,
      y: oy + t,
      width: innerW,
      height: innerD,
      thickness: t,
      clearance: c,
      edges: {
        top: pinSpec(widthRuns),
        bottom: pinSpec(widthRuns),
        left: pinSpec(depthRuns),
        right: pinSpec(depthRuns),
      },
    });

  return {
    innerWidthMm: innerW,
    innerDepthMm: innerD,
    parts: [
      part(w, h, wall(w, widthRuns, 'odd', decorateFront), {
        copies: 2,
        name: 'Front / back wall',
      }),
      part(d, h, wall(d, depthRuns, 'even', decorateSide), { copies: 2, name: 'Side wall' }),
      part(innerW + 2 * t, innerD + 2 * t, floorPart, { name: 'Floor' }),
    ],
  };
}

/**
 * Cross-lap pair: an upright profile that drops into a wide foot. `uprightSlot`
 * rises from the upright's bottom edge and `footSlot` descends from the foot's
 * top edge; the two depths sum to the foot height so both parts bottom out on
 * the bench at the same time.
 */
export function crossLapFoot(options) {
  const {
    footWidthMm,
    footHeightMm,
    uprightSlotDepthMm,
    thicknessMm: t,
    clearanceMm: c = 0,
  } = options;
  const slot = t + c;
  const footSlotDepth = footHeightMm - uprightSlotDepthMm;
  const draw = (ox, oy) =>
    panel({
      x: ox,
      y: oy,
      width: footWidthMm,
      height: footHeightMm,
      thickness: t,
      clearance: 0,
      edges: {
        top: notches([{ at: centered(footWidthMm, slot), width: slot, depth: footSlotDepth }]),
      },
    });
  return {
    footSlotDepthMm: footSlotDepth,
    slotWidthMm: slot,
    part: part(footWidthMm, footHeightMm, draw, { name: 'Foot' }),
  };
}

/**
 * Notched strip for egg-crate grids: a rectangle with `count` slots of stock
 * width cut half its height from the given edge. Two perpendicular sets
 * interlock without glue.
 */
export function eggCrateStrip(options) {
  const {
    lengthMm,
    heightMm,
    thicknessMm: t,
    clearanceMm: c = 0,
    slotPositions,
    edge = 'top',
  } = options;
  const slot = t + c;
  const spec = notches(
    slotPositions.map((centre) => ({ at: centre - slot / 2, width: slot, depth: heightMm / 2 })),
  );
  return (ox, oy) =>
    panel({
      x: ox,
      y: oy,
      width: lengthMm,
      height: heightMm,
      thickness: t,
      clearance: 0,
      edges: { [edge]: spec },
    });
}

/** Closed outline points for a regular polygon inscribed in radius `r`. */
export function regularPolygon(cx, cy, r, sides, rotationDeg = -90) {
  return Array.from({ length: sides }, (_, i) => {
    const angle = ((rotationDeg + (360 * i) / sides) * Math.PI) / 180;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  });
}

/** A regular polygon as markup. */
export function polygonPath(cx, cy, r, sides, options = {}) {
  const { rotationDeg = -90, color = OP.cut } = options;
  return poly(regularPolygon(cx, cy, r, sides, rotationDeg), color);
}

export { panelOutline };
