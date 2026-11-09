import type { ControllerSettingsSnapshot as GrblControllerSettingsSnapshot } from '../controllers/grbl';
import { laserPowerRangeIsEmpty, reportedMaxPowerS } from '../controllers/grbl/parse-settings';
import type { ControllerKind } from '../devices';
import type { Project } from '../scene';
import {
  CNC_LASER_MODE_ENABLED_MESSAGE,
  FLUIDNC_CNC_LASER_MODE_ENABLED_MESSAGE,
  FLUIDNC_RESUME_SPINUP_MESSAGE,
  LASER_MODE_DISABLED_MESSAGE,
  laserMaxPowerMismatchMessage,
  laserModeDisabledMessage,
  laserMinPowerNonzeroMessage,
  laserModeUnverifiedMessage,
  laserPowerRangeEmptyMessage,
  readinessSettingsSource,
  routerLaserModeMessage,
  spindleScaleMismatchMessage,
  type PowerRangeFirmware,
  type ReadinessSettingsSource,
} from './controller-readiness-messages';

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
  // $30 at or below $31: no S value sets power. Stock GRBL then fires full
  // power even at S0 (ADR-567 Amendment 1). A warning, never a refusal.
  | 'power-range-empty'
  | 'power-scale-unverified'
  | 'laser-mode-unverified'
  // grblHAL's $32 is a three-way mode enum, so a lathe reports $32=2. That is
  // operator information, never a refusal (CLAUDE.md rule 7): it goes in the
  // Job Review warnings list like any other controller-setting judgement.
  | 'lathe-mode'
  // FluidNC's Resume waits only the YAML spinup_ms (0 unless set) before the
  // paused line goes on in the cut (ADR-180 Amendment 8). A run-time fact, so
  // it is stated at Start, not on Save/export.
  | 'fluidnc-resume-spinup';

/** How the connected firmware exposes settings — mirrors
 *  ControllerCapabilities['settings'] without importing the driver layer. */
export type ReadinessSettingsCapability =
  | 'grbl-dollar'
  | 'grbl-dollar-read'
  | 'readonly-dump'
  | 'none';

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
  firmwareKind?: ControllerKind,
): ControllerReadinessResult {
  const errors: Array<ControllerReadinessMessage<ControllerReadinessErrorCode>> = [];
  const warnings: Array<ControllerReadinessMessage<ControllerReadinessWarningCode>> = [];
  const cncMachine =
    project.machine !== undefined && project.machine.kind === 'cnc' ? project.machine : null;
  const source = readinessSettingsSource(settingsCapability);

  // Firmwares with NO numeric $-settings dump at all (Marlin, Smoothie)
  // cannot prove $30/$32 agreement. The power scale then rests on the device
  // profile alone — allowed, but stated plainly (Phase H honesty rule,
  // ADR-095). Firmwares with a READ-ONLY dump (FluidNC) fall through to the
  // verification below: what they report is checked (audit F6).
  if (settingsCapability === 'none') {
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
    // An unavailable settings read is not proof that a laser is configured
    // incorrectly. Let the profile assumptions reach Job Review as warnings,
    // matching controllers that expose no settings dump at all. CNC remains
    // strict because unknown $30/$32 changes spindle and plunge semantics.
    if (cncMachine === null) {
      return laserReadiness(project, {}, 'warn', source, firmwareKind);
    }
    errors.push({
      code: 'controller-settings-unknown',
      message:
        'Controller settings are not confirmed yet. Reconnect or retry reading settings before starting CNC output.',
    });
    return { ok: false, errors, warnings };
  }

  // A read-only compat dump (FluidNC's legacy $$ emulation) is not
  // guaranteed to include every setting and cannot be fixed from the app,
  // so ABSENT values downgrade to warnings instead of blocking Start.
  // Values that WERE reported are still verified strictly and returned as
  // errors. Those errors do NOT refuse Start: since #291 the Start path maps
  // them to Job Review warnings (start-job-controller-policy.ts). Since #482
  // they no longer refuse Save/export either — that path states them as
  // advisory toasts (controller-readiness-advisories.ts). grbl-dollar and
  // grbl-dollar-read keep absent = error: a real GRBL $$ always reports
  // $30/$31/$32.
  const absentPolicy: AbsentSettingPolicy =
    settingsCapability === 'readonly-dump' ? 'warn' : 'error';

  // Spindle/router machines invert the laser rules: $32 must be OFF and $30
  // is the spindle's max RPM, not the laser S scale (F-CNC provenance header:
  // "; assumes: ... $32=0 (router mode)").
  if (cncMachine !== null) {
    return cncReadiness(cncMachine.params.spindleMaxRpm, controller, absentPolicy, {
      source,
      fluidnc: source === 'fluidnc-yaml' || firmwareKind === 'fluidnc',
    });
  }
  // Missing laser settings are review warnings; known mismatches are still
  // errors inside laserReadiness. Neither refuses Start — the Start path
  // demotes every error returned here to a Job Review warning (#291), and
  // since #482 the Save/export path states them as advisories rather than
  // refusing, so nothing returned here gates an action on its own.
  return laserReadiness(project, controller, 'warn', source, firmwareKind);
}

type ReadinessErrors = Array<ControllerReadinessMessage<ControllerReadinessErrorCode>>;
type ReadinessWarnings = Array<ControllerReadinessMessage<ControllerReadinessWarningCode>>;

// grblHAL's set_mode() clears G7 diameter mode for Mode_Standard and
// Mode_Laser but NOT for Mode_Lathe, so a lathe-mode controller can still be
// interpreting X as a diameter. It states the fact and never refuses.
const CNC_LATHE_MODE_MESSAGE =
  'Controller reports $32=2 (grblHAL lathe mode), not router mode ($32=0). Laser mode is off, so spindle output is not gated by motion, but lathe mode leaves G7 diameter mode available — X may be interpreted as a diameter. Confirm the controller mode before cutting.';

const LASER_LATHE_MODE_MESSAGE =
  'Controller reports $32=2 (grblHAL lathe mode), so GRBL laser mode is NOT enabled. The beam will not gate with motion the way a laser job expects. Set $32=1 before burning.';

// What to do when the dump did not report a setting: 'error' blocks Start;
// 'warn' states the gap and proceeds through Job Review. Laser uses the
// warning path for missing evidence; CNC uses it only for partial read-only
// compatibility dumps.
type AbsentSettingPolicy = 'error' | 'warn';

function cncReadiness(
  spindleMaxRpm: number,
  controller: ControllerSettingsSnapshot,
  absentPolicy: AbsentSettingPolicy,
  firmware: { readonly source: ReadinessSettingsSource; readonly fluidnc: boolean },
): ControllerReadinessResult {
  const { source } = firmware;
  const errors: ReadinessErrors = [];
  const warnings: ReadinessWarnings = [];
  const reportedMaxS = reportedMaxPowerS(controller);
  if (reportedMaxS === undefined) {
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
  } else if (reportedMaxS !== spindleMaxRpm) {
    errors.push({
      code: 'spindle-scale-mismatch',
      message: spindleScaleMismatchMessage(reportedMaxS, spindleMaxRpm, source),
    });
  }
  if (controller.machineMode?.kind === 'lathe') {
    warnings.push({ code: 'lathe-mode', message: CNC_LATHE_MODE_MESSAGE });
  } else if (controller.laserModeEnabled === undefined) {
    if (absentPolicy === 'error') {
      errors.push({ code: 'laser-mode-unknown', message: CNC_LASER_MODE_UNKNOWN_MESSAGE });
    } else {
      warnings.push({ code: 'laser-mode-unverified', message: CNC_LASER_MODE_UNVERIFIED_MESSAGE });
    }
  } else if (controller.laserModeEnabled) {
    errors.push({ code: 'laser-mode-enabled', message: routerLaserModeMessage(source) });
  }
  // With $32=1 the laser-mode error above already says Resume has no spin-up.
  if (firmware.fluidnc && controller.laserModeEnabled !== true) {
    warnings.push({ code: 'fluidnc-resume-spinup', message: FLUIDNC_RESUME_SPINUP_MESSAGE });
  }
  return { ok: errors.length === 0, errors, warnings };
}

function powerRangeFirmware(
  source: ReadinessSettingsSource,
  firmwareKind: ControllerKind | undefined,
): PowerRangeFirmware {
  if (source === 'fluidnc-yaml' || firmwareKind === 'fluidnc') return 'fluidnc';
  if (firmwareKind === 'grblhal') return 'grblhal';
  return firmwareKind === 'grbl-v1.1' ? 'grbl' : 'unknown';
}

// A router job with laser mode on or unconfirmed. GRBL's laser mode passes zero
// spindle speed on every non-cutting motion and skips the spin-up delay, both
// at the dwell after M3 and on Resume (CNC audit JR-1, MC-1: gcode.c, protocol.c).
// Job Review opens the full text of these warnings (JobReviewWarnings).
export const CNC_LASER_MODE_UNKNOWN_MESSAGE =
  'Controller did not report GRBL $32. KerfDesk cannot prove the controller is in router mode.';
export const CNC_LASER_MODE_UNVERIFIED_MESSAGE =
  "The controller's settings dump did not include $32, so router mode ($32=0) is NOT verified against the firmware. Confirm it before cutting.";
export {
  CNC_LASER_MODE_ENABLED_MESSAGE,
  FLUIDNC_CNC_LASER_MODE_ENABLED_MESSAGE,
  LASER_MODE_DISABLED_MESSAGE,
};

export function isCncLaserModeMessage(message: string): boolean {
  return (
    message === CNC_LASER_MODE_ENABLED_MESSAGE ||
    message === FLUIDNC_CNC_LASER_MODE_ENABLED_MESSAGE ||
    message === CNC_LASER_MODE_UNVERIFIED_MESSAGE ||
    message === CNC_LASER_MODE_UNKNOWN_MESSAGE
  );
}

function laserReadiness(
  project: Project,
  controller: ControllerSettingsSnapshot,
  absentPolicy: AbsentSettingPolicy,
  source: ReadinessSettingsSource,
  firmwareKind: ControllerKind | undefined,
): ControllerReadinessResult {
  const errors: ReadinessErrors = [];
  const warnings: ReadinessWarnings = [];
  // A reported $30=0 is evidence, not a missing setting: it has no S range to
  // apply, so it gets the power-range-empty warning below instead.
  const reportedMaxS = reportedMaxPowerS(controller);
  if (reportedMaxS === undefined) {
    if (absentPolicy === 'error') {
      errors.push({
        code: 'max-power-unknown',
        message:
          'Controller did not report GRBL $30 max S. KerfDesk cannot prove that power percentages map safely.',
      });
    } else {
      warnings.push({
        code: 'power-scale-unverified',
        message: `Controller settings did not confirm $30, so the S power scale (max S ${project.device.maxPowerS}) comes from the device profile and is NOT verified against the firmware. Confirm it before burning at high power.`,
      });
    }
  } else if (
    controller.maxPowerS !== undefined &&
    controller.maxPowerS !== project.device.maxPowerS
  ) {
    errors.push({
      code: 'max-power-mismatch',
      message: laserMaxPowerMismatchMessage(controller.maxPowerS, project.device.maxPowerS, source),
    });
  }

  if (controller.machineMode?.kind === 'lathe') {
    warnings.push({ code: 'lathe-mode', message: LASER_LATHE_MODE_MESSAGE });
  } else if (controller.laserModeEnabled === undefined) {
    if (absentPolicy === 'error') {
      errors.push({
        code: 'laser-mode-unknown',
        message:
          'Controller did not report GRBL $32 laser mode. KerfDesk cannot prove safe laser-mode behavior.',
      });
    } else {
      warnings.push({ code: 'laser-mode-unverified', message: laserModeUnverifiedMessage(source) });
    }
  } else if (!controller.laserModeEnabled) {
    errors.push({ code: 'laser-mode-disabled', message: laserModeDisabledMessage(source) });
  }

  const lowPower = lowPowerWarning(controller, source, firmwareKind);
  if (lowPower !== null) warnings.push(lowPower);

  return { ok: errors.length === 0, errors, warnings };
}

// $30 at or below $31 is the stronger finding: the range is empty, not merely
// raised at the bottom, so it replaces the raised-$31 advice.
function lowPowerWarning(
  controller: ControllerSettingsSnapshot,
  source: ReadinessSettingsSource,
  firmwareKind: ControllerKind | undefined,
): ControllerReadinessMessage<ControllerReadinessWarningCode> | null {
  const reportedMaxS = reportedMaxPowerS(controller);
  if (reportedMaxS !== undefined && laserPowerRangeIsEmpty(controller)) {
    return {
      code: 'power-range-empty',
      message: laserPowerRangeEmptyMessage(
        reportedMaxS,
        controller.minPowerS,
        powerRangeFirmware(source, firmwareKind),
      ),
    };
  }
  return controller.minPowerS !== undefined && controller.minPowerS > 0
    ? {
        code: 'min-power-nonzero',
        message: laserMinPowerNonzeroMessage(
          controller.minPowerS,
          reportedMaxS,
          powerRangeFirmware(source, firmwareKind),
        ),
      }
    : null;
}
