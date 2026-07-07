// GRBL v1.1 error codes. Source: gnea/grbl wiki "Error Codes".
//
// Errors arrive as `error:N` after a line GRBL couldn't accept. Unlike
// alarms, the machine stays in its previous state and can keep running;
// the offending line just gets rejected. Mid-job an error is terminal for
// the stream (ADR-041): no further bytes are sent, `lastError` records the
// code, and a persistent controller-error safety notice is raised.

export type ErrorDescription = {
  readonly code: number;
  readonly title: string;
  readonly detail: string;
};

const ERRORS: ReadonlyArray<ErrorDescription> = [
  {
    code: 1,
    title: 'Expected G-code letter',
    detail: 'A G-code line was missing a command letter.',
  },
  { code: 2, title: 'Bad G-code number', detail: 'A G-code value was not a valid number.' },
  { code: 3, title: 'Unsupported $ command', detail: 'A `$`-prefixed command is not recognized.' },
  {
    code: 4,
    title: 'Negative value not allowed',
    detail: 'A setting received a negative number where positive was required.',
  },
  {
    // Official: "Homing cycle failure. Homing is not enabled via settings."
    // Fires when $H is issued while $22=0 — NOT on a settings write.
    code: 5,
    title: 'Homing cycle disabled',
    detail: 'The homing cycle ($H) was refused because homing is not enabled. Set $22=1 first.',
  },
  {
    code: 6,
    title: 'Setting step pulse out of range',
    detail: 'Step-pulse setting must be ≥ 3 µs.',
  },
  {
    code: 7,
    title: 'EEPROM read failed',
    detail: 'Settings were reset to defaults; verify with $$.',
  },
  { code: 8, title: 'Not idle', detail: 'The command needs the controller to be idle.' },
  { code: 9, title: 'G-code lock', detail: 'Alarm or jog state active — unlock with $X first.' },
  {
    // Official: "Soft limits cannot be enabled without homing also enabled."
    // Fires when writing $20=1 while $22=0.
    code: 10,
    title: 'Homing not enabled',
    detail: 'Soft limits ($20=1) cannot be enabled without homing ($22=1) also enabled.',
  },
  {
    code: 11,
    title: 'Line overflow',
    detail: 'A streamed line exceeded the buffer; shorten lines.',
  },
  {
    code: 12,
    title: 'Step rate exceeds maximum',
    detail: 'Reduce feed rate or check $11x settings.',
  },
  { code: 13, title: 'Safety door open', detail: 'Close the safety door before resuming.' },
  { code: 14, title: 'Build info too long', detail: '$I value exceeds storage.' },
  { code: 15, title: 'Jog target exceeds travel', detail: 'Reduce the jog distance.' },
  { code: 16, title: 'Invalid jog command', detail: 'Jog syntax not recognized.' },
  {
    // Official: "Laser mode requires PWM output." Fires when a $32=1 write is
    // REJECTED because the firmware build has no variable-spindle PWM —
    // telling the user to "enable $32=1" was the action that just failed.
    code: 17,
    title: 'Laser mode needs PWM',
    detail: 'Laser mode requires PWM spindle output; this firmware build cannot enable $32=1.',
  },
  {
    code: 20,
    title: 'Unsupported G-code command',
    detail: 'This G-code is not supported by GRBL.',
  },
  {
    code: 21,
    title: 'Modal group violation',
    detail: 'Two commands from the same modal group in one line.',
  },
  { code: 22, title: 'Undefined feed rate', detail: 'G1/G2/G3 requires F to be set.' },
  {
    code: 23,
    title: 'Invalid G-code value',
    detail: 'A G-code parameter is not a valid integer where one was expected.',
  },
  {
    code: 24,
    title: 'Two G-code commands in axis words',
    detail: 'Conflicting commands in one line.',
  },
  { code: 25, title: 'Repeated G-code word', detail: 'Same axis word used twice.' },
  { code: 26, title: 'No axis words', detail: 'A motion command needs at least one axis word.' },
  { code: 27, title: 'Invalid line number', detail: 'N-word value out of range.' },
  {
    code: 28,
    title: 'G-code missing a required value word',
    detail: 'A G-code command is missing a required value word (e.g. G10 without P/L).',
  },
  { code: 29, title: 'Unsupported work coordinate system', detail: 'Only G54-G59 are supported.' },
  { code: 30, title: 'G53 needs G0 or G1', detail: 'G53 is only allowed with G0 and G1 motion.' },
  {
    code: 31,
    title: 'Axis words without command',
    detail: 'Axis words present but no motion command.',
  },
  {
    code: 32,
    title: 'No axis words in plane',
    detail: 'G2/G3 needs at least two axis words in the active plane.',
  },
  { code: 33, title: 'Arc invalid target', detail: 'G2/G3 target is not on a valid arc radius.' },
  {
    code: 34,
    title: 'Arc radius too small',
    detail: 'Radius would produce an arc of zero length.',
  },
  {
    code: 35,
    title: 'Arc offset missing',
    detail: 'G2/G3 needs I/J/K offsets in the active plane.',
  },
  { code: 36, title: 'Unused value words', detail: 'A G-code word in the line had no effect.' },
  {
    code: 37,
    title: 'G43.1 invalid axis',
    detail: 'Dynamic tool length offset requires the configured tool axis.',
  },
  { code: 38, title: 'Tool number too large', detail: 'Reduce the tool number.' },
];

const ERRORS_BY_CODE = new Map(ERRORS.map((e) => [e.code, e]));

export function describeError(code: number): ErrorDescription | null {
  return ERRORS_BY_CODE.get(code) ?? null;
}

export const ALL_ERROR_CODES: ReadonlyArray<ErrorDescription> = ERRORS;
