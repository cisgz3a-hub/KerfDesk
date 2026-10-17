import type { ControllerKind } from './device-profile';

/** A separate pointer, explicitly mapped to the machine's documented accessory output. */
export type PositioningLight = {
  readonly onCommand: string;
  readonly offCommand: string;
  /** Pointer spot minus laser spot, in bed coordinates (millimetres). */
  readonly offsetXmm: number;
  readonly offsetYmm: number;
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
): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'Positioning light must contain its on/off commands and X/Y offsets.';
  }
  const light = value as Record<string, unknown>;
  for (const field of ['onCommand', 'offCommand'] as const) {
    if (!isPositioningLightCommand(light[field])) {
      return `Positioning light ${field === 'onCommand' ? 'on' : 'off'} command must be one documented accessory M-code, without motion or cutting-beam commands.`;
    }
    const outputIssue = digitalOutputIssue(light[field] as string, controllerKind);
    if (outputIssue !== null) return outputIssue;
  }
  const onCommand = light['onCommand'] as string;
  const offCommand = light['offCommand'] as string;
  if (canonicalCommand(onCommand) === canonicalCommand(offCommand)) {
    return 'Positioning light on and off commands must be different.';
  }
  return digitalOutputPairIssue(onCommand, offCommand, controllerKind) ?? offsetIssue(light);
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

export function normalizePositioningLight(value: unknown): PositioningLight | undefined {
  if (value === undefined || positioningLightIssue(value) !== null) return undefined;
  const light = value as PositioningLight;
  return {
    onCommand: light.onCommand.trim(),
    offCommand: light.offCommand.trim(),
    offsetXmm: light.offsetXmm,
    offsetYmm: light.offsetYmm,
  };
}
