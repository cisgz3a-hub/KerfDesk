import type { ControllerSettingsSnapshot as GrblControllerSettingsSnapshot } from '../controllers/grbl';
import type { Project } from '../scene';

export type ControllerSettingsSnapshot = GrblControllerSettingsSnapshot;

export type ControllerReadinessErrorCode =
  | 'controller-settings-unknown'
  | 'max-power-unknown'
  | 'max-power-mismatch'
  | 'laser-mode-unknown'
  | 'laser-mode-disabled';

export type ControllerReadinessWarningCode = 'min-power-nonzero';

export type ControllerReadinessMessage<Code extends string> = {
  readonly code: Code;
  readonly message: string;
};

export type ControllerReadinessResult = {
  readonly ok: boolean;
  readonly errors: ReadonlyArray<ControllerReadinessMessage<ControllerReadinessErrorCode>>;
  readonly warnings: ReadonlyArray<ControllerReadinessMessage<ControllerReadinessWarningCode>>;
};

export function runControllerReadiness(
  project: Project,
  controller: ControllerSettingsSnapshot | null,
): ControllerReadinessResult {
  const errors: Array<ControllerReadinessMessage<ControllerReadinessErrorCode>> = [];
  const warnings: Array<ControllerReadinessMessage<ControllerReadinessWarningCode>> = [];

  if (controller === null) {
    errors.push({
      code: 'controller-settings-unknown',
      message:
        'Controller settings are not confirmed yet. Connect to the laser and wait for $$ detection before starting.',
    });
    return { ok: false, errors, warnings };
  }

  if (controller.maxPowerS === undefined) {
    errors.push({
      code: 'max-power-unknown',
      message:
        'Controller did not report GRBL $30 max S. LaserForge cannot prove that power percentages map safely.',
    });
  } else if (controller.maxPowerS !== project.device.maxPowerS) {
    errors.push({
      code: 'max-power-mismatch',
      message: `Controller $30 is ${controller.maxPowerS} but this project is set to max S ${project.device.maxPowerS}. Apply the detected setting before starting.`,
    });
  }

  if (controller.laserModeEnabled === undefined) {
    errors.push({
      code: 'laser-mode-unknown',
      message:
        'Controller did not report GRBL $32 laser mode. LaserForge cannot prove safe laser-mode behavior.',
    });
  } else if (!controller.laserModeEnabled) {
    errors.push({
      code: 'laser-mode-disabled',
      message:
        'Controller reports $32=0. Enable GRBL laser mode ($32=1) before starting from LaserForge.',
    });
  }

  if (controller.minPowerS !== undefined && controller.minPowerS > 0) {
    warnings.push({
      code: 'min-power-nonzero',
      message: `Controller $31 minimum S is ${controller.minPowerS}. Low nonzero power values may burn hotter than expected.`,
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}
