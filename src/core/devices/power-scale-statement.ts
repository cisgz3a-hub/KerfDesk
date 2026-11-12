// The operator's recorded statement that a profile's Full-power S matches the
// firmware's laser power scale (annoyance audit A2 B3-P2-1, ADR-095
// Amendment 1).
//
// Two families KerfDesk drives report no power scale it could check:
// - Marlin. `M115` prints a `Cap:LASER:1` (or `Cap:SPINDLE:1`) presence flag
//   and nothing about CUTTER_POWER_UNIT or SPEED_POWER_MAX, and the `M503`
//   settings report has no cutter line. The unit is a build option
//   (PWM255: S0-S255, PERCENT: S0-S100, RPM: up to SPEED_POWER_MAX).
//   https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/host/M115.cpp
//   https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/module/settings.cpp
//   https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/Configuration_adv.h
// - Smoothieware. The Laser module reads `laser_module_maximum_s_value` from
//   the config file at boot (default 1) and no G- or M-code prints it; `M221`
//   reports the power percentage, the auto-power flag and the PWM frequency.
//   https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/laser/Laser.cpp
//
// So on those machines the scale rests on the profile. The statement records
// that the operator checked it once. It is the operator's word, never a
// KerfDesk verification, and every surface that shows it says so. KerfDesk
// reads no build identity from either firmware, so a reflashed or reconfigured
// board cannot void the statement by itself: the wording says to check again.

import type { ControllerKind, DeviceProfile } from './device-profile';

/** The families whose power scale only the operator can check. */
export type UnreportedPowerScaleFirmware = 'marlin' | 'smoothieware';

export type OperatorPowerScaleStatement = {
  /** The Full-power S the operator checked. */
  readonly maxPowerS: number;
  readonly controllerKind: UnreportedPowerScaleFirmware;
  /** The output dialect: Marlin inline and fan wiring scale S differently. */
  readonly dialectId: string;
  readonly statedAtIso: string;
};

type StatementDevice = Pick<DeviceProfile, 'controllerKind' | 'maxPowerS' | 'gcodeDialect'>;

export function unreportedPowerScaleFirmware(
  controllerKind: ControllerKind | undefined,
): UnreportedPowerScaleFirmware | null {
  return controllerKind === 'marlin' || controllerKind === 'smoothieware' ? controllerKind : null;
}

/** A statement for the profile as it is now, or null on a firmware that
 *  reports its power scale (there the report is the evidence). */
export function createOperatorPowerScaleStatement(
  device: StatementDevice,
  statedAtIso: string,
): OperatorPowerScaleStatement | null {
  const controllerKind = unreportedPowerScaleFirmware(device.controllerKind);
  if (controllerKind === null) return null;
  return {
    maxPowerS: device.maxPowerS,
    controllerKind,
    dialectId: device.gcodeDialect.dialectId,
    statedAtIso,
  };
}

/** The statement, while it still describes this profile: the same Full-power
 *  S, controller family and output dialect it was made for. A statement for
 *  anything else stands for nothing. */
export function standingPowerScaleStatement(
  device: StatementDevice & Pick<DeviceProfile, 'operatorPowerScaleStatement'>,
): OperatorPowerScaleStatement | null {
  const statement = device.operatorPowerScaleStatement;
  if (statement === undefined || !isOperatorPowerScaleStatement(statement)) return null;
  return powerScaleStatementDescribes(statement, device) ? statement : null;
}

export function powerScaleStatementDescribes(
  statement: OperatorPowerScaleStatement,
  device: StatementDevice,
): boolean {
  return (
    statement.controllerKind === unreportedPowerScaleFirmware(device.controllerKind) &&
    statement.maxPowerS === device.maxPowerS &&
    statement.dialectId === device.gcodeDialect.dialectId
  );
}

export function isOperatorPowerScaleStatement(
  value: unknown,
): value is OperatorPowerScaleStatement {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const maxPowerS = record['maxPowerS'];
  return (
    typeof maxPowerS === 'number' &&
    Number.isFinite(maxPowerS) &&
    maxPowerS > 0 &&
    (record['controllerKind'] === 'marlin' || record['controllerKind'] === 'smoothieware') &&
    isShortText(record['dialectId'], 64) &&
    isTimestamp(record['statedAtIso'])
  );
}

function isShortText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isTimestamp(value: unknown): boolean {
  return isShortText(value, 40) && Number.isFinite(Date.parse(value));
}

/** The field for a loaded project: a well-formed statement, else explicitly
 *  absent, so a malformed one in the file is dropped. */
export function normalizedPowerScaleStatement(value: unknown): {
  readonly operatorPowerScaleStatement: OperatorPowerScaleStatement | undefined;
} {
  return {
    operatorPowerScaleStatement:
      operatorPowerScaleStatementEntry(value).operatorPowerScaleStatement,
  };
}

/** For canonical profile and project forms: the field only when it is valid. */
export function operatorPowerScaleStatementEntry(
  value: unknown,
): Pick<DeviceProfile, 'operatorPowerScaleStatement'> {
  return isOperatorPowerScaleStatement(value)
    ? {
        operatorPowerScaleStatement: {
          maxPowerS: value.maxPowerS,
          controllerKind: value.controllerKind,
          dialectId: value.dialectId,
          statedAtIso: value.statedAtIso,
        },
      }
    : {};
}

export function unreportedPowerScaleFirmwareName(firmware: UnreportedPowerScaleFirmware): string {
  return firmware === 'marlin' ? 'Marlin' : 'Smoothieware';
}

function formatS(value: number): string {
  return String(Number(value.toFixed(6)));
}

/** What the operator compares the profile's Full-power S with, once. */
export function powerScaleCheckInstruction(device: StatementDevice): string {
  const top = formatS(device.maxPowerS);
  if (device.controllerKind === 'smoothieware') {
    return `Check once that laser_module_maximum_s_value in the board's config file is ${top}.`;
  }
  return device.gcodeDialect.dialectId === 'marlin-fan'
    ? `Check once that the laser is wired to the fan output this profile drives, which takes M106 S0 to S${top}.`
    : `Check once that the firmware's laser power unit tops out at S${top}: CUTTER_POWER_UNIT PWM255 is S0 to S255, PERCENT is S0 to S100, and RPM runs up to SPEED_POWER_MAX.`;
}

/** Job Review and Save: the scale is unchecked, and nobody has said they checked it. */
export function unreportedPowerScaleWarning(device: StatementDevice): string {
  const firmware = unreportedPowerScaleFirmware(device.controllerKind);
  const name = firmware === null ? 'This controller' : unreportedPowerScaleFirmwareName(firmware);
  return (
    `${name} does not report its laser power scale, so KerfDesk cannot check that full power is S${formatS(device.maxPowerS)} on this machine. ` +
    `${powerScaleCheckInstruction(device)} ` +
    'Then tick "I have checked this" beside Full-power S in Machine Setup, and this note stops.'
  );
}

/** The acknowledgement the operator confirms while no statement stands. */
export function unreportedPowerScaleStartPrompt(device: StatementDevice): string {
  const firmware = unreportedPowerScaleFirmware(device.controllerKind);
  const name = firmware === null ? 'This controller' : unreportedPowerScaleFirmwareName(firmware);
  return (
    "KerfDesk cannot check this controller's power scale.\n\n" +
    `${name} does not report its laser power scale. This job sends full power as S${formatS(device.maxPowerS)}, from the machine profile. ` +
    'If the firmware expects a different top value, every power in the job is wrong by that ratio. ' +
    `${powerScaleCheckInstruction(device)} ` +
    'To stop being asked, tick "I have checked this" beside Full-power S in Machine Setup.\n\n' +
    'Start this laser job anyway?'
  );
}

/** The one neutral line Job Review shows while a statement stands. */
export function operatorStatedPowerScaleFact(statement: OperatorPowerScaleStatement): string {
  const name = unreportedPowerScaleFirmwareName(statement.controllerKind);
  return (
    `Power scale: operator-stated. You recorded on ${statement.statedAtIso.slice(0, 10)} that full power is S${formatS(statement.maxPowerS)} on this machine. ` +
    `KerfDesk has not checked it, because ${name} does not report it. Check again after changing the firmware or its configuration.`
  );
}
