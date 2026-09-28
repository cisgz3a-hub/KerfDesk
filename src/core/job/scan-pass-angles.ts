// The angle every pass of a scanned operation runs at (ADR-492).
//
// An Image operation scans at its scan angle; with Cross-hatch on, each pass
// scans again at the scan angle plus 90 degrees. A Fill's cross-hatch already
// lives inside its hatch pattern, so only the per-pass step applies to it.
// With an angle change per pass, pass k runs at the base angle plus k steps.
//
// Runs of passes at the same angle are merged into one entry, so an operation
// without a step or cross-hatch keeps exactly one entry with all its passes:
// the single group it always compiled to.

import type { LayerOperationSettings } from '../scene';
import { normalizedScanAngleDeg } from '../raster/raster-scan-frame';

const QUARTER_TURN_DEG = 90;

export type ScanPassRun = {
  /** Angle in [0, 180). */
  readonly angleDeg: number;
  readonly passes: number;
};

type PassSettings = Pick<LayerOperationSettings, 'passes' | 'passAngleStepDeg'>;

export function imageScanPassRuns(
  settings: PassSettings & Pick<LayerOperationSettings, 'imageScanAngleDeg' | 'imageCrossHatch'>,
): ReadonlyArray<ScanPassRun> {
  const crossHatch = settings.imageCrossHatch === true;
  return passRuns(settings, settings.imageScanAngleDeg ?? 0, (angle) =>
    crossHatch ? [angle, angle + QUARTER_TURN_DEG] : [angle],
  );
}

export function fillHatchPassRuns(
  settings: PassSettings & Pick<LayerOperationSettings, 'hatchAngleDeg'>,
): ReadonlyArray<ScanPassRun> {
  return passRuns(settings, settings.hatchAngleDeg, (angle) => [angle]);
}

/**
 * The operation each group of a Fill hatches with: the operation itself, or,
 * with an angle change per pass, one copy per run of passes at one angle.
 * Offset rings have no angle, so an Offset fill keeps its one group.
 */
export function fillPassLayers<
  T extends PassSettings & Pick<LayerOperationSettings, 'hatchAngleDeg' | 'fillStyle'>,
>(layer: T): ReadonlyArray<T> {
  if (layer.fillStyle === 'offset' || !passAngleStepApplies(layer)) return [layer];
  return fillHatchPassRuns(layer).map((run) => ({
    ...layer,
    hatchAngleDeg: run.angleDeg,
    passes: run.passes,
  }));
}

/** Whether passes of this operation run at more than one angle. */
export function passAngleStepApplies(settings: PassSettings): boolean {
  return passCount(settings) > 1 && normalizedScanAngleDeg(settings.passAngleStepDeg) !== 0;
}

function passRuns(
  settings: PassSettings,
  baseDeg: number,
  anglesOfPass: (angleDeg: number) => ReadonlyArray<number>,
): ReadonlyArray<ScanPassRun> {
  const passes = passCount(settings);
  const step = passAngleStepApplies(settings) ? (settings.passAngleStepDeg ?? 0) : 0;
  const perPass = anglesOfPass(baseDeg);
  if (step === 0 && perPass.length === 1) {
    return [{ angleDeg: normalizedScanAngleDeg(baseDeg), passes }];
  }
  const runs: ScanPassRun[] = [];
  for (let pass = 0; pass < passes; pass += 1) {
    for (const angle of anglesOfPass(baseDeg + pass * step)) {
      const angleDeg = normalizedScanAngleDeg(angle);
      const last = runs[runs.length - 1];
      if (last?.angleDeg === angleDeg)
        runs[runs.length - 1] = { angleDeg, passes: last.passes + 1 };
      else runs.push({ angleDeg, passes: 1 });
    }
  }
  return runs;
}

function passCount(settings: PassSettings): number {
  return Math.max(1, Math.floor(settings.passes));
}
