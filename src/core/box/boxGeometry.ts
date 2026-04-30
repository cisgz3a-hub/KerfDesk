/**
 * Pure box-joinery geometry extracted from the React box generator so the
 * topology can be tested without rendering UI.
 */

export type EdgeMode = 'finger' | 'slot' | 'flat';

export interface BoxFace {
  name: string;
  points: Array<{ x: number; y: number }>;
  offsetX: number;
  offsetY: number;
}

export interface BoxParams {
  width: number;
  height: number;
  depth: number;
  thickness: number;
  fingerWidth: number;
  openTop: boolean;
  /**
   * Kerf width in mm — the thickness of material the laser removes
   * along each cut path. Default 0 (no compensation).
   *
   * With kerf=k, finger tabs are widened by k and slot openings are
   * narrowed by k. After the laser cuts (removing k/2 on each side of
   * each cut path), tabs and slots both end up at the nominal finger
   * width, producing a snug joint.
   *
   * Typical values: 0.1mm for diode lasers on 3mm plywood, 0.15-0.2mm
   * for CO2 lasers on 3mm acrylic. Users should measure their own
   * kerf with a test cut and adjust until joints fit.
   *
   * Edge segments (the leftmost and rightmost finger of an edge)
   * receive only half-kerf compensation on their inner side — they
   * terminate at the rectangle boundary on the outer side and don't
   * mate with anything beyond the corner, so no compensation is
   * needed there.
   */
  kerf?: number;
}

/**
 * Convert interior cavity dimensions to exterior bounding-box
 * dimensions for our finger-joint convention.
 *
 * Convention (see tests/box-geometry.test.ts — Bottom.bottom finger
 * x-positions match Front.bottom slot x-positions, so Bottom and Front
 * share `width`): each face's outer rectangle aligns with the box
 * exterior on its axis; walls sit flush with floor outer edges.
 *
 *   cavity_W = exterior_W - 2*thickness
 *   cavity_D = exterior_D - 2*thickness
 *   cavity_H = exterior_H - 2*thickness (closed) or - thickness (open top)
 *
 * Inside mode: user types cavity; we add walls to get exterior for
 * {@link generateBoxFaces}.
 */
export function interiorToExterior(
  insideW: number,
  insideH: number,
  insideD: number,
  thickness: number,
  openTop: boolean,
): { width: number; height: number; depth: number } {
  return {
    width: insideW + 2 * thickness,
    depth: insideD + 2 * thickness,
    height: insideH + (openTop ? thickness : 2 * thickness),
  };
}

/**
 * Inverse of {@link interiorToExterior} — exterior → interior cavity.
 */
export function exteriorToInterior(
  exteriorW: number,
  exteriorH: number,
  exteriorD: number,
  thickness: number,
  openTop: boolean,
): { width: number; height: number; depth: number } {
  return {
    width: exteriorW - 2 * thickness,
    depth: exteriorD - 2 * thickness,
    height: exteriorH - (openTop ? thickness : 2 * thickness),
  };
}

export function generateBoxFaces(params: BoxParams): BoxFace[] {
  const { width, height, depth, thickness: t, fingerWidth: fw, openTop, kerf = 0 } = params;
  const spacing = t * 2 + 5;
  const sidewallTop: EdgeMode = openTop ? 'flat' : 'slot';
  const row2Y = height + spacing + t;
  const row3Y = row2Y + height + spacing + t;

  const faces: BoxFace[] = [
    {
      name: 'Front',
      points: generateRectWithFingers(width, height, t, fw, sidewallTop, 'slot', 'finger', 'finger', kerf),
      offsetX: t,
      offsetY: t,
    },
    {
      name: 'Back',
      points: generateRectWithFingers(width, height, t, fw, sidewallTop, 'slot', 'finger', 'finger', kerf),
      offsetX: width + spacing + t,
      offsetY: t,
    },
    {
      name: 'Left',
      points: generateRectWithFingers(depth, height, t, fw, sidewallTop, 'slot', 'slot', 'slot', kerf),
      offsetX: t,
      offsetY: row2Y,
    },
    {
      name: 'Right',
      points: generateRectWithFingers(depth, height, t, fw, sidewallTop, 'slot', 'slot', 'slot', kerf),
      offsetX: depth + spacing + t,
      offsetY: row2Y,
    },
    {
      name: 'Bottom',
      points: generateRectWithFingers(width, depth, t, fw, 'finger', 'finger', 'finger', 'finger', kerf),
      offsetX: t,
      offsetY: row3Y,
    },
  ];

  if (!openTop) {
    faces.push({
      name: 'Top',
      points: generateRectWithFingers(width, depth, t, fw, 'finger', 'finger', 'finger', 'finger', kerf),
      offsetX: width + spacing + t,
      offsetY: row3Y,
    });
  }

  return faces;
}

/**
 * Generate a rectangle with finger joints on each edge.
 *
 * Each edge can be 'finger' (tabs out), 'slot' (notches in), or 'flat'
 * (straight). 'finger' and 'slot' both partition the edge into the same
 * `count` segments and act on the same `i%2===0` positions, so they
 * naturally interlock when paired on the same shared edge.
 *
 * Outward normals (for finger direction):
 *   top:    -y  (finger pushes up = -t, slot cuts down = +t)
 *   right:  +x  (finger pushes right = +t, slot cuts left = -t)
 *   bottom: +y  (finger pushes down = +t, slot cuts up = -t)
 *   left:   -x  (finger pushes left = -t, slot cuts right = +t)
 *
 * Kerf compensation:
 *   When kerf > 0, fingers are widened by `kerf` and slots are
 *   narrowed by `kerf`. This is done by shifting internal segment
 *   boundaries by ±kerf/2 — left if the boundary is between a flat
 *   and a (finger or slot), right if the reverse. The first and last
 *   boundaries (at 0 and w/h) stay fixed so the overall rectangle
 *   dimensions don't change. End-segment fingers/slots receive only
 *   half-kerf compensation on their inner side, which matches the
 *   physics: end fingers terminate at the rectangle corner and don't
 *   mate with anything beyond, so no compensation is needed there.
 */
export function generateRectWithFingers(
  w: number,
  h: number,
  t: number,
  fw: number,
  topMode: EdgeMode,
  bottomMode: EdgeMode,
  leftMode: EdgeMode,
  rightMode: EdgeMode,
  kerf: number = 0,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];

  const countW = Math.max(1, Math.round(w / fw)) | 1;
  const countH = Math.max(1, Math.round(h / fw)) | 1;
  const segW = w / countW;
  const segH = h / countH;
  const k2 = kerf / 2;

  function computeBoundaries(count: number, seg: number, mode: EdgeMode): number[] {
    const total = count * seg;
    const b: number[] = [];
    for (let i = 0; i <= count; i++) {
      if (i === 0) {
        b.push(0);
      } else if (i === count) {
        b.push(total);
      } else if (mode === 'flat') {
        b.push(i * seg);
      } else if (mode === 'finger') {
        b.push(i * seg + (i % 2 === 1 ? +k2 : -k2));
      } else {
        b.push(i * seg + (i % 2 === 1 ? -k2 : +k2));
      }
    }
    return b;
  }

  const topBounds = computeBoundaries(countW, segW, topMode);
  const bottomBounds = computeBoundaries(countW, segW, bottomMode);
  const leftBounds = computeBoundaries(countH, segH, leftMode);
  const rightBounds = computeBoundaries(countH, segH, rightMode);

  for (let i = 0; i < countW; i++) {
    const x1 = topBounds[i]!;
    const x2 = topBounds[i + 1]!;
    if (topMode === 'finger' && i % 2 === 0) {
      points.push({ x: x1, y: 0 }, { x: x1, y: -t }, { x: x2, y: -t }, { x: x2, y: 0 });
    } else if (topMode === 'slot' && i % 2 === 0) {
      points.push({ x: x1, y: 0 }, { x: x1, y: t }, { x: x2, y: t }, { x: x2, y: 0 });
    } else {
      points.push({ x: x1, y: 0 }, { x: x2, y: 0 });
    }
  }

  for (let i = 0; i < countH; i++) {
    const y1 = rightBounds[i]!;
    const y2 = rightBounds[i + 1]!;
    if (rightMode === 'finger' && i % 2 === 0) {
      points.push({ x: w, y: y1 }, { x: w + t, y: y1 }, { x: w + t, y: y2 }, { x: w, y: y2 });
    } else if (rightMode === 'slot' && i % 2 === 0) {
      points.push({ x: w, y: y1 }, { x: w - t, y: y1 }, { x: w - t, y: y2 }, { x: w, y: y2 });
    } else {
      points.push({ x: w, y: y1 }, { x: w, y: y2 });
    }
  }

  for (let i = countW - 1; i >= 0; i--) {
    const x1 = bottomBounds[i]!;
    const x2 = bottomBounds[i + 1]!;
    if (bottomMode === 'finger' && i % 2 === 0) {
      points.push({ x: x2, y: h }, { x: x2, y: h + t }, { x: x1, y: h + t }, { x: x1, y: h });
    } else if (bottomMode === 'slot' && i % 2 === 0) {
      points.push({ x: x2, y: h }, { x: x2, y: h - t }, { x: x1, y: h - t }, { x: x1, y: h });
    } else {
      points.push({ x: x2, y: h }, { x: x1, y: h });
    }
  }

  for (let i = countH - 1; i >= 0; i--) {
    const y1 = leftBounds[i]!;
    const y2 = leftBounds[i + 1]!;
    if (leftMode === 'finger' && i % 2 === 0) {
      points.push({ x: 0, y: y2 }, { x: -t, y: y2 }, { x: -t, y: y1 }, { x: 0, y: y1 });
    } else if (leftMode === 'slot' && i % 2 === 0) {
      points.push({ x: 0, y: y2 }, { x: t, y: y2 }, { x: t, y: y1 }, { x: 0, y: y1 });
    } else {
      points.push({ x: 0, y: y2 }, { x: 0, y: y1 });
    }
  }

  if (points.length === 0) return points;
  const cleaned: Array<{ x: number; y: number }> = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const current = points[i]!;
    const prev = cleaned[cleaned.length - 1]!;
    if (Math.abs(current.x - prev.x) > 0.001 || Math.abs(current.y - prev.y) > 0.001) {
      cleaned.push(current);
    }
  }
  return cleaned;
}
