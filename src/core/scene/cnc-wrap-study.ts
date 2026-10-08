/** Offline planning intent. It never enables rotary machine output or modifies ordinary jobs. */
export type CncWrapStudy = {
  readonly capabilityId: 'grblhal-degrees-g93-reference-v1';
  readonly radiusMm: number;
  readonly circumferentialAxis: 'x' | 'y';
  readonly rotaryAxis: 'A';
  readonly direction: 1 | -1;
  readonly seamMm: number;
  readonly rotaryDatumDeg: number;
  readonly axialDatumMm: number;
  readonly radialClearanceMm: number;
};
export const DEFAULT_CNC_WRAP_STUDY: CncWrapStudy = {
  capabilityId: 'grblhal-degrees-g93-reference-v1',
  radiusMm: 25,
  circumferentialAxis: 'y',
  rotaryAxis: 'A',
  direction: 1,
  seamMm: 0,
  rotaryDatumDeg: 0,
  axialDatumMm: 0,
  radialClearanceMm: 5,
};
