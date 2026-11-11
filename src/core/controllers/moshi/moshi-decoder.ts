// Moshi program decoder (ADR-705): reads program bytes back into the moves and
// laser states a board would run, following MeerK40t's MoshiBuilder.debug
// (meerk40t/moshi/builder.py L555-683 at d511944e, MIT) for each command's
// length and fields. The simulator runs what this returns, and the encoder's
// goldens are checked through it. Positions are absolute native units (mils).

import {
  MOSHI_CUT_ABS,
  MOSHI_CUT_HORIZ,
  MOSHI_CUT_VERT,
  MOSHI_MOVE_ABS,
  MOSHI_MOVE_HORIZ,
  MOSHI_MOVE_VERT,
  MOSHI_RASTER_SPEED,
  MOSHI_SET_OFFSET,
  MOSHI_TERMINATION,
  MOSHI_VECTOR_SPEED,
  moshiCommandOf,
} from './moshi-swizzle';

export type MoshiDecodedStep = { readonly x: number; readonly y: number; readonly cut: boolean };

export type MoshiDecodedProgram = {
  readonly mode: 'vector' | 'raster';
  /** Vector: cut speed mm/s; raster: speed in cm/s. */
  readonly speed: number;
  /** Vector travel ("normal") speed in mm/s; null for a raster program. */
  readonly normalSpeed: number | null;
  readonly offset: { readonly x: number; readonly y: number };
  readonly steps: ReadonlyArray<MoshiDecodedStep>;
  readonly terminationBytes: number;
};

export type MoshiDecodeResult =
  | { readonly ok: true; readonly program: MoshiDecodedProgram }
  | { readonly ok: false; readonly error: string };

type Cursor = {
  readonly bytes: Uint8Array;
  pos: number;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
};

const COMMAND_LENGTH: Readonly<Record<number, number>> = {
  [MOSHI_VECTOR_SPEED]: 3,
  [MOSHI_RASTER_SPEED]: 2,
  [MOSHI_SET_OFFSET]: 7,
  [MOSHI_CUT_ABS]: 5,
  [MOSHI_MOVE_ABS]: 5,
  [MOSHI_MOVE_HORIZ]: 3,
  [MOSHI_MOVE_VERT]: 3,
  [MOSHI_CUT_HORIZ]: 3,
  [MOSHI_CUT_VERT]: 3,
  [MOSHI_TERMINATION]: 1,
};

export function decodeMoshiProgram(bytes: Uint8Array): MoshiDecodeResult {
  const header = decodeHeader(bytes);
  if (typeof header === 'string') return { ok: false, error: header };
  const cursor: Cursor = { bytes, pos: header.length, x: 0, y: 0, offsetX: 0, offsetY: 0 };
  if (moshiCommandOf(bytes[cursor.pos] ?? 0) !== MOSHI_SET_OFFSET)
    return { ok: false, error: 'the speed header is not followed by Set Offset' };
  const steps: MoshiDecodedStep[] = [];
  let terminationBytes = 0;
  while (cursor.pos < bytes.length) {
    const command = moshiCommandOf(bytes[cursor.pos] ?? 0);
    const length = COMMAND_LENGTH[command];
    if (length === undefined)
      return { ok: false, error: `unknown command ${command} at byte ${cursor.pos}` };
    if (cursor.pos + length > bytes.length)
      return { ok: false, error: `command ${command} cut off at byte ${cursor.pos}` };
    if (terminationBytes > 0 && command !== MOSHI_TERMINATION)
      return { ok: false, error: `command ${command} after termination at byte ${cursor.pos}` };
    if (command === MOSHI_TERMINATION) terminationBytes += 1;
    else applyCommand(cursor, command, steps);
    cursor.pos += length;
  }
  return {
    ok: true,
    program: {
      mode: header.mode,
      speed: header.speed,
      normalSpeed: header.normalSpeed,
      offset: { x: cursor.offsetX, y: cursor.offsetY },
      steps,
      terminationBytes,
    },
  };
}

function decodeHeader(
  bytes: Uint8Array,
):
  | { mode: 'vector' | 'raster'; speed: number; normalSpeed: number | null; length: number }
  | string {
  const command = moshiCommandOf(bytes[0] ?? 0);
  if (bytes.length >= 3 && command === MOSHI_VECTOR_SPEED)
    return {
      mode: 'vector',
      speed: (bytes[1] ?? 0) + 1,
      normalSpeed: (bytes[2] ?? 0) + 1,
      length: 3,
    };
  if (bytes.length >= 2 && command === MOSHI_RASTER_SPEED)
    return { mode: 'raster', speed: (bytes[1] ?? 0) + 1, normalSpeed: null, length: 2 };
  return 'a program must start with a vector or raster speed header';
}

function int16At(bytes: Uint8Array, at: number): number {
  const word = (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
  return word >= 0x8000 ? word - 0x10000 : word;
}

function applyCommand(cursor: Cursor, command: number, steps: MoshiDecodedStep[]): void {
  const { bytes, pos } = cursor;
  switch (command) {
    case MOSHI_SET_OFFSET:
      cursor.offsetX = int16At(bytes, pos + 3);
      cursor.offsetY = int16At(bytes, pos + 5);
      return;
    case MOSHI_CUT_ABS:
    case MOSHI_MOVE_ABS:
      cursor.x = int16At(bytes, pos + 1) + cursor.offsetX;
      cursor.y = int16At(bytes, pos + 3) + cursor.offsetY;
      break;
    case MOSHI_MOVE_HORIZ:
    case MOSHI_CUT_HORIZ:
      cursor.x = int16At(bytes, pos + 1) + cursor.offsetX;
      break;
    case MOSHI_MOVE_VERT:
    case MOSHI_CUT_VERT:
      cursor.y = int16At(bytes, pos + 1) + cursor.offsetY;
      break;
    default:
      return;
  }
  const cut =
    command === MOSHI_CUT_ABS || command === MOSHI_CUT_HORIZ || command === MOSHI_CUT_VERT;
  steps.push({ x: cursor.x, y: cursor.y, cut });
}
