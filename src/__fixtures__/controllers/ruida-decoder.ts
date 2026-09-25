// ruida-decoder — test instrument that unswizzles and parses the .rd command
// stream this repo's encoder produces. Round-tripping through this decoder
// proves the encoder's INTERNAL consistency (geometry, power, speed, air,
// layer structure survive encode→decode); it does NOT prove real-Ruida
// acceptance. Command boundaries are found the way meerk40t's parse_commands
// finds them (a command starts at every byte >= 0x80); each command is then
// named by its opcode prefix and its length is checked, so a missing or extra
// operand byte surfaces as an 'unknown' event. Names follow meerk40t's
// rdjob.py decoder text at 7e82652f.

import { decodeCoord35, decodePower14, unswizzleBytes } from '../../core/controllers/ruida';

export type RdReferencePointMode = 'machine-zero' | 'anchor-point' | 'current-position';
export type RdLaser = 1 | 2;
export type RdPowerBound = 'min' | 'max';

/** Header, array and body bookkeeping records, by meerk40t's names. */
export type RdRecordName =
  | 'reference-point-set'
  | 'block-cutting'
  | 'feed-repeat'
  | 'feed-auto-pause'
  | 'process-repeat'
  | 'array-direction'
  | 'part-work-mode'
  | 'max-layer-part'
  | 'pen-offset'
  | 'layer-offset'
  | 'display-offset'
  | 'feed-info'
  | 'current-element-index'
  | 'array-mirror-cut'
  | 'array-min-point'
  | 'array-max-point'
  | 'array-add'
  | 'array-mirror'
  | 'array-repeat'
  | 'laser-device-0'
  | 'laser-on-delay'
  | 'laser-off-delay'
  | 'laser-tube-start'
  | 'laser2-offset-off';

export type RdDecodedEvent =
  | { readonly kind: 'reference-point'; readonly mode: RdReferencePointMode }
  | { readonly kind: 'start-process' }
  | { readonly kind: 'set-absolute' }
  /** E7 03 Process TopLeft, E7 07 BottomRight, E7 50/51 Document Min/Max Point. */
  | {
      readonly kind: 'job-bounds';
      readonly tag: number;
      readonly xMm: number;
      readonly yMm: number;
    }
  | { readonly kind: 'array-start'; readonly index: number }
  | { readonly kind: 'part-speed'; readonly part: number; readonly mmPerMin: number }
  | {
      readonly kind: 'part-power';
      readonly part: number;
      readonly laser: RdLaser;
      readonly bound: RdPowerBound;
      readonly percent: number;
    }
  | { readonly kind: 'part-color'; readonly part: number; readonly packed: number }
  /** E7 52/53 part Min/Max Point, E7 61/62 MinPointEx/MaxPointEx. */
  | {
      readonly kind: 'part-bounds';
      readonly part: number;
      readonly tag: number;
      readonly xMm: number;
      readonly yMm: number;
    }
  | { readonly kind: 'select-layer'; readonly layer: number }
  | { readonly kind: 'air-assist'; readonly on: boolean }
  | { readonly kind: 'layer-speed'; readonly mmPerMin: number }
  | {
      readonly kind: 'layer-power';
      readonly laser: RdLaser;
      readonly bound: RdPowerBound;
      readonly percent: number;
    }
  | { readonly kind: 'move'; readonly xMm: number; readonly yMm: number }
  | { readonly kind: 'cut'; readonly xMm: number; readonly yMm: number }
  | { readonly kind: 'block-end' }
  | { readonly kind: 'layer-end' }
  | { readonly kind: 'file-sum'; readonly value: number }
  | { readonly kind: 'file-end' }
  | { readonly kind: 'record'; readonly name: RdRecordName; readonly values: ReadonlyArray<number> }
  | { readonly kind: 'unknown'; readonly bytes: ReadonlyArray<number> };

type Command = ReadonlyArray<number>;
type Spec = readonly [prefixHex: string, length: number, decode: (cmd: Command) => RdDecodedEvent];

const SPECS: ReadonlyArray<Spec> = [
  ['88', 11, (c) => ({ kind: 'move', xMm: mm(c, 1), yMm: mm(c, 6) })],
  ['a8', 11, (c) => ({ kind: 'cut', xMm: mm(c, 1), yMm: mm(c, 6) })],
  ['d810', 2, () => ({ kind: 'reference-point', mode: 'machine-zero' })],
  ['d811', 2, () => ({ kind: 'reference-point', mode: 'anchor-point' })],
  ['d812', 2, () => ({ kind: 'reference-point', mode: 'current-position' })],
  ['d800', 2, () => ({ kind: 'start-process' })],
  ['e601', 2, () => ({ kind: 'set-absolute' })],
  ['f0', 1, () => record('reference-point-set', [])],
  ['f102', 3, (c) => record('block-cutting', [byteAt(c, 2)])],
  ['e706', 12, (c) => record('feed-repeat', [coordAt(c, 2), coordAt(c, 7)])],
  ['e738', 3, (c) => record('feed-auto-pause', [byteAt(c, 2)])],
  ['e703', 12, jobBounds],
  ['e707', 12, jobBounds],
  ['e750', 12, jobBounds],
  ['e751', 12, jobBounds],
  ['e704', 16, (c) => record('process-repeat', int14sAt(c, 2, 7))],
  ['e705', 3, (c) => record('array-direction', [byteAt(c, 2)])],
  ['c904', 8, (c) => ({ kind: 'part-speed', part: byteAt(c, 2), mmPerMin: mmPerMinAt(c, 3) })],
  ['c631', 5, (c) => partPower(c, 1, 'min')],
  ['c632', 5, (c) => partPower(c, 1, 'max')],
  ['c641', 5, (c) => partPower(c, 2, 'min')],
  ['c642', 5, (c) => partPower(c, 2, 'max')],
  ['ca06', 8, (c) => ({ kind: 'part-color', part: byteAt(c, 2), packed: coordAt(c, 3) })],
  ['ca41', 4, (c) => record('part-work-mode', [byteAt(c, 2), byteAt(c, 3)])],
  ['e752', 13, partBounds],
  ['e753', 13, partBounds],
  ['e761', 13, partBounds],
  ['e762', 13, partBounds],
  ['ca22', 3, (c) => record('max-layer-part', [byteAt(c, 2)])],
  ['e754', 8, (c) => record('pen-offset', [byteAt(c, 2), coordAt(c, 3)])],
  ['e755', 8, (c) => record('layer-offset', [byteAt(c, 2), coordAt(c, 3)])],
  ['f103', 12, (c) => record('display-offset', [coordAt(c, 2), coordAt(c, 7)])],
  ['e70a', 7, (c) => record('feed-info', [coordAt(c, 2)])],
  ['ea', 2, (c) => ({ kind: 'array-start', index: byteAt(c, 1) })],
  ['e760', 3, (c) => record('current-element-index', [byteAt(c, 2)])],
  ['e70b', 3, (c) => record('array-mirror-cut', [byteAt(c, 2)])],
  ['e713', 12, (c) => record('array-min-point', [coordAt(c, 2), coordAt(c, 7)])],
  ['e717', 12, (c) => record('array-max-point', [coordAt(c, 2), coordAt(c, 7)])],
  ['e723', 12, (c) => record('array-add', [coordAt(c, 2), coordAt(c, 7)])],
  ['e724', 3, (c) => record('array-mirror', [byteAt(c, 2)])],
  ['e708', 16, (c) => record('array-repeat', int14sAt(c, 2, 7))],
  ['ca02', 3, (c) => ({ kind: 'select-layer', layer: byteAt(c, 2) })],
  ['ca0110', 3, () => record('laser-device-0', [])],
  ['ca0113', 3, () => ({ kind: 'air-assist', on: true })],
  ['ca0112', 3, () => ({ kind: 'air-assist', on: false })],
  ['c902', 7, (c) => ({ kind: 'layer-speed', mmPerMin: mmPerMinAt(c, 2) })],
  ['c612', 7, (c) => record('laser-on-delay', [coordAt(c, 2)])],
  ['c613', 7, (c) => record('laser-off-delay', [coordAt(c, 2)])],
  ['c601', 4, (c) => layerPower(c, 1, 'min')],
  ['c602', 4, (c) => layerPower(c, 1, 'max')],
  ['c621', 4, (c) => layerPower(c, 2, 'min')],
  ['c622', 4, (c) => layerPower(c, 2, 'max')],
  ['ca03', 3, (c) => record('laser-tube-start', [byteAt(c, 2)])],
  ['e700', 2, () => ({ kind: 'block-end' })],
  ['ca0100', 3, () => ({ kind: 'layer-end' })],
  ['ca0130', 3, () => record('laser2-offset-off', [])],
  ['e505', 7, (c) => ({ kind: 'file-sum', value: coordAt(c, 2) })],
  ['d7', 1, () => ({ kind: 'file-end' })],
];

const SPEC_BY_PREFIX = new Map(SPECS.map((spec) => [spec[0], spec] as const));

export function decodeRdStream(bytes: Uint8Array): ReadonlyArray<RdDecodedEvent> {
  return splitRdCommands(bytes).map(decodeCommand);
}

/** The unswizzled commands, split where meerk40t's parse_commands splits. */
export function splitRdCommands(bytes: Uint8Array): ReadonlyArray<Command> {
  const commands: number[][] = [];
  for (const byte of unswizzleBytes(bytes)) {
    const current = commands.at(-1);
    if (byte >= 0x80 || current === undefined) commands.push([byte]);
    else current.push(byte);
  }
  return commands;
}

/** meerk40t write_tail's file sum: every unswizzled byte before the E5 05
 *  command, plus the 0xD7 End Of File byte that follows it. */
export function expectedRdFileSum(bytes: Uint8Array): number {
  let sum = 0xd7;
  for (const command of splitRdCommands(bytes)) {
    if (command[0] === 0xe5 && command[1] === 0x05) return sum;
    for (const byte of command) sum += byte;
  }
  throw new Error('no E5 05 file sum in the stream');
}

export type RdLayerBodySettings = {
  readonly mmPerMin: number | null;
  readonly minPercent: number | null;
  readonly maxPercent: number | null;
  readonly airAssist: boolean | null;
};

/** The speed, laser-1 power and air each layer body sets after its CA 02
 *  Layer Number and before its first move — what the layer actually runs at. */
export function layerBodySettings(
  events: ReadonlyArray<RdDecodedEvent>,
): ReadonlyMap<number, RdLayerBodySettings> {
  const result = new Map<number, RdLayerBodySettings>();
  let layer: number | null = null;
  let current = EMPTY_BODY;
  for (const event of events) {
    if (event.kind === 'select-layer') {
      layer = event.layer;
      current = EMPTY_BODY;
    } else if (layer !== null && !result.has(layer)) {
      if (event.kind === 'move' || event.kind === 'cut') result.set(layer, current);
      else current = withBodyEvent(current, event);
    }
  }
  return result;
}

const EMPTY_BODY: RdLayerBodySettings = {
  mmPerMin: null,
  minPercent: null,
  maxPercent: null,
  airAssist: null,
};

function withBodyEvent(current: RdLayerBodySettings, event: RdDecodedEvent): RdLayerBodySettings {
  if (event.kind === 'layer-speed') return { ...current, mmPerMin: event.mmPerMin };
  if (event.kind === 'air-assist') return { ...current, airAssist: event.on };
  if (event.kind !== 'layer-power' || event.laser !== 1) return current;
  return event.bound === 'min'
    ? { ...current, minPercent: event.percent }
    : { ...current, maxPercent: event.percent };
}

function decodeCommand(command: Command): RdDecodedEvent {
  for (const prefixLength of [3, 2, 1]) {
    const spec = SPEC_BY_PREFIX.get(hex(command.slice(0, prefixLength)));
    if (spec === undefined) continue;
    return command.length === spec[1] ? spec[2](command) : { kind: 'unknown', bytes: command };
  }
  return { kind: 'unknown', bytes: command };
}

function record(name: RdRecordName, values: ReadonlyArray<number>): RdDecodedEvent {
  return { kind: 'record', name, values };
}

function jobBounds(c: Command): RdDecodedEvent {
  return { kind: 'job-bounds', tag: byteAt(c, 1), xMm: mm(c, 2), yMm: mm(c, 7) };
}

function partBounds(c: Command): RdDecodedEvent {
  return {
    kind: 'part-bounds',
    part: byteAt(c, 2),
    tag: byteAt(c, 1),
    xMm: mm(c, 3),
    yMm: mm(c, 8),
  };
}

function partPower(c: Command, laser: RdLaser, bound: RdPowerBound): RdDecodedEvent {
  return { kind: 'part-power', part: byteAt(c, 2), laser, bound, percent: percentAt(c, 3) };
}

function layerPower(c: Command, laser: RdLaser, bound: RdPowerBound): RdDecodedEvent {
  return { kind: 'layer-power', laser, bound, percent: percentAt(c, 2) };
}

function byteAt(c: Command, at: number): number {
  return c[at] ?? 0;
}

function coordAt(c: Command, at: number): number {
  return decodeCoord35(c.slice(at, at + 5));
}

function mm(c: Command, at: number): number {
  return coordAt(c, at) / 1000;
}

function mmPerMinAt(c: Command, at: number): number {
  return (coordAt(c, at) / 1000) * 60;
}

function percentAt(c: Command, at: number): number {
  return decodePower14(c.slice(at, at + 2));
}

/** meerk40t decode14: two's complement inside 14 bits. */
function int14sAt(c: Command, at: number, count: number): ReadonlyArray<number> {
  return Array.from({ length: count }, (_, i) => {
    const raw = (byteAt(c, at + 2 * i) << 7) | byteAt(c, at + 2 * i + 1);
    return raw > 0x1fff ? raw - 0x4000 : raw;
  });
}

function hex(bytes: Command): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}
