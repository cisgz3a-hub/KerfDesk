import type { JointFeatureKind, JointInterval, JointPattern, BoxJointMetricsV2 } from './joineryTypes';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitize(value: number | undefined, fallback: number, min = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, value) : fallback;
}

export function computeBoxJointMetricsV2(
  thickness: number,
  kerf = 0.1,
  fitAllowance = 0.05,
  tabExtraDepth = 0.2,
  slotExtraDepth = 0.35,
  cornerRelief: 'none' | 'micro-overcut' = 'micro-overcut',
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
  const reliefDepth = cornerRelief === 'micro-overcut' ? Math.max(0.05, Math.min(0.25, burnRadius || 0.08)) : 0;

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
    expectedWidthClearance: fit * 2,
    depthOvertravel: physicalSlotDepth - physicalTabDepth,
  };
}

export function createJointPattern(id: string, length: number, preferredFingerWidth: number, parity: 0 | 1 = 0): JointPattern {
  const safeLength = sanitize(length, 1, 1);
  const safeFinger = sanitize(preferredFingerWidth, Math.max(3, safeLength / 7), 1);
  const segmentCount = Math.max(3, Math.round(safeLength / safeFinger)) | 1;
  const nominalSegmentWidth = safeLength / segmentCount;
  const intervals: JointInterval[] = [];

  for (let i = 0; i < segmentCount; i++) {
    intervals.push({
      index: i,
      nominalStart: i * nominalSegmentWidth,
      nominalEnd: (i + 1) * nominalSegmentWidth,
      primaryKind: i % 2 === parity ? 'tab' : 'socket',
    });
  }

  return { id, length: safeLength, nominalSegmentWidth, segmentCount, parity, intervals };
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
  if (kind === 'flat') {
    const drawnWidth = interval.nominalEnd - interval.nominalStart;
    return { start: interval.nominalStart, end: interval.nominalEnd, drawnWidth, expectedPhysicalWidth: drawnWidth };
  }

  const nominalWidth = interval.nominalEnd - interval.nominalStart;
  // Draw tabs larger and sockets smaller; after the beam removes/adds full kerf
  // across the width, tabs become nominal-fit and sockets nominal+fit.
  const widthDelta = kind === 'tab'
    ? metrics.kerf - metrics.fitAllowance
    : -(metrics.kerf - metrics.fitAllowance);
  const half = widthDelta / 2;
  const start = clamp(interval.nominalStart - half, 0, patternLength);
  const end = clamp(interval.nominalEnd + half, 0, patternLength);
  const drawnWidth = Math.max(0, end - start);
  const expectedPhysicalWidth = kind === 'tab'
    ? Math.max(0, drawnWidth - metrics.kerf)
    : drawnWidth + metrics.kerf;

  // End intervals are clamped at the panel corner, so their exact physical width
  // can be half-compensated. Internal intervals carry the strong contract.
  return { start, end, drawnWidth, expectedPhysicalWidth: kind === 'tab' ? nominalWidth - metrics.fitAllowance : nominalWidth + metrics.fitAllowance };
}
