// Number hygiene shared by the array layouts: malformed direct-call input
// never produces a non-finite placement.

export function positiveCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

export function finiteNonNegative(value: number): number {
  return Math.max(0, finite(value));
}

export function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function span(min: number, max: number): number {
  return Math.max(0, finite(max) - finite(min));
}

export function normalizeDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

/** Exact at the quarter turns, so a copy at 90° lands exactly below the centre. */
export function unitVectorForDegrees(value: number): { readonly x: number; readonly y: number } {
  const normalized = normalizeDegrees(value);
  switch (normalized) {
    case 0:
      return { x: 1, y: 0 };
    case 90:
      return { x: 0, y: 1 };
    case 180:
      return { x: -1, y: 0 };
    case 270:
      return { x: 0, y: -1 };
    default: {
      const radians = (normalized * Math.PI) / 180;
      return { x: Math.cos(radians), y: Math.sin(radians) };
    }
  }
}
