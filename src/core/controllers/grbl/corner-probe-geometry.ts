import type { CncToolKind } from '../../scene/machine';

export const CORNER_PROBE_EXTERNAL_MARGIN_MM = 1;
export const DEFAULT_FINAL_PARK_MM = 5;
export const DEFAULT_PLATE_CENTER_OFFSET_X_MM = 15;
export const DEFAULT_PLATE_CENTER_OFFSET_Y_MM = 15;
export const MIN_FLANK_HEIGHT_MM = 1;
export const MAX_CORNER_PROBE_DIMENSION_MM = 100;
export const PROBE_GCODE_RESOLUTION_MM = 0.001;
export const FLOAT_TOLERANCE_MM = 1e-9;

export type CornerProbeGeometryInput = {
  readonly plateThicknessMm: number;
  readonly bitDiameterMm: number;
  readonly toolKind: CncToolKind;
  readonly plateCenterOffsetXmm: number;
  readonly plateCenterOffsetYmm: number;
  readonly sideDropMm: number;
  readonly sideClearanceMm: number;
};

export type CornerProbeGeometryResult =
  | { readonly kind: 'valid'; readonly flankHeightMm: number; readonly finalParkMm: number }
  | { readonly kind: 'invalid'; readonly reason: string };

/** Proves the static cutter/plate clearances used by an XYZ corner cycle. */
export function validateCornerProbeGeometry(
  params: CornerProbeGeometryInput,
): CornerProbeGeometryResult {
  const values = [
    params.plateThicknessMm,
    params.bitDiameterMm,
    params.plateCenterOffsetXmm,
    params.plateCenterOffsetYmm,
    params.sideDropMm,
    params.sideClearanceMm,
  ];
  if (!values.every((value) => Number.isFinite(value) && value > 0)) {
    return invalid('Corner-probe dimensions must be finite positive numbers.');
  }
  if (values.some((value) => value > MAX_CORNER_PROBE_DIMENSION_MM)) {
    return invalid(`Corner-probe dimensions cannot exceed ${MAX_CORNER_PROBE_DIMENSION_MM} mm.`);
  }
  if (!values.every(hasGcodePrecision)) {
    return invalid('Corner-probe dimensions support at most 0.001 mm precision.');
  }
  if (params.toolKind !== 'end-mill') {
    return invalid('XYZ corner probing requires a cylindrical end mill with a straight flank.');
  }
  const radiusMm = params.bitDiameterMm / 2;
  if (!hasGcodePrecision(radiusMm)) {
    return invalid('Bit diameter must use 0.002 mm increments so its radius is representable.');
  }
  const measuredFlankHeightMm = params.plateThicknessMm - params.sideDropMm;
  if (measuredFlankHeightMm + FLOAT_TOLERANCE_MM < MIN_FLANK_HEIGHT_MM) {
    return invalid(
      `Side probe drop leaves ${formatMm(measuredFlankHeightMm)} mm above the stock; at least ${MIN_FLANK_HEIGHT_MM} mm is required.`,
    );
  }
  const flankHeightMm = Math.max(MIN_FLANK_HEIGHT_MM, measuredFlankHeightMm);
  const minimumCenterOffsetMm = radiusMm + CORNER_PROBE_EXTERNAL_MARGIN_MM;
  if (
    params.plateCenterOffsetXmm < minimumCenterOffsetMm ||
    params.plateCenterOffsetYmm < minimumCenterOffsetMm
  ) {
    return invalid(
      `Both plate center offsets must be at least ${formatMm(minimumCenterOffsetMm)} mm for this cutter.`,
    );
  }
  const minimumSideClearanceMm =
    Math.max(params.plateCenterOffsetXmm, params.plateCenterOffsetYmm) +
    radiusMm +
    CORNER_PROBE_EXTERNAL_MARGIN_MM;
  if (params.sideClearanceMm < minimumSideClearanceMm) {
    return invalid(
      `Side clearance must be at least ${formatMm(minimumSideClearanceMm)} mm for this plate position and cutter.`,
    );
  }
  return {
    kind: 'valid',
    flankHeightMm,
    finalParkMm: Math.max(DEFAULT_FINAL_PARK_MM, ceilToGcodeResolution(minimumCenterOffsetMm)),
  };
}

function invalid(reason: string): CornerProbeGeometryResult {
  return { kind: 'invalid', reason };
}

function formatMm(value: number): string {
  return value.toFixed(3);
}

function hasGcodePrecision(value: number): boolean {
  const resolutionUnits = value / PROBE_GCODE_RESOLUTION_MM;
  return Math.abs(resolutionUnits - Math.round(resolutionUnits)) < FLOAT_TOLERANCE_MM;
}

function ceilToGcodeResolution(value: number): number {
  return Math.ceil(value / PROBE_GCODE_RESOLUTION_MM) * PROBE_GCODE_RESOLUTION_MM;
}
