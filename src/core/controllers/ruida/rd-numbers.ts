// Ruida number encodings. Data bytes must stay below 0x80 (the high bit marks
// command bytes), so values are packed 7 bits per byte, big-endian:
//   - coordinates/speeds: 35-bit (5 bytes) in micrometres (µm) / µm-per-second
//   - power: 14-bit (2 bytes), 0..16383 == 0..100%
// Per public .rd decoders; round-trip tested for internal consistency.

const COORD_BYTES = 5;
const COORD_BITS = 35;
const POWER_MAX_14 = 16383;

/** Encode an absolute coordinate in µm as 5 × 7-bit bytes (two's complement
 *  inside 35 bits for negative values). */
export function encodeCoord35(valueUm: number): ReadonlyArray<number> {
  const clamped = Math.round(valueUm);
  const wrapped = clamped < 0 ? clamped + 2 ** COORD_BITS : clamped;
  const out: number[] = [];
  for (let i = COORD_BYTES - 1; i >= 0; i -= 1) {
    out.push(Math.floor(wrapped / 128 ** i) % 128);
  }
  return out;
}

export function decodeCoord35(bytes: ReadonlyArray<number>): number {
  let value = 0;
  for (const byte of bytes) value = value * 128 + (byte & 0x7f);
  const limit = 2 ** COORD_BITS;
  return value >= limit / 2 ? value - limit : value;
}

/** Encode a power percentage (0..100) as the 14-bit Ruida scale. */
export function encodePower14(percent: number): ReadonlyArray<number> {
  const clamped = Math.max(0, Math.min(100, percent));
  const raw = Math.round((clamped / 100) * POWER_MAX_14);
  return [(raw >> 7) & 0x7f, raw & 0x7f];
}

export function decodePower14(bytes: ReadonlyArray<number>): number {
  const raw = ((bytes[0] ?? 0) & 0x7f) * 128 + ((bytes[1] ?? 0) & 0x7f);
  return (raw / POWER_MAX_14) * 100;
}

/** mm → µm for coordinate encoding. */
export function mmToUm(mm: number): number {
  return Math.round(mm * 1000);
}

/** mm/min (the app's feed unit) → µm/s (Ruida's speed unit). */
export function mmPerMinToUmPerSec(mmPerMin: number): number {
  return Math.round((mmPerMin / 60) * 1000);
}
