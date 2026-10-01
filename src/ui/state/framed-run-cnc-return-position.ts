import type { FramedRunControllerSnapshot } from './framed-run';

const FLOAT32_UNIT_ROUNDOFF = 2 ** -24;
// Stock GRBL uses this literal rather than an exact reciprocal of 25.4.
const GRBL_INCH_SCALE_BIAS = Math.abs(Math.fround(0.0393701) * 25.4 - 1);

/** Compare only the CNC Frame's deliberately changed Z against its dispatched
 * target. The planner rounds targets to whole steps; status formatting rounds
 * again. This allowance never applies to XY or a later Start's actual snapshot.
 * https://github.com/gnea/grbl/blob/master/grbl/planner.c
 * https://github.com/gnea/grbl/blob/master/grbl/print.c */
export function matchesCncFrameReturnWorkZ(
  snapshot: FramedRunControllerSnapshot,
  targetMm: number,
  machineOnly = false,
): boolean {
  if (!Number.isFinite(targetMm)) return false;
  const stepMm = observedZStepMm(snapshot);
  // Without current Z resolution the dispatched, settled Frame remains the
  // authority. Do not invent a setting or add a missing-setting policy gate.
  // Its actual completed Z is retained in the permit and checked at Start.
  if (stepMm === null) return true;
  const scale = snapshot.controllerSettings?.reportInches === true ? 25.4 : 1;
  const coordinate = returnZCoordinate(snapshot, scale, machineOnly);
  if (coordinate === null) return false;
  const offsetMm = (snapshot.wcoCache?.z ?? 0) * scale;
  // Cover float32 command conversion, offset arithmetic and whole-step
  // conversion separately from the formatter's error budget.
  const commandArithmetic = float32ErrorBound(Math.abs(targetMm) + Math.abs(offsetMm), 8);
  const doubleArithmetic =
    Number.EPSILON *
    Math.max(1, Math.abs(targetMm), Math.abs(coordinate.zMm), Math.abs(offsetMm)) *
    8;
  return (
    Math.abs(coordinate.zMm - targetMm) <=
    stepMm / 2 + coordinate.reportErrorMm + commandArithmetic + doubleArithmetic
  );
}

function observedZStepMm(snapshot: FramedRunControllerSnapshot): number | null {
  if (snapshot.controllerSettingsObservation?.sessionEpoch !== snapshot.controllerSessionEpoch) {
    return null;
  }
  const steps = snapshot.controllerSettings?.stepsPerMmZ;
  return steps !== undefined && Number.isFinite(steps) && steps > 0 ? 1 / steps : null;
}

function returnZCoordinate(
  snapshot: FramedRunControllerSnapshot,
  scale: number,
  machineOnly: boolean,
): { readonly zMm: number; readonly reportErrorMm: number } | null {
  const report = snapshot.statusReport;
  if (report === null) return null;
  const offsetMm = (snapshot.wcoCache?.z ?? 0) * scale;
  if (!machineOnly && report.wPos !== null) {
    const zMm = report.wPos.z * scale;
    return { zMm, reportErrorMm: coordinateReportError(zMm, scale) };
  }
  if (report.mPos === null) return null;
  const machineMm = report.mPos.z * scale;
  return {
    zMm: machineMm - offsetMm,
    // Separately rounded MPos/WCO can legitimately differ by one full tick.
    // That interval cannot distinguish every small movement from rounding.
    reportErrorMm:
      coordinateReportError(machineMm, scale) +
      (snapshot.wcoCache === null ? 0 : coordinateReportError(offsetMm, scale)),
  };
}

function coordinateReportError(coordinateMm: number, scale: number): number {
  const inches = scale !== 1;
  const halfTickMm = inches ? 0.00005 * scale : 0.0005;
  const conversionBias = inches ? Math.abs(coordinateMm) * GRBL_INCH_SCALE_BIAS : 0;
  // printFloat scales twice and adds its rounding factor; inch reports also
  // convert using a float32 constant. These are precision bounds, not defaults.
  return halfTickMm + float32ErrorBound(coordinateMm, inches ? 5 : 3) + conversionBias;
}

function float32ErrorBound(value: number, operations: number): number {
  const gamma = (operations * FLOAT32_UNIT_ROUNDOFF) / (1 - operations * FLOAT32_UNIT_ROUNDOFF);
  return (Math.abs(value) * gamma) / (1 - gamma);
}
