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

export interface BoxJointMetrics {
  /** Material removed by the laser cut, full kerf width in mm. */
  kerf: number;
  /** Intentional looseness applied to each mating side of the joint. */
  fitAllowance: number;
  /** Boundary adjustment used for finger/slot width compensation. */
  widthCompensation: number;
  /** Drawn outward tab depth before the laser removes half-kerf at the tip. */
  drawnTabDepth: number;
  /** Drawn inward slot depth before the laser removes half-kerf at the pocket end. */
  drawnSlotDepth: number;
  /** Expected final physical tab depth after cutting. */
  physicalTabDepth: number;
  /** Expected final physical slot depth after cutting. */
  physicalSlotDepth: number;
  /** Expected physical tab-width change from nominal segment width. */
  physicalTabWidthDelta: number;
  /** Expected physical slot-width change from nominal segment width. */
  physicalSlotWidthDelta: number;
  /** Expected slot width minus tab width for a nominally matched pair. */
  expectedWidthClearance: number;
}

export interface BoxParams {
  width: number;
  height: number;
  depth: number;
  thickness: number;
  fingerWidth: number;
  openTop: boolean;
  /**
   * Kerf width in mm — the thickness of material the laser removes along each
   * cut path. A real value is essential for finger-joint boxes. Measure this
   * per material/machine/focus setup with a small test coupon.
   *
   * The generator treats kerf as physical beam width. Width compensation shifts
   * internal tab/slot boundaries by kerf/2; depth compensation draws tabs
   * kerf/2 longer and slots kerf/2 shallower so post-cut tab/slot depth lands
   * back on material thickness.
   */
  kerf?: number;
  /**
   * Intentional fit looseness in mm per mating side. This is separate from
   * kerf: kerf corrects the beam, fitAllowance controls press/glue fit.
   *
   * fitAllowance=0 gives a mathematically snug joint after kerf compensation.
   * fitAllowance=0.03 makes tabs ~0.03mm narrower and slots ~0.03mm wider than
   * nominal, for ~0.06mm total side-to-side clearance.
   */
  fitAllowance?: number;
}

function sanitizeNonNegative(value: number | undefined, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}

export function computeBoxJointMetrics(thickness: number, kerf = 0, fitAllowance = 0): BoxJointMetrics {
  const t = sanitizeNonNegative(thickness);
  const k = sanitizeNonNegative(kerf);
  const allowance = sanitizeNonNegative(fitAllowance);
  const k2 = k / 2;
  const drawnTabDepth = t + k2;
  const drawnSlotDepth = Math.max(0.1, t - k2);

  return {
    kerf: k,
    fitAllowance: allowance,
    widthCompensation: k - allowance,
    drawnTabDepth,
    drawnSlotDepth,
    physicalTabDepth: drawnTabDepth - k2,
    physicalSlotDepth: drawnSlotDepth + k2,
    physicalTabWidthDelta: -allowance,
    physicalSlotWidthDelta: allowance,
    expectedWidthClearance: allowance * 2,
  };
}

/**
 * Convert interior cavity dimensions to exterior bounding-box dimensions for
 * our finger-joint convention.
 *
 * Convention (see tests/box-geometry.test.ts — Bottom.bottom finger x-positions
 * match Front.bottom slot x-positions, so Bottom and Front share `width`): each
 * face's outer rectangle aligns with the box exterior on its axis; walls sit
 * flush with floor outer edges.
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
  const {
    width,
    height,
    depth,
    thickness: t,
    fingerWidth: fw,
    openTop,
    kerf = 0,
    fitAllowance = 0,
  } = params;
  const spacing = t * 2 + 5;
  const sidewallTop: EdgeMode = openTop ? 'flat' : 'slot';
  const row2Y = height + spacing + t;
  const row3Y = row2Y + height + spacing + t;

  const faces: BoxFace[] = [
    {
      name: 'Front',
      points: generateRectWithFingers(width, height, t, fw, sidewallTop, 'slot', 'finger', 'finger', kerf, fitAllowance),
      offsetX: t,
      offsetY: t,
    },
    {
      name: 'Back',
      points: generateRectWithFingers(width, height, t, fw, sidewallTop, 'slot', 'finger', 'finger', kerf, fitAllowance),
      offsetX: width + spacing + t,
      offsetY: t,
    },
    {
      name: 'Left',
      points: generateRectWithFingers(depth, height, t, fw, sidewallTop, 'slot', 'slot', 'slot', kerf, fitAllowance),
      offsetX: t,
      offsetY: row2Y,
    },
    {
      name: 'Right',
      points: generateRectWithFingers(depth, height, t, fw, sidewallTop, 'slot', 'slot', 'slot', kerf, fitAllowance),
      offsetX: depth + spacing + t,
      offsetY: row2Y,
    },
    {
      name: 'Bottom',
      points: generateRectWithFingers(width, depth, t, fw, 'finger', 'finger', 'finger', 'finger', kerf, fitAllowance),
      offsetX: t,
      offsetY: row3Y,
    },
  ];

  if (!openTop) {
    faces.push({
      name: 'Top',
      points: generateRectWithFingers(width, depth, t, fw, 'finger', 'finger', 'finger', 'finger', kerf, fitAllowance),
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
 * (straight). 'finger' and 'slot' both partition the edge into the same `count`
 * segments and act on the same `i%2===0` positions, so they naturally interlock
 * when paired on the same shared edge.
 *
 * Outward normals (for finger direction):
 *   top:    -y  (finger pushes up, slot cuts down)
 *   right:  +x  (finger pushes right, slot cuts left)
 *   bottom: +y  (finger pushes down, slot cuts up)
 *   left:   -x  (finger pushes left, slot cuts right)
 *
 * Width kerf/fit compensation:
 *   - Tabs are widened by (kerf - fitAllowance) before cutting.
 *   - Slots are narrowed by (kerf - fitAllowance) before cutting.
 *   After the laser removes kerf, tabs become nominal-fitAllowance and slots
 *   become nominal+fitAllowance.
 *
 * Depth kerf compensation:
 *   - Outward tab depth is drawn as thickness + kerf/2.
 *   - Inward slot depth is drawn as thickness - kerf/2.
 *   After the laser removes/adds half-kerf at the far edge, both physical depths
 *   land on material thickness. This fixes the common "fingers are too short"
 *   failure seen when drawn depth equals material thickness.
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
  fitAllowance: number = 0,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];

  const countW = Math.max(1, Math.round(w / fw)) | 1;
  const countH = Math.max(1, Math.round(h / fw)) | 1;
  const segW = w / countW;
  const segH = h / countH;
  const metrics = computeBoxJointMetrics(t, kerf, fitAllowance);
  const tabDepth = metrics.drawnTabDepth;
  const slotDepth = metrics.drawnSlotDepth;

  function computeBoundaries(count: number, seg: number, mode: EdgeMode): number[] {
    const total = count * seg;
    const maxHalfShift = seg * 0.45;
    const halfComp = Math.max(-maxHalfShift, Math.min(maxHalfShift, metrics.widthCompensation / 2));
    const b: number[] = [];
    for (let i = 0; i <= count; i++) {
      if (i === 0) {
        b.push(0);
      } else if (i === count) {
        b.push(total);
      } else if (mode === 'flat') {
        b.push(i * seg);
      } else if (mode === 'finger') {
        b.push(i * seg + (i % 2 === 1 ? +halfComp : -halfComp));
      } else {
        b.push(i * seg + (i % 2 === 1 ? -halfComp : +halfComp));
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
      points.push({ x: x1, y: 0 }, { x: x1, y: -tabDepth }, { x: x2, y: -tabDepth }, { x: x2, y: 0 });
    } else if (topMode === 'slot' && i % 2 === 0) {
      points.push({ x: x1, y: 0 }, { x: x1, y: slotDepth }, { x: x2, y: slotDepth }, { x: x2, y: 0 });
    } else {
      points.push({ x: x1, y: 0 }, { x: x2, y: 0 });
    }
  }

  for (let i = 0; i < countH; i++) {
    const y1 = rightBounds[i]!;
    const y2 = rightBounds[i + 1]!;
    if (rightMode === 'finger' && i % 2 === 0) {
      points.push({ x: w, y: y1 }, { x: w + tabDepth, y: y1 }, { x: w + tabDepth, y: y2 }, { x: w, y: y2 });
    } else if (rightMode === 'slot' && i % 2 === 0) {
      points.push({ x: w, y: y1 }, { x: w - slotDepth, y: y1 }, { x: w - slotDepth, y: y2 }, { x: w, y: y2 });
    } else {
      points.push({ x: w, y: y1 }, { x: w, y: y2 });
    }
  }

  for (let i = countW - 1; i >= 0; i--) {
    const x1 = bottomBounds[i]!;
    const x2 = bottomBounds[i + 1]!;
    if (bottomMode === 'finger' && i % 2 === 0) {
      points.push({ x: x2, y: h }, { x: x2, y: h + tabDepth }, { x: x1, y: h + tabDepth }, { x: x1, y: h });
    } else if (bottomMode === 'slot' && i % 2 === 0) {
      points.push({ x: x2, y: h }, { x: x2, y: h - slotDepth }, { x: x1, y: h - slotDepth }, { x: x1, y: h });
    } else {
      points.push({ x: x2, y: h }, { x: x1, y: h });
    }
  }

  for (let i = countH - 1; i >= 0; i--) {
    const y1 = leftBounds[i]!;
    const y2 = leftBounds[i + 1]!;
    if (leftMode === 'finger' && i % 2 === 0) {
      points.push({ x: 0, y: y2 }, { x: -tabDepth, y: y2 }, { x: -tabDepth, y: y1 }, { x: 0, y: y1 });
    } else if (leftMode === 'slot' && i % 2 === 0) {
      points.push({ x: 0, y: y2 }, { x: slotDepth, y: y2 }, { x: slotDepth, y: y1 }, { x: 0, y: y1 });
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
