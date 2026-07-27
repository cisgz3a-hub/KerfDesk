// SVG emission primitives for the bundled project library generator.
// Every project is authored in real millimetres: the document declares
// width/height in mm with a 1:1 viewBox so the shipped SVG importer places it
// at true size without a unit guess.

// Stroke colours are drawn from core/scene/artwork-operation.ts OPERATION_PALETTE
// so an imported project lands on the same colours the canvas allocates for
// fresh operations. The importer groups geometry by stroke colour
// (io/svg/parse-svg.ts), so one colour per operation is what separates a
// project's cut lines from its engrave lines on import.
export const OP = {
  cut: '#000000',
  engrave: '#2563eb',
  pocket: '#dc2626',
  vcarve: '#16a34a',
  drill: '#9333ea',
  score: '#ea580c',
};

const DECIMALS = 3;
const STROKE_WIDTH = 0.1;

/** Formats a millimetre value for path data: fixed precision, no trailing zeros. */
export function n(value) {
  if (!Number.isFinite(value)) throw new Error(`non-finite coordinate: ${value}`);
  const fixed = value.toFixed(DECIMALS);
  const trimmed = fixed.replace(/\.?0+$/, '');
  return trimmed === '-0' || trimmed === '' ? '0' : trimmed;
}

function styled(color) {
  return `fill="none" stroke="${color}" stroke-width="${STROKE_WIDTH}"`;
}

export function path(d, color = OP.cut) {
  return `<path d="${d}" ${styled(color)}/>`;
}

export function line(x1, y1, x2, y2, color = OP.cut) {
  return path(`M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}`, color);
}

/** Emits a polyline/polygon from [x, y] pairs. `close` appends Z. */
export function poly(points, color = OP.cut, close = true) {
  if (points.length < 2) throw new Error('poly needs at least two points');
  const [first, ...rest] = points;
  const head = `M${n(first[0])} ${n(first[1])}`;
  const tail = rest.map(([x, y]) => `L${n(x)} ${n(y)}`).join('');
  return path(`${head}${tail}${close ? 'Z' : ''}`, color);
}

export function rect(x, y, w, h, color = OP.cut) {
  return poly(
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    color,
  );
}

/** Rectangle with equal corner radii, emitted as arcs the importer flattens. */
export function roundRect(x, y, w, h, r, color = OP.cut) {
  const radius = Math.min(r, w / 2, h / 2);
  if (radius <= 0) return rect(x, y, w, h, color);
  const a = `A${n(radius)} ${n(radius)} 0 0 1`;
  const d =
    `M${n(x + radius)} ${n(y)}` +
    `L${n(x + w - radius)} ${n(y)}${a} ${n(x + w)} ${n(y + radius)}` +
    `L${n(x + w)} ${n(y + h - radius)}${a} ${n(x + w - radius)} ${n(y + h)}` +
    `L${n(x + radius)} ${n(y + h)}${a} ${n(x)} ${n(y + h - radius)}` +
    `L${n(x)} ${n(y + radius)}${a} ${n(x + radius)} ${n(y)}Z`;
  return path(d, color);
}

export function circle(cx, cy, r, color = OP.cut) {
  const d =
    `M${n(cx - r)} ${n(cy)}` +
    `A${n(r)} ${n(r)} 0 0 1 ${n(cx + r)} ${n(cy)}` +
    `A${n(r)} ${n(r)} 0 0 1 ${n(cx - r)} ${n(cy)}Z`;
  return path(d, color);
}

/** Circular arc from angle a0 to a1 (degrees, clockwise-positive, y-down). */
export function arc(cx, cy, r, a0Deg, a1Deg, color = OP.cut) {
  const p0 = polar(cx, cy, r, a0Deg);
  const p1 = polar(cx, cy, r, a1Deg);
  const sweep = a1Deg > a0Deg ? 1 : 0;
  const large = Math.abs(a1Deg - a0Deg) > 180 ? 1 : 0;
  return path(
    `M${n(p0[0])} ${n(p0[1])}A${n(r)} ${n(r)} 0 ${large} ${sweep} ${n(p1[0])} ${n(p1[1])}`,
    color,
  );
}

export function polar(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/** Evenly spaced sample points along a full circle, starting at `startDeg`. */
export function ring(cx, cy, r, count, startDeg = 0) {
  return Array.from({ length: count }, (_, i) => polar(cx, cy, r, startDeg + (360 * i) / count));
}

/**
 * Sampled points along an arc, inclusive of both ends. Used where a curve has
 * to be spliced into a hand-built outline rather than drawn on its own.
 */
export function arcPoints(cx, cy, r, a0Deg, a1Deg, steps) {
  return Array.from({ length: steps + 1 }, (_, i) =>
    polar(cx, cy, r, a0Deg + ((a1Deg - a0Deg) * i) / steps),
  );
}

export function translate(points, dx, dy) {
  return points.map(([x, y]) => [x + dx, y + dy]);
}

export function rotate(points, cx, cy, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return points.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  });
}

export function mirrorX(points, axisX) {
  return points.map(([x, y]) => [2 * axisX - x, y]);
}

/** Bounding box of [x, y] pairs. */
export function bounds(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/**
 * Wraps body markup in a millimetre-true SVG document. The 1:1 viewBox is what
 * makes `parseSvg` treat user units as millimetres.
 */
export function doc(widthMm, heightMm, body) {
  const w = n(widthMm);
  const h = n(heightMm);
  const markup = Array.isArray(body) ? body.flat(Infinity).filter(Boolean).join('') : body;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" ` +
    `viewBox="0 0 ${w} ${h}">${markup}</svg>`
  );
}
