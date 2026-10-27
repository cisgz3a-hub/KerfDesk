// The CRC-32 every PNG chunk carries over its type and data (PNG 3,
// section 5.3). The streaming PNG import checks every chunk with it, and the
// EXIF Orientation reader checks eXIf with it, because Chromium ignores an
// eXIf chunk whose CRC does not match.

const CRC_TABLE = buildCrcTable();

export function startPngCrc(typeBytes: Uint8Array): number {
  return updatePngCrc(0xffffffff, typeBytes);
}

export function updatePngCrc(crc: number, bytes: Uint8Array): number {
  let next = crc;
  for (const byte of bytes) next = (CRC_TABLE[(next ^ byte) & 0xff] ?? 0) ^ (next >>> 8);
  return next;
}

export function finishPngCrc(crc: number): number {
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}
