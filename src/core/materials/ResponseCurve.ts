export interface ResponseCurvePoint {
  /** Commanded power in percent, 0-100. */
  commandedPower: number;
  /** Observed darkness, 0-1 where 0=white/unburnt, 1=black/fully burnt. */
  observedDarkness: number;
}

export interface ResponseCurve {
  /** Unique id (e.g., 'resp_abc123'). */
  id: string;
  /** Material name this curve applies to, matches DeviceProfile usage. */
  materialName: string;
  /** Scan speed this curve was calibrated at, in mm/min. 1D Phase 1 = single speed. */
  calibrationSpeed: number;
  /** Raw grid measurements, sorted by commandedPower ascending. */
  points: ResponseCurvePoint[];
  /** ISO timestamp of calibration. */
  calibratedAt: string;
  /** User-provided note (e.g., "3mm birch ply, 2025-11 batch"). Optional. */
  note?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function interpolate(x: number, x0: number, y0: number, x1: number, y1: number): number {
  if (x1 === x0) return y0;
  const t = (x - x0) / (x1 - x0);
  return y0 + (y1 - y0) * t;
}

/** Invert the curve: given desired darkness [0,1], return commanded power [0,100]. */
export function darknessToPower(curve: ResponseCurve, desiredDarkness: number): number {
  const points = curve.points;
  if (points.length === 0) return 0;
  if (points.length === 1) return points[0].commandedPower;

  const minDarkness = points[0].observedDarkness;
  const maxDarkness = points[points.length - 1].observedDarkness;
  const target = clamp(desiredDarkness, minDarkness, maxDarkness);

  if (target <= minDarkness) return points[0].commandedPower;
  if (target >= maxDarkness) return points[points.length - 1].commandedPower;

  for (let i = 0; i < points.length - 1; i++) {
    const left = points[i];
    const right = points[i + 1];
    if (target >= left.observedDarkness && target <= right.observedDarkness) {
      return interpolate(
        target,
        left.observedDarkness,
        left.commandedPower,
        right.observedDarkness,
        right.commandedPower,
      );
    }
  }

  return points[points.length - 1].commandedPower;
}

/** Forward lookup (for preview UIs): commanded power -> predicted darkness. */
export function powerToDarkness(curve: ResponseCurve, commandedPower: number): number {
  const points = curve.points;
  if (points.length === 0) return 0;
  if (points.length === 1) return points[0].observedDarkness;

  const minPower = points[0].commandedPower;
  const maxPower = points[points.length - 1].commandedPower;
  const target = clamp(commandedPower, minPower, maxPower);

  if (target <= minPower) return points[0].observedDarkness;
  if (target >= maxPower) return points[points.length - 1].observedDarkness;

  for (let i = 0; i < points.length - 1; i++) {
    const left = points[i];
    const right = points[i + 1];
    if (target >= left.commandedPower && target <= right.commandedPower) {
      return interpolate(
        target,
        left.commandedPower,
        left.observedDarkness,
        right.commandedPower,
        right.observedDarkness,
      );
    }
  }

  return points[points.length - 1].observedDarkness;
}

/** Validate a curve is usable: monotonic points, >= 3 points, darkness in [0,1]. */
export function validateCurve(curve: ResponseCurve): { ok: true } | { ok: false; error: string } {
  if (curve.calibrationSpeed <= 0) {
    return { ok: false, error: 'calibrationSpeed must be > 0' };
  }
  if (curve.points.length < 3) {
    return { ok: false, error: 'curve must contain at least 3 points' };
  }

  for (let i = 0; i < curve.points.length; i++) {
    const p = curve.points[i];
    if (p.observedDarkness < 0 || p.observedDarkness > 1) {
      return { ok: false, error: 'observedDarkness must be in [0,1]' };
    }
    if (i > 0) {
      const prev = curve.points[i - 1];
      if (p.commandedPower <= prev.commandedPower) {
        return { ok: false, error: 'commandedPower values must be strictly ascending' };
      }
      if (p.observedDarkness < prev.observedDarkness) {
        return { ok: false, error: 'observedDarkness must be monotonic non-decreasing' };
      }
    }
  }

  return { ok: true };
}
