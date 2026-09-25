// GRBL-family alarm codes. Sources: gnea/grbl doc/csv/alarm_codes_en_US.csv
// (stock GRBL v1.1, codes 1–10) and grblHAL core alarms.c (codes 1–22).
//
// Codes 1–9 mean the same thing on both firmwares. Code 10 does not: stock
// GRBL raises it only in ENABLE_DUAL_AXIS builds, when the second switch of a
// dual-motor axis fails to trigger during homing, while grblHAL uses 10 for an
// asserted E-stop (its dual-switch homing failure is 15). Stock GRBL never
// emits 11–22, so the stock lookup falls back to the grblHAL meanings for
// those codes rather than showing "unknown" on a mislabeled profile.
//
// Alarms lock out G-code until the controller is unlocked (`$X`) or homed
// (`$H`); hard and soft limit alarms (1, 2) first need a soft reset. Position
// is "lost" — meaning the controller no longer trusts its work coordinates —
// whenever motion stopped abruptly or homing did not finish.
//
// UI surfaces these messages on the F-B9 modal. F-A10 preflight does not
// reference these (it runs before any streaming).

export type AlarmCode =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22;

/** Which firmware's numbering to use where GRBL and grblHAL disagree (code 10). */
export type AlarmFirmware = 'grbl' | 'grblhal';

export type AlarmDescription = {
  readonly code: AlarmCode;
  readonly title: string;
  readonly detail: string;
  readonly positionLost: boolean;
  readonly action: string; // What the user should do to recover.
};

const SHARED_ALARM_CODES: ReadonlyArray<AlarmDescription> = [
  {
    code: 1,
    title: 'Hard limit triggered',
    detail: 'A limit switch was hit while the machine was moving.',
    positionLost: true,
    action: 'Re-home the machine ($H) after clearing the obstruction.',
  },
  {
    code: 2,
    title: 'G-code target exceeds machine travel',
    detail: 'The job tried to move outside the soft-limits envelope.',
    positionLost: false,
    action: 'Check the design fits the bed; re-import or shrink.',
  },
  {
    code: 3,
    title: 'Reset during motion',
    detail: 'The controller was reset while still moving. Position is lost.',
    positionLost: true,
    action: 'Re-home the machine ($H) before resuming work.',
  },
  {
    code: 4,
    title: 'Probe fail (initial)',
    detail: 'A probe cycle was started while the probe was already triggered.',
    positionLost: false,
    action: 'Verify the probe wiring and the workpiece position.',
  },
  {
    code: 5,
    title: 'Probe fail (no contact)',
    detail: 'The probe did not contact the workpiece within travel.',
    positionLost: false,
    action: 'Lower the start position or check the probe.',
  },
  {
    code: 6,
    title: 'Homing fail — reset',
    detail: 'The controller was reset mid-homing.',
    positionLost: true,
    action: 'Re-run the homing cycle ($H).',
  },
  {
    code: 7,
    title: 'Homing fail — door opened',
    detail: 'The safety door opened during homing.',
    positionLost: true,
    action: 'Close the door, then re-home.',
  },
  {
    code: 8,
    title: 'Homing fail — could not clear limit switch',
    detail: 'The pull-off move after homing did not release the limit switch.',
    positionLost: true,
    action: 'Increase the homing pull-off ($27) or check the switch wiring, then re-home ($H).',
  },
  {
    code: 9,
    title: 'Homing fail — could not find limit switch',
    detail: 'Homing did not reach a limit switch within the search distance.',
    positionLost: true,
    action:
      'Check the switch wiring, or increase max travel ($130–$132) or decrease pull-off ($27), then re-home ($H).',
  },
];

const GRBL_DUAL_AXIS_HOMING_ALARM: AlarmDescription = {
  code: 10,
  title: 'Homing fail — dual-axis switch',
  detail:
    'The second limit switch on a dual-motor axis did not trigger in time after the first. (grblHAL firmware uses alarm 10 for E-stop instead.)',
  positionLost: true,
  action: 'Check both limit switches on that axis and their wiring, then re-home ($H).',
};

// positionLost is conservative (true) where grblHAL's text does not say the
// position survives: re-homing after an unexplained stop is the safe default.
const GRBLHAL_ALARM_CODES: ReadonlyArray<AlarmDescription> = [
  {
    code: 10,
    title: 'E-stop asserted (grblHAL)',
    detail: 'The hardware E-stop is active.',
    positionLost: true,
    action: 'Release the E-stop, soft-reset, then $X to unlock.',
  },
  {
    code: 11,
    title: 'Homing required (grblHAL)',
    detail: 'The controller requires a homing cycle before motion is allowed.',
    positionLost: true,
    action: 'Run the homing cycle ($H).',
  },
  {
    code: 12,
    title: 'Limit switch engaged (grblHAL)',
    detail: 'A limit switch is engaged, so the controller will not continue until it is cleared.',
    positionLost: true,
    action: 'Move the head off the switch, then re-home ($H).',
  },
  {
    code: 13,
    title: 'Probe protection triggered (grblHAL)',
    detail: 'The probe protection input tripped during motion.',
    positionLost: false,
    action: 'Check the probe wiring, soft-reset, then $X to unlock.',
  },
  {
    code: 14,
    title: 'Spindle at-speed timeout (grblHAL)',
    detail: 'The spindle did not report reaching the commanded speed in time.',
    positionLost: true,
    action: 'Check the spindle or VFD and its at-speed signal, soft-reset, then $X to unlock.',
  },
  {
    code: 15,
    title: 'Homing fail — auto-squared axis (grblHAL)',
    detail:
      'The second limit switch of an auto-squared axis was not found within the search distance.',
    positionLost: true,
    action:
      'Check both switches on that axis and their wiring, or increase max travel or decrease pull-off, then re-home ($H).',
  },
  {
    code: 16,
    title: 'Power-on self test failed (grblHAL)',
    detail: 'The controller failed its power-on self test.',
    positionLost: true,
    action: 'Check the controller power and wiring, then power-cycle it.',
  },
  {
    code: 17,
    title: 'Motor fault (grblHAL)',
    detail: 'A stepper driver reported a fault.',
    positionLost: true,
    action: 'Check the motor drivers and wiring, soft-reset, then re-home ($H).',
  },
  {
    code: 18,
    title: 'Homing fail — bad configuration (grblHAL)',
    detail: 'The homing settings are not valid.',
    positionLost: true,
    action: 'Review the homing settings ($22–$27), then re-home ($H).',
  },
  {
    code: 19,
    title: 'Modbus exception (grblHAL)',
    detail: 'A Modbus device, usually a VFD spindle, timed out or returned an error.',
    positionLost: true,
    action: 'Check the VFD Modbus wiring and settings, soft-reset, then $X to unlock.',
  },
  {
    code: 20,
    title: 'I/O expander failure (grblHAL)',
    detail: 'The controller lost communication with its I/O expander.',
    positionLost: true,
    action: 'Check the expander connection, then power-cycle the controller.',
  },
  {
    code: 21,
    title: 'Settings storage failure (grblHAL)',
    detail: 'The controller could not read or write its non-volatile settings storage.',
    positionLost: true,
    action:
      'Power-cycle the controller, then read the settings ($$) and restore any that were lost.',
  },
  {
    code: 22,
    title: 'Buffer overflow (grblHAL)',
    detail: 'A controller buffer overflowed.',
    positionLost: true,
    action: 'Soft-reset, then re-home ($H) before resuming.',
  },
];

const GRBL_ALARMS_BY_CODE = new Map<number, AlarmDescription>(
  [
    ...SHARED_ALARM_CODES,
    GRBL_DUAL_AXIS_HOMING_ALARM,
    ...GRBLHAL_ALARM_CODES.filter((alarm) => alarm.code !== 10),
  ].map((alarm) => [alarm.code, alarm]),
);

const GRBLHAL_ALARMS_BY_CODE = new Map<number, AlarmDescription>(
  [...SHARED_ALARM_CODES, ...GRBLHAL_ALARM_CODES].map((alarm) => [alarm.code, alarm]),
);

export function describeAlarm(
  code: number,
  firmware: AlarmFirmware = 'grbl',
): AlarmDescription | null {
  const table = firmware === 'grblhal' ? GRBLHAL_ALARMS_BY_CODE : GRBL_ALARMS_BY_CODE;
  return table.get(code) ?? null;
}
