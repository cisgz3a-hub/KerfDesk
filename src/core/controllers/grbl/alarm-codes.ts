// GRBL v1.1 alarm codes. Source: gnea/grbl wiki "Alarm Codes".
//
// Alarms are unrecoverable until the machine state is reset and unlocked
// (`$X` after `Ctrl-X`). Position is "lost" — meaning the controller no
// longer trusts its work coordinates — for alarms 1, 3, and after probes.
//
// UI surfaces these messages on the F-B9 modal. F-A10 preflight does not
// reference these (it runs before any streaming).

export type AlarmCode = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type AlarmDescription = {
  readonly code: AlarmCode;
  readonly title: string;
  readonly detail: string;
  readonly positionLost: boolean;
  readonly action: string; // What the user should do to recover.
};

export const ALARM_CODES: ReadonlyArray<AlarmDescription> = [
  {
    code: 1,
    title: 'Hard limit triggered',
    detail: 'A limit switch was hit while the laser was moving.',
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
    detail: 'A limit switch is stuck or the machine is already at the limit.',
    positionLost: true,
    action: 'Manually move off the switch, then re-home.',
  },
  {
    code: 9,
    title: 'Homing fail — could not find limit switch',
    detail: 'The homing search ran off the end of travel.',
    positionLost: true,
    action: 'Check that the limit switch wiring is correct.',
  },
  {
    code: 10,
    title: 'E-stop asserted',
    detail: 'The hardware E-stop is active.',
    positionLost: true,
    action: 'Release the E-stop, soft-reset, then $X to unlock.',
  },
];

const ALARMS_BY_CODE = new Map(ALARM_CODES.map((a) => [a.code, a]));

export function describeAlarm(code: number): AlarmDescription | null {
  return ALARMS_BY_CODE.get(code as AlarmCode) ?? null;
}
