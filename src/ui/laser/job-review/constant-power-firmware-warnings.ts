// ADR-257 Amendment 1: Job Review sharpens the constant-power (M3) advice with
// the connected controller's own version, from the `$I` it reported in this
// controller session (the M7 readiness check reads the same evidence). The
// general advice can only say "if the controller runs GRBL 1.1f or newer";
// with a reported version it can say which side of that line this machine is.
// GRBL's changelog adds M4 dynamic power in 1.1e and first allows it on builds
// that drive enable from the spindle-direction pin in 1.1f; LightBurn's GRBL
// guide draws its line at 1.1f, and this follows LightBurn.

import type { Job } from '../../../core/job';
import { resolveGrblDialect } from '../../../core/devices';
import type { Project } from '../../../core/scene';
import type { LaserModeStartSnapshot } from '../../state/laser-mode-start-evidence';
import { constantPowerWarnings } from '../constant-power-warnings';

const FIRST_DYNAMIC_POWER_VERSION = '1.1f';

export function detectConstantPowerFirmwareWarnings(args: {
  readonly prepared: { readonly prepared: { readonly job: Job } };
  readonly project: Project;
  readonly laserModeStartSnapshot: Pick<
    LaserModeStartSnapshot,
    'controllerSessionEpoch' | 'controllerBuildInfo' | 'buildInfoObservation'
  >;
}): ReadonlyArray<string> {
  const snapshot = args.laserModeStartSnapshot;
  const build = snapshot.controllerBuildInfo;
  if (build === null) return [];
  if (snapshot.buildInfoObservation?.sessionEpoch !== snapshot.controllerSessionEpoch) return [];
  if (constantPowerWarnings(args.prepared.prepared.job, args.project).length === 0) return [];
  const version = `GRBL ${build.protocolVersion}`;
  // `$I` parses only as `1.1` plus one letter (build-info.ts), so the letters
  // order the versions.
  if (build.protocolVersion < FIRST_DYNAMIC_POWER_VERSION) {
    return [
      `The connected controller reports ${version}. LightBurn keeps GRBL 1.1e and older on constant power (its GRBL-M3 device), so keep constant power here and lower the speed, or update the controller to GRBL 1.1f or newer.`,
    ];
  }
  const remedy =
    resolveGrblDialect(args.project.device).id === 'grbl-compatible'
      ? 'choose GRBL Dynamic in Machine Setup'
      : "set the Line operations' Power mode to Dynamic (M4)";
  return [
    `The connected controller reports ${version}, which supports dynamic power (M4), LightBurn's default for GRBL 1.1f and newer. To stop the constant-power over-burn, ${remedy}.`,
  ];
}
