// EZCad lens correction (.cor) files (ADR-704), read as MeerK40t reads them
// (balormk/controller.py L1056-1141 at d511944e). A file opens with an
// 0x16-byte UTF-16 label. "LMC1COR_1.0" files carry a further 0x1FA header
// bytes and then 65 × 65 pairs of float64 offsets; any other label carries 0xE
// header bytes and 65 × 65 pairs of signed int32 offsets. Each offset is
// rounded (Python round: halves to even), a negative one becomes its magnitude
// plus 0x8000, and the result is masked to 16 bits. The board receives the
// table at connect: Write Cor Table 1, then one Write Cor Line per pair whose
// third word is 0 for the first pair and 1 after (L1135-1141).

import { roundHalfEven } from './lmc-units';

export const COR_TABLE_SIDE = 65;
export const COR_TABLE_ENTRIES = COR_TABLE_SIDE * COR_TABLE_SIDE;

const LABEL_BYTES = 0x16;
const FLOAT_LABEL = 'LMC1COR_1.0';
const FLOAT_HEADER_BYTES = 0x1fa;
const INT_HEADER_BYTES = 0xe;

/** The 4225 (dx, dy) words the board takes, row by row. */
export type LmcCorrectionTable = ReadonlyArray<readonly [number, number]>;

export type CorFileResult =
  | { readonly ok: true; readonly table: LmcCorrectionTable; readonly format: 'float' | 'int' }
  | { readonly ok: false; readonly reason: string };

export function readCorFile(bytes: Uint8Array): CorFileResult {
  if (bytes.byteLength < LABEL_BYTES)
    return { ok: false, reason: 'The file is too short to be an EZCad .cor file.' };
  const label = utf16leLabel(bytes.subarray(0, LABEL_BYTES));
  const float = label === FLOAT_LABEL;
  const start = LABEL_BYTES + (float ? FLOAT_HEADER_BYTES : INT_HEADER_BYTES);
  const entryBytes = float ? 16 : 8;
  const needed = start + COR_TABLE_ENTRIES * entryBytes;
  if (bytes.byteLength < needed)
    return {
      ok: false,
      reason: `The .cor file holds ${bytes.byteLength} bytes; a 65 × 65 ${float ? 'float' : 'integer'} table needs ${needed}.`,
    };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const table: Array<readonly [number, number]> = [];
  for (let entry = 0; entry < COR_TABLE_ENTRIES; entry += 1) {
    const at = start + entry * entryBytes;
    const dx = float ? view.getFloat64(at, true) : view.getInt32(at, true);
    const dy = float ? view.getFloat64(at + 8, true) : view.getInt32(at + 4, true);
    if (!Number.isFinite(dx) || !Number.isFinite(dy))
      return { ok: false, reason: `Entry ${entry} of the .cor table is not a finite number.` };
    table.push([corWord(dx), corWord(dy)]);
  }
  return { ok: true, table, format: float ? 'float' : 'int' };
}

function corWord(offset: number): number {
  const rounded = roundHalfEven(offset);
  return (rounded >= 0 ? rounded : -rounded + 0x8000) & 0xffff;
}

function utf16leLabel(bytes: Uint8Array): string {
  let label = '';
  for (let at = 0; at + 1 < bytes.byteLength; at += 2) {
    const code = (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
    label += String.fromCharCode(code);
  }
  return label;
}
