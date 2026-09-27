// One colour scale for a calibration ring's error on the bed, shared by the
// wizard's result map and the workspace accuracy map (ADR-441).

export const GOOD_RING_MM = 0.25;
export const FAIR_RING_MM = 0.6;

export function ringErrorColour(errorMm: number): string {
  if (errorMm <= GOOD_RING_MM) return 'var(--lf-success-fg)';
  if (errorMm <= FAIR_RING_MM) return 'var(--lf-warning-fg)';
  return 'var(--lf-danger-fg)';
}

export const REJECTED_RING_COLOUR = 'var(--lf-danger-fg)';
