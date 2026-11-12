// Ruida byte scrambling ("swizzle"). Every payload byte in .rd files and UDP
// packets is scrambled with this reversible transform (magic 0x88 for RDC644x
// class controllers). swizzleByte and unswizzleByte follow MeerK40t's
// swizzle_byte and unswizzle_byte (MIT, meerk40t/ruida/rdjob.py at 7e82652f)
// statement for statement; attribution in docs/licensing/meerk40t-ruida.txt.
// NOT hardware-verified in this repo; the unswizzle inverse is property-tested
// so at minimum the encoder/decoder pair is internally consistent.

export const RUIDA_SWIZZLE_MAGIC = 0x88;

export function swizzleByte(value: number, magic: number = RUIDA_SWIZZLE_MAGIC): number {
  let b = value & 0xff;
  b ^= (b >> 7) & 0xff;
  b ^= (b << 7) & 0xff;
  b ^= (b >> 7) & 0xff;
  b ^= magic;
  b = (b + 1) & 0xff;
  return b;
}

export function unswizzleByte(value: number, magic: number = RUIDA_SWIZZLE_MAGIC): number {
  let b = (value - 1) & 0xff;
  b ^= magic;
  b ^= (b >> 7) & 0xff;
  b ^= (b << 7) & 0xff;
  b ^= (b >> 7) & 0xff;
  return b & 0xff;
}

export function swizzleBytes(
  payload: ReadonlyArray<number> | Uint8Array,
  magic: number = RUIDA_SWIZZLE_MAGIC,
): Uint8Array {
  const out = new Uint8Array(payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    // noUncheckedIndexedAccess: Uint8Array/number[] reads are number|undefined.
    out[i] = swizzleByte(payload[i] ?? 0, magic);
  }
  return out;
}

export function unswizzleBytes(
  payload: Uint8Array,
  magic: number = RUIDA_SWIZZLE_MAGIC,
): Uint8Array {
  const out = new Uint8Array(payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    out[i] = unswizzleByte(payload[i] ?? 0, magic);
  }
  return out;
}
