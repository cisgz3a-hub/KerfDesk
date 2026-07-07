import type { ControllerSettingsSnapshot as GrblControllerSettingsSnapshot } from '../controllers/grbl';
import type { Project } from '../scene';

export type ControllerSettingsSnapshot = GrblControllerSettingsSnapshot;

export type ControllerReadinessErrorCode =
  | 'controller-settings-unknown'
  | 'max-power-unknown'
  | 'max-power-mismatch'
  | 'laser-mode-unknown'
  | 'laser-mode-disabled'
  // CNC/router counterparts: a spindle machine must have $32=0 (laser mode
  // zeroes spindle output during G0 rapids, so plunges start with a bit not
  // at speed) and $30 equal to the machine's spindle max RPM, not the laser
  // S scale.
  | 'laser-mode-enabled'
  | 'spindle-scale-mismatch';

export type ControllerReadinessWarningCode =
  | 'min-power-nonzero'
  | 'power-scale-unverified'
  | 'laser-mode-unverified';

/** How the connected firmware exposes settings — mirrors
 *  ControllerCapabilities['settings'] without importing the driver layer. */
export type ReadinessSettingsCapability = 'grbl-dollar' | 'readonly-dump' | 'none';

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
  settingsCapability: ReadinessSettingsCapability = 'grbl-dollar',
): ControllerReadinessResult {
  const errors: Array<ControllerReadinessMessage<ControllerReadinessErrorCode>> = [];
  const warnings: Array<ControllerReadinessMessage<ControllerReadinessWarningCode>> = [];

  // Firmwares with NO numeric $-settings dump at all (Marlin, Smoothie)
  // cannot prove $30/$32 agreement. The power scale then rests on the device
  // profile alone — allowed, but stated plainly (Phase H honesty rule,
  // ADR-095). Firmwares with a READ-ONLY dump (FluidNC) fall through to the
  // verification below: what they report is checked (audit F6).
  if (settingsCapability === 'none') {
    const cncMachine =
      project.machine !== undefined && project.machine.kind === 'cnc' ? project.machine : null;
    warnings.push({
      code: 'power-scale-unverified',
      message:
        cncMachine === null
          ? `This controller does not report GRBL $-settings, so the S power scale (max S ${project.device.maxPowerS}) comes from the device profile and is NOT verified against the firmware. Confirm it before burning at high power.`
          : `This controller does not report GRBL $-settings, so the spindle S scale (max RPM ${cncMachine.params.spindleMaxRpm}) comes from the machine profile and is NOT verified against the firmware. Confirm it before cutting.`,
    });
    return { ok: true, errors, warnings };
  }

  if (controller === null) {
    errors.push({
      code: 'controller-settings-unknown',
      message:
        'Controller settings are not confirmed yet. Connect to the laser and wait for $$ detection before starting.',
    });
    return { ok: false, errors, warnings };
  }

  // A read-only compat dump (FluidNC's legacy $$ emulation) is not
  // guaranteed to include every setting and cannot be fixed from the app,
  // so ABSENT values downgrade to warnings instead of blocking Start.
  // Values that WERE reported are still verified strictly — a mismatch or
  // a provably wrong $32 blocks either way. grbl-dollar keeps absent =
  // error: a real GRBL $$ always reports $30/$31/$32.
  const absentPolicy: AbsentSettingPolicy =
    settingsCapability === 'readonly-dump' ? 'warn' : 'error';

  // Spindle/router machines invert the laser rules: $32 must be OFF and $30
  // is the spindle's max RPM, not the laser S scale (F-CNC provenance header:
  // "; assumes: ... $32=0 (router mode)").
  const machine = project.machine;
  if (machine !== undefined && machine.kind === 'cnc') {
    return cncReadiness(machine.params.spindleMaxRpm, controller, absentPolicy);
  }
  return laserReadiness(project, controller, absentPolicy);
}

type ReadinessErrors = Array<ControllerReadinessMessage<ControllerReadinessErrorCode>>;
type ReadinessWarnings = Array<ControllerReadinessMessage<ControllerReadinessWarningCode>>;

// What to do when the dump did not report a setting: 'error' blocks Start
// (grbl-dollar — a real $$ always reports these), 'warn' states the gap and
// proceeds (readonly-dump — a compat dump may be incomplete; audit F6).
type AbsentSettingPolicy = 'error' | 'warn';

function cncReadiness(
  spindleMaxRpm: number,
  controller: ControllerSettingsSnapshot,
  absentPolicy: AbsentSettingPolicy,
): ControllerReadinessResult {
  const errors: ReadinessErrors = [];
  const warnings: ReadinessWarnings = [];
  if (controller.maxPowerS === undefined) {
    if (absentPolicy === 'error') {
      errors.push({
        code: 'max-power-unknown',
        message:
          'Controller did not report GRBL $30. KerfDesk cannot prove S values map to spindle RPM.',
      });
    } else {
      warnings.push({
        code: 'power-scale-unverified',
        message: `The controller's settings dump did not include $30, so the spindle S scale (max RPM ${spindleMaxRpm}) comes from the machine profile and is NOT verified against the firmware. Confirm it before cutting.`,
      });
    }
  } else if (controller.maxPowerS !== spindleMaxRpm) {
    errors.push({
      code: 'spindle-scale-mismatch',
      message: `Controller $30 is ${controller.maxPowerS} but this machine's spindle max RPM is ${spindleMaxRpm}. Set $30=${spindleMaxRpm} (or update the machine profile) so S values map to real RPM.`,
    });
  }
  if (controller.laserModeEnabled === undefined) {
    if (absentPolicy === 'error') {
      errors.push({
        code: 'laser-mode-unknown',
        message:
          'Controller did not report GRBL $32. KerfDesk cannot prove the controller is in router mode.',
      });
    } else {
      warnings.push({
        code: 'laser-mode-unverified',
        message:
          "The controller's settings dump did not include $32, so router mode ($32=0) is NOT verified against the firmware. Confirm it before cutting.",
      });
    }
  } else if (controller.laserModeEnabled) {
    errors.push({
      code: 'laser-mode-enabled',
      message:
        'Controller reports $32=1 (laser mode). Set $32=0 for spindle work: laser mode cuts spindle power to zero during rapids, so plunges would start with the bit not at speed.',
    });
  }
  return { ok: errors.length === 0, errors, warnings };
}

function laserReadiness(
  project: Project,
  controller: ControllerSettingsSnapshot,
  absentPolicy: AbsentSettingPolicy,
): ControllerReadinessResult {
  const errors: ReadinessErrors = [];
  const warnings: ReadinessWarnings = [];
  if (controller.maxPowerS === undefined) {
    if (absentPolicy === 'error') {
      errors.push({
        code: 'max-power-unknown',
        message:
          'Controller did not report GRBL $30 max S. KerfDesk cannot prove that power percentages map safely.',
      });
    } else {
      warnings.push({
        code: 'power-scale-unverified',
        message: `The controller's settings dump did not include $30, so the S power scale (max S ${project.device.maxPowerS}) comes from the device profile and is NOT verified against the firmware. Confirm it before burning at high power.`,
      });
    }
  } else if (controller.maxPowerS !== project.device.maxPowerS) {
    errors.push({
      code: 'max-power-mismatch',
      message: `Controller $30 is ${controller.maxPowerS} but this project is set to max S ${project.device.maxPowerS}. Apply the detected setting before starting.`,
    });
  }

  if (controller.laserModeEnabled === undefined) {
    if (absentPolicy === 'error') {
      errors.push({
        code: 'laser-mode-unknown',
        message:
          'Controller did not report GRBL $32 laser mode. KerfDesk cannot prove safe laser-mode behavior.',
      });
    } else {
      warnings.push({
        code: 'laser-mode-unverified',
        message:
          "The controller's settings dump did not include $32, so laser mode is NOT verified against the firmware. Confirm $32=1 in the controller's configuration before burning.",
      });
    }
  } else if (!controller.laserModeEnabled) {
    errors.push({
      code: 'laser-mode-disabled',
      message:
        'Controller reports $32=0. Enable GRBL laser mode ($32=1) before starting from KerfDesk.',
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
