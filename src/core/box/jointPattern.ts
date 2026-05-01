import type { JointFeatureKind, JointInterval, JointPattern, BoxJointMetricsV2 } from './joineryTypes';

const EPS = 0.001;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitize(value: number | undefined, fallback: number, min = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, value) : fallback;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function oddAtLeast(value: number, min = 3): number {
  const rounded = Math.max(min, Math.round(value));
  return rounded % 2 === 1 ? rounded : rounded + 1;
}

function mergeBoundaries(boundaries: number[], length: number): number[] {
  return Array.from(new Set(
    boundaries
      .map(v => round(clamp(v, 0, length)))
      .filter(v => v >= -EPS && v <= length + EPS),
  )).sort((a, b) => a - b);
}

function containsMidpoint(intervals: Array<{ start: number; end: number }>, value: number): boolean {
  return intervals.some(interval => value > interval.start + EPS && value < interval.end - EPS);
}

/**
 * Metrics used by V5.
 *
 * Kerf is the actual cut width. Fit allowance is deliberate looseness in the
 * socket opening. For socket cuts, the drawn opening is reduced by kerf and
 * increased by fit, so after cutting the physical opening is nominal + fit.
 */
export function computeBoxJointMetricsV2(
  thickness: number,
  kerf = 0.1,
  fitAllowance = 0.05,
  tabExtraDepth = 0.2,
  slotExtraDepth = 0.35,
  cornerRelief: 'none' | 'micro-overcut' = 'none',
): BoxJointMetricsV2 {
  const t = sanitize(thickness, 3, 0.1);
  const k = sanitize(kerf, 0.1, 0);
  const fit = sanitize(fitAllowance, 0.05, 0);
  const tabExtra = sanitize(tabExtraDepth, 0.2, 0);
  const slotExtra = sanitize(slotExtraDepth, 0.35, 0);
  const burnRadius = k / 2;

  const physicalTabDepth = t + tabExtra;
  const physicalSlotDepth = t + slotExtra;
  const drawnTabDepth = physicalTabDepth + burnRadius;
  const drawnSlotDepth = Math.max(0.1, physicalSlotDepth - burnRadius);

  // V5 deliberately keeps relief disabled by default. It can be reintroduced
  // after the base topology is proven by real burns.
  const reliefDepth = cornerRelief === 'micro-overcut' ? 0 : 0;

  return {
    kerf: k,
    burnRadius,
    fitAllowance: fit,
    tabExtraDepth: tabExtra,
    slotExtraDepth: slotExtra,
    physicalTabDepth,
    physicalSlotDepth,
    drawnTabDepth,
    drawnSlotDepth,
    drawnSocketDepthWithRelief: drawnSlotDepth + reliefDepth,
    widthCompensation: k - fit,
    expectedWidthClearance: fit,
    depthOvertravel: physicalSlotDepth - physicalTabDepth,
  };
}

/**
 * Create a verified-generator-style direct/inverse cut partition.
 *
 * This mirrors the proven topology used by OpenSCAD-style "cuts/invcuts":
 * - direct edge cuts a centered set of socket intervals
 * - inverse edge cuts the complement intervals
 * - the pattern leaves enough corner margin to prevent joint collisions
 *
 * The returned intervals partition [0, length]. primaryKind === 'socket'
 * means "cut this interval inward on the primary edge".
 */
export function createJointPattern(
  id: string,
  length: number,
  preferredFingerWidth: number,
  thickness = 3,
  parity: 0 | 1 = 0,
): JointPattern {
  const safeLength = sanitize(length, 1, 1);
  const t = sanitize(thickness, 3, 0.1);
  const fw = sanitize(preferredFingerWidth, Math.max(t * 2, 6), Math.max(1, t));

  if (safeLength < t * 3) {
    return {
      id,
      length: safeLength,
      nominalSegmentWidth: safeLength,
      segmentCount: 1,
      parity,
      intervals: [{ index: 0, nominalStart: 0, nominalEnd: safeLength, primaryKind: 'tab' }],
    };
  }

  // Clean-room equivalent of the verified generators' idea:
  // leave material-dependent surrounding space, then distribute an odd number
  // of alternating spans through the active zone.
  const surrounding = Math.min(Math.max(2 * t, t), safeLength * 0.24);
  const activeStart = surrounding;
  const activeEnd = Math.max(activeStart + t, safeLength - surrounding);
  const activeLength = activeEnd - activeStart;

  const spanCount = oddAtLeast(activeLength / fw, 3);
  const span = activeLength / spanCount;
  const directCuts: Array<{ start: number; end: number }> = [];

  for (let i = 0; i < spanCount; i++) {
    if (i % 2 === parity) {
      directCuts.push({
        start: activeStart + i * span,
        end: activeStart + (i + 1) * span,
      });
    }
  }

  const boundaries = mergeBoundaries([
    0,
    safeLength,
    ...directCuts.flatMap(cut => [cut.start, cut.end]),
  ], safeLength);

  const intervals: JointInterval[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const a = boundaries[i]!;
    const b = boundaries[i + 1]!;
    if (b - a <= EPS) continue;
    const mid = (a + b) / 2;
    intervals.push({
      index: intervals.length,
      nominalStart: a,
      nominalEnd: b,
      primaryKind: containsMidpoint(directCuts, mid) ? 'socket' : 'tab',
    });
  }

  return {
    id,
    length: safeLength,
    nominalSegmentWidth: span,
    segmentCount: intervals.length,
    parity,
    intervals,
  };
}

export function featureKindForRole(interval: JointInterval, role: 'primary' | 'secondary' | 'flat'): JointFeatureKind {
  if (role === 'flat') return 'flat';
  if (role === 'primary') return interval.primaryKind;
  return interval.primaryKind === 'tab' ? 'socket' : 'tab';
}

export function compensatedInterval(
  interval: JointInterval,
  kind: JointFeatureKind,
  patternLength: number,
  metrics: BoxJointMetricsV2,
): { start: number; end: number; drawnWidth: number; expectedPhysicalWidth: number } {
  const nominalWidth = interval.nominalEnd - interval.nominalStart;
  if (kind === 'flat' || kind === 'tab') {
    return {
      start: interval.nominalStart,
      end: interval.nominalEnd,
      drawnWidth: nominalWidth,
      expectedPhysicalWidth: nominalWidth,
    };
  }

  // Draw socket smaller by kerf, larger by fit. Physical socket ≈ nominal + fit.
  const drawnSocketWidth = Math.max(0.1, nominalWidth - metrics.kerf + metrics.fitAllowance);
  const shift = (nominalWidth - drawnSocketWidth) / 2;
  const touchesStart = interval.nominalStart <= EPS;
  const touchesEnd = interval.nominalEnd >= patternLength - EPS;
  const start = touchesStart ? 0 : clamp(interval.nominalStart + shift, 0, patternLength);
  const end = touchesEnd ? patternLength : clamp(interval.nominalEnd - shift, 0, patternLength);
  const drawnWidth = Math.max(0, end - start);

  return {
    start,
    end,
    drawnWidth,
    expectedPhysicalWidth: drawnWidth + metrics.kerf,
  };
}
