import type { ControllerKind } from './device-profile';

/** A separate pointer, explicitly mapped to the machine's documented accessory output. */
export type PositioningLight = {
  readonly onCommand: string;
  readonly offCommand: string;
  /** Pointer spot minus laser spot, in bed coordinates (millimetres). */
  readonly offsetXmm: number;
  readonly offsetYmm: number;
  /** After a clean ordinary Frame, centre the pointer on the framed artwork and switch it on (ADR-604). */
  readonly afterFrame?: boolean;
};

export const MAX_POSITIONING_LIGHT_OFFSET_MM = 1000;

// Never accept cutting-beam, motion, program control, reset, SD deletion or firmware commands.
const RESERVED_M_CODES = new Set([
  0, 1, 2, 3, 4, 5, 6, 18, 20, 21, 22, 23, 24, 25, 26, 28, 29, 30, 32, 48, 81, 84, 98, 99, 104, 109,
  110, 112, 125, 140, 141, 143, 190, 191, 192, 226, 280, 290, 303, 360, 361, 362, 363, 364, 400,
  401, 402, 410, 500, 501, 502, 600, 605, 701, 702, 915, 997, 999,
]);

export function positioningLightIssue(
  value: unknown,
  controllerKind?: ControllerKind,
  gcodeDialectId?: string,
): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'Positioning light must contain its on/off commands and X/Y offsets.';
  }
  const light = value as Record<string, unknown>;
  for (const field of ['onCommand', 'offCommand'] as const) {
    const issue = commandIssue(light[field], field, controllerKind, gcodeDialectId);
    if (issue !== null) return issue;
  }
  const onCommand = light['onCommand'] as string;
  const offCommand = light['offCommand'] as string;
  if (canonicalCommand(onCommand) === canonicalCommand(offCommand)) {
    return 'Positioning light on and off commands must be different.';
  }
  if (light['afterFrame'] !== undefined && typeof light['afterFrame'] !== 'boolean') {
    return 'Positioning light "Centre & LED after Frame" must be on or off.';
  }
  return digitalOutputPairIssue(onCommand, offCommand, controllerKind) ?? offsetIssue(light);
}

function commandIssue(
  command: unknown,
  field: 'onCommand' | 'offCommand',
  kind: ControllerKind | undefined,
  gcodeDialectId: string | undefined,
): string | null {
  if (!isPositioningLightCommand(command)) {
    return `Positioning light ${field === 'onCommand' ? 'on' : 'off'} command must be one documented accessory M-code, without motion or cutting-beam commands.`;
  }
  return (
    machineStateCommandIssue(command, kind, gcodeDialectId) ?? digitalOutputIssue(command, kind)
  );
}

function offsetIssue(light: Record<string, unknown>): string | null {
  for (const field of ['offsetXmm', 'offsetYmm'] as const) {
    if (!validOffset(light[field])) {
      return `Positioning light ${field === 'offsetXmm' ? 'X' : 'Y'} offset must be between -1000 and 1000 mm.`;
    }
  }
  return null;
}

function validOffset(offset: unknown): boolean {
  return (
    typeof offset === 'number' &&
    Number.isFinite(offset) &&
    Math.abs(offset) <= MAX_POSITIONING_LIGHT_OFFSET_MM
  );
}

function digitalOutputIssue(command: string, kind: ControllerKind | undefined): string | null {
  if (kind !== 'grblhal' && kind !== 'fluidnc') return null;
  if (/^M0*6[23](?:[. ]|$)/i.test(command.trim())) {
    return 'Positioning light requires immediate M64/M65 output commands; M62/M63 waits for another motion.';
  }
  if (!/^M0*6[45](?:\.0+)?(?: |$)/i.test(command.trim())) return null;
  const match = /^M0*6[45](?:\.0+)? +P(\d+)$/i.exec(command.trim());
  const maximum = kind === 'fluidnc' ? 7 : 255;
  return match !== null && Number(match[1]) <= maximum
    ? null
    : `Positioning light digital output must use M64 Pn or M65 Pn with an integer output from 0 to ${maximum}.`;
}

function digitalOutputPairIssue(
  onCommand: string,
  offCommand: string,
  kind: ControllerKind | undefined,
): string | null {
  if (kind !== 'grblhal' && kind !== 'fluidnc') return null;
  const digitalOutput = /^M0*(6[45])(?:\.0+)? +P(\d+)$/i;
  const on = digitalOutput.exec(onCommand.trim());
  const off = digitalOutput.exec(offCommand.trim());
  // Explicit custom output mappings remain valid; standard M64/M65 must
  // address one output with opposite states, including an active-low pair.
  if (on === null || off === null) return null;
  return on[1] !== off[1] && Number(on[2]) === Number(off[2])
    ? null
    : 'Positioning light M64/M65 commands must use opposite states for the same output.';
}

function canonicalCommand(command: string): string {
  const [head = '', ...words] = command.trim().toUpperCase().split(/ +/);
  const [code = '', subcode = '0'] = head.slice(1).split('.');
  const args = words.map((word) => [word.charAt(0), Number(word.slice(1))] as const);
  // Unique parameter words are order-independent. Duplicate names are
  // rejected below because firmware parsers resolve them differently.
  args.sort((left, right) => left[0].localeCompare(right[0]));
  // A subcode is an integer after '.', not a decimal part of the M-code:
  // M106.10 and M106.1 are distinct, while .01 and .1 are equivalent.
  return JSON.stringify([Number(code), subcode.replace(/^0+(?=\d)/, ''), args]);
}

function isPositioningLightCommand(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 100 || /[^\x20-\x7e]/.test(value)) return false;
  const command = value.trim();
  // Numeric accessory arguments only; no axis/feed words, second code, comments or shell text.
  const match = /^M(\d{1,4})(?:\.\d+)?(?: +[PSTILRQ][-+]?(?:\d+(?:\.\d*)?|\.\d+))*$/i.exec(command);
  if (match === null || RESERVED_M_CODES.has(Number(match[1]))) return false;
  const letters = command
    .toUpperCase()
    .split(/ +/)
    .slice(1)
    .map((word) => word.charAt(0));
  return new Set(letters).size === letters.length;
}

export function normalizePositioningLight(
  value: unknown,
  controllerKind?: ControllerKind,
  gcodeDialectId?: string,
): PositioningLight | undefined {
  if (value === undefined || positioningLightIssue(value, controllerKind, gcodeDialectId) !== null)
    return undefined;
  const light = value as PositioningLight;
  return {
    onCommand: light.onCommand.trim(),
    offCommand: light.offCommand.trim(),
    offsetXmm: light.offsetXmm,
    offsetYmm: light.offsetYmm,
    ...(light.afterFrame === true ? { afterFrame: true } : {}),
  };
}

// Accessory-shaped codes that change machine state a light must never touch:
// raw pin writes/toggles, PSU power, steps/mm, endstop and soft-limit
// enforcement, feedrate/flow overrides, acceleration and jerk, home and probe
// offsets, microstepping, serial baud and motor current (babystepping M290 is
// a reserved motion code above).
const STATE_CHANGING_M_CODES = new Set([
  42, 43, 80, 92, 120, 121, 201, 202, 203, 204, 205, 206, 211, 220, 221, 350, 351, 428, 575, 851,
  906, 907,
]);

function machineStateCommandIssue(
  command: string,
  kind: ControllerKind | undefined,
  gcodeDialectId: string | undefined,
): string | null {
  const [head = '', ...words] = command.trim().toUpperCase().split(/ +/);
  const code = Number(/^M(\d+)/.exec(head)?.[1]);
  if (STATE_CHANGING_M_CODES.has(code))
    return 'Positioning light commands cannot change pins, limits, overrides or motion settings.';
  // Smoothieware's M106/M107 are configurable switch commands; elsewhere they
  // address Marlin fans. KerfDesk's 'marlin-fan' dialect fires the laser with
  // a bare M106 S<n> (fan 0), so only an explicit non-zero fan index is a
  // separate output, and a fan-mosfet profile refuses them outright.
  if ((code !== 106 && code !== 107) || kind === 'smoothieware') return null;
  if (gcodeDialectId === 'marlin-fan')
    return 'Positioning light cannot use M106/M107 on a Marlin fan-mosfet profile: they fire the laser.';
  const fan = Number(words.find((word) => word.startsWith('P'))?.slice(1));
  return Number.isInteger(fan) && fan > 0
    ? null
    : 'Positioning light M106/M107 must name a non-zero P fan index; fan 0 can be the laser.';
}
