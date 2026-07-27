// Joinery geometry for the bundled project library.
//
// The rule this module exists to enforce: a project that claims to assemble
// must have tabs and sockets that are exact complements. A tab edge with N
// teeth and a socket edge with N teeth on the mating panel interlock by
// construction, because both derive their tooth intervals from the same
// division of the edge.
//
// Edge division: an edge of length L with N teeth splits into 2N+1 equal
// segments. Odd-indexed segments are active (a tab protrudes there, a socket
// is cut there); even-indexed segments stay on the nominal edge line. Starting
// and ending on an even segment keeps both corners square, which is what makes
// four such panels meet cleanly at a corner.
//
// Clearance is the per-side gap: tabs shrink by clearance/2 at each end and
// sockets grow by clearance/2 at each end. Laser work uses 0 because the kerf
// already opens the socket and thins the tab; CNC work uses ~0.15 mm because
// a cutter removes its nominal diameter and nothing more (ADR-106 convention).

import { circle, n, OP, path, poly } from './svg.mjs';

export const FLAT = { kind: 'flat' };

export function tabs(count) {
  return { kind: 'tab', count, phase: 'odd' };
}

/**
 * Notched edge. `phase` selects which of the 2N+1 segments are cut away:
 * 'odd' leaves both corners intact (N notches), 'even' removes them (N+1
 * notches). Two panels meeting at a box corner both claim the same corner
 * prism, so one takes 'odd' and the other 'even' — that complementary pair is
 * what makes the corner interlock instead of collide.
 */
export function sockets(count, phase = 'odd') {
  return { kind: 'socket', count, phase };
}

/**
 * Explicit rectangular cut-ins on one edge, each `{ at, width, depth }` where
 * `at` is the distance from the edge's start in walk order (top edge runs
 * left→right, right top→bottom, bottom right→left, left bottom→top).
 * This is what makes cross-lap slots and cable cut-outs possible.
 */
export function notches(list) {
  return { kind: 'notch', list };
}

/** Explicit rectangular protrusions on one edge; the complement of `notches`. */
export function pins(list) {
  return { kind: 'pin', list };
}

/** `at` value that centres a feature of `width` on an edge of `length`. */
export function centered(length, width) {
  return (length - width) / 2;
}

/**
 * The nominal tooth runs for an edge of `length` divided into 2N+1 segments.
 * Pins and the mortises that receive them are both derived from this one call,
 * which is what guarantees they line up.
 */
export function toothRuns(length, count, phase = 'odd') {
  const segments = 2 * count + 1;
  const seg = length / segments;
  const first = phase === 'even' ? 0 : 1;
  const runs = [];
  for (let i = first; i < segments; i += 2) {
    runs.push({ at: i * seg, width: seg });
  }
  return runs;
}

function toothFeatures(length, spec, clearance, thickness) {
  const segments = 2 * spec.count + 1;
  const seg = length / segments;
  // Tabs lose material at both ends, sockets gain it — that difference IS the fit.
  const delta = spec.kind === 'tab' ? clearance / 2 : -clearance / 2;
  const first = spec.phase === 'even' ? 0 : 1;
  const out = [];
  for (let i = first; i < segments; i += 2) {
    // Clamp at the ends: an 'even' run starts and finishes flush with the
    // corner, and growing a socket past the corner would open the outline.
    const start = Math.max(0, i * seg + delta);
    const end = Math.min(length, (i + 1) * seg - delta);
    out.push({ at: start, width: end - start, depth: thickness, kind: spec.kind });
  }
  return out;
}

function edgeFeatures(spec, length, thickness, clearance) {
  if (spec.kind === 'flat' || spec.count === 0) return [];
  if (spec.kind === 'tab' || spec.kind === 'socket') {
    return toothFeatures(length, spec, clearance, thickness);
  }
  const outward = spec.kind === 'pin';
  return spec.list.map((feature) => ({
    at: feature.at + (outward ? clearance / 2 : -clearance / 2),
    width: feature.width - (outward ? clearance : -clearance),
    depth: feature.depth ?? thickness,
    kind: spec.kind,
  }));
}

/**
 * Points added along one edge. The caller supplies the starting corner; this
 * returns only the detour, walking from `corner` along `dir` with `out`
 * pointing away from the panel body.
 */
function edgeDetour(edge, thickness, clearance) {
  const { corner, dir, out, length, spec } = edge;
  const at = (d, o) => [corner[0] + dir[0] * d + out[0] * o, corner[1] + dir[1] * d + out[1] * o];
  const points = [];
  for (const feature of edgeFeatures(spec, length, thickness, clearance)) {
    const outward = feature.kind === 'tab' || feature.kind === 'pin';
    const depth = feature.depth * (outward ? 1 : -1);
    const end = feature.at + feature.width;
    points.push(at(feature.at, 0), at(feature.at, depth), at(end, depth), at(end, 0));
  }
  return points;
}

/**
 * Closed outline of a rectangular panel with per-edge joinery features, walked
 * clockwise from the top-left corner in a y-down coordinate system.
 *
 * `edges` takes FLAT, tabs(n), sockets(n), notches([...]) or pins([...]) for
 * top/right/bottom/left.
 */
export function panelOutline(options) {
  const { x = 0, y = 0, width, height, thickness, clearance = 0, edges = {} } = options;
  const { top = FLAT, right = FLAT, bottom = FLAT, left = FLAT } = edges;
  const walk = [
    { corner: [x, y], dir: [1, 0], out: [0, -1], length: width, spec: top },
    { corner: [x + width, y], dir: [0, 1], out: [1, 0], length: height, spec: right },
    { corner: [x + width, y + height], dir: [-1, 0], out: [0, 1], length: width, spec: bottom },
    { corner: [x, y + height], dir: [0, -1], out: [-1, 0], length: height, spec: left },
  ];
  const points = [];
  for (const edge of walk) {
    points.push(edge.corner, ...edgeDetour(edge, thickness, clearance));
  }
  return points;
}

/** panelOutline as ready-to-emit markup. */
export function panel(options, color = OP.cut) {
  return poly(panelOutline(options), color);
}

/**
 * A cross-lap pair: two panels that slide together at right angles, each
 * carrying a `thickness`-wide slot cut half its height. Returns the two edge
 * specs to hand to `panelOutline` — `a` slots up from the bottom, `b` down
 * from the top, which is what lets them interlock.
 */
export function crossLapSlots(options) {
  const { spanA, spanB, heightA, heightB, thickness, clearance = 0 } = options;
  const slot = thickness + clearance;
  return {
    a: notches([{ at: centered(spanA, slot), width: slot, depth: heightA / 2 }]),
    b: notches([{ at: centered(spanB, slot), width: slot, depth: heightB / 2 }]),
  };
}

/**
 * A through-mortise sized for `thickness` stock. `reliefRadius > 0` adds
 * corner-escape circles centred on each corner so a round cutter can reach a
 * square inside corner — the CNC F-CNC26 relief convention. Laser passes 0.
 * `orientation` is the direction the slot runs: 'horizontal' along +x.
 */
export function mortise(options) {
  const {
    x,
    y,
    length,
    thickness,
    orientation = 'horizontal',
    clearance = 0,
    reliefRadius = 0,
    color = OP.cut,
  } = options;
  const long = length + clearance;
  const short = thickness + clearance;
  const w = orientation === 'horizontal' ? long : short;
  const h = orientation === 'horizontal' ? short : long;
  // Grow symmetrically about the nominal rectangle so the mortise stays
  // centred on the pin that toothRuns() placed.
  const x0 = x - clearance / 2;
  const y0 = y - clearance / 2;
  const corners = [
    [x0, y0],
    [x0 + w, y0],
    [x0 + w, y0 + h],
    [x0, y0 + h],
  ];
  const body = poly(corners, color);
  if (reliefRadius <= 0) return body;
  return body + corners.map(([cx, cy]) => circle(cx, cy, reliefRadius, color)).join('');
}

/**
 * Obround (stadium) hole — a slot with semicircular ends. Used for adjustable
 * fasteners, where a plain round hole would give no travel.
 */
export function obround(x, y, length, width, color = OP.cut) {
  const r = width / 2;
  const left = x + r;
  const right = x + length - r;
  const d =
    `M${n(left)} ${n(y)}L${n(right)} ${n(y)}` +
    `A${n(r)} ${n(r)} 0 0 1 ${n(right)} ${n(y + width)}` +
    `L${n(left)} ${n(y + width)}` +
    `A${n(r)} ${n(r)} 0 0 1 ${n(left)} ${n(y)}Z`;
  return path(d, color);
}

/**
 * Captive-nut pocket: a hex recess joined to the bolt clearance hole by a
 * neck, so the nut drops in from the edge and is trapped once assembled.
 * `acrossFlats` is the nut's wrench size (5.5 mm for M3, 7 mm for M4).
 */
export function captiveNut(options) {
  const { x, y, acrossFlats, boltDiameter, depth, color = OP.cut } = options;
  const r = acrossFlats / Math.sqrt(3);
  const hex = Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 180) * (30 + 60 * i);
    return [x + r * Math.cos(angle), y + depth + r * Math.sin(angle)];
  });
  const neck = poly(
    [
      [x - boltDiameter / 2, y],
      [x + boltDiameter / 2, y],
      [x + boltDiameter / 2, y + depth],
      [x - boltDiameter / 2, y + depth],
    ],
    color,
  );
  return poly(hex, color) + neck;
}

/**
 * Holding-tab marks on a rectangular profile: `count` short bridge marks
 * spaced evenly around the perimeter, on the score colour so the operator can
 * see where the part is meant to stay attached to the sheet.
 */
export function tabMarks(x, y, width, height, count, widthMm, color = OP.score) {
  const perimeter = 2 * (width + height);
  return Array.from({ length: count }, (_, i) =>
    perimeterMark([x, y], width, height, (perimeter * (i + 0.5)) / count, widthMm, color),
  ).join('');
}

function perimeterMark(origin, width, height, distance, markWidth, color) {
  const [ox, oy] = origin;
  const half = markWidth / 2;
  let d = distance;
  if (d < width) return segment([ox + d - half, oy], [ox + d + half, oy], color);
  d -= width;
  if (d < height) return segment([ox + width, oy + d - half], [ox + width, oy + d + half], color);
  d -= height;
  if (d < width) {
    const cx = ox + width - d;
    return segment([cx + half, oy + height], [cx - half, oy + height], color);
  }
  d -= width;
  const cy = oy + height - d;
  return segment([ox, cy + half], [ox, cy - half], color);
}

function segment(a, b, color) {
  return poly([a, b], color, false);
}
