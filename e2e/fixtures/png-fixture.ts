import { createDeflate, deflateSync } from 'node:zlib';
import {
  closeSync,
  createReadStream,
  createWriteStream,
  openSync,
  readSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';

export function grayscaleTracePngBase64(width = 64, height = 64): string {
  const rows = Buffer.alloc((width + 1) * height, 255);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width + 1);
    rows[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const inside =
        x >= width / 4 && x < (width * 3) / 4 && y >= height / 4 && y < (height * 3) / 4;
      rows[rowOffset + 1 + x] = inside ? 0 : 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

export function writeQualifiedPngFixture(
  path: string,
  targetBytes: number,
  width = 64,
  height = 64,
): void {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const rows = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 3 + 1);
    rows[rowOffset] = 0;
    for (let x = width / 4; x < (width * 3) / 4; x += 1) {
      if (y < height / 4 || y >= (height * 3) / 4) continue;
      rows.fill(0, rowOffset + 1 + x * 3, rowOffset + 1 + x * 3 + 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const ihdr = chunk('IHDR', header);
  const idat = chunk('IDAT', deflateSync(rows));
  const iend = chunk('IEND', Buffer.alloc(0));
  const ancillaryOverhead = 12;
  const ancillaryBytes =
    targetBytes - signature.length - ihdr.length - idat.length - iend.length - ancillaryOverhead;
  if (!Number.isSafeInteger(targetBytes) || ancillaryBytes < 0 || ancillaryBytes > 0xffffffff) {
    throw new Error('Requested PNG fixture size is outside the supported range.');
  }

  const descriptor = openSync(path, 'w');
  try {
    writeAll(descriptor, signature);
    writeAll(descriptor, ihdr);
    writeStreamingAncillaryChunk(descriptor, ancillaryBytes);
    writeAll(descriptor, idat);
    writeAll(descriptor, iend);
  } finally {
    closeSync(descriptor);
  }
}

export async function writeQualifiedLargeIdatPngFixture(
  path: string,
  targetBytes: number,
  width = 8192,
  height = 8192,
): Promise<{ readonly idatBytes: number; readonly ancillaryBytes: number }> {
  const rawPath = `${path}.raw`;
  const deflatePath = `${path}.deflate`;
  try {
    writeRawRgbRows(rawPath, width, height);
    await pipeline(
      createReadStream(rawPath),
      createDeflate({ level: 0 }),
      createWriteStream(deflatePath),
    );
    return composeLargeIdatPng(path, deflatePath, targetBytes, width, height);
  } finally {
    unlinkIfPresent(rawPath);
    unlinkIfPresent(deflatePath);
  }
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  typeBytes.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), data.length + 8);
  return result;
}

function crc32(bytes: Buffer): number {
  return finishCrc32(updateCrc32(0xffffffff, bytes));
}

function writeStreamingAncillaryChunk(descriptor: number, length: number): void {
  const typeBytes = Buffer.from('lfDa', 'ascii');
  const header = Buffer.alloc(8);
  header.writeUInt32BE(length, 0);
  typeBytes.copy(header, 4);
  writeAll(descriptor, header);
  let crc = updateCrc32(0xffffffff, typeBytes);
  const block = Buffer.alloc(Math.min(1024 * 1024, Math.max(1, length)));
  let remaining = length;
  while (remaining > 0) {
    const segment = remaining >= block.length ? block : block.subarray(0, remaining);
    writeAll(descriptor, segment);
    crc = updateCrc32(crc, segment);
    remaining -= segment.length;
  }
  const footer = Buffer.alloc(4);
  footer.writeUInt32BE(finishCrc32(crc), 0);
  writeAll(descriptor, footer);
}

function writeRawRgbRows(path: string, width: number, height: number): void {
  const descriptor = openSync(path, 'w');
  const row = Buffer.alloc(width * 3 + 1, 255);
  row[0] = 0;
  try {
    for (let y = 0; y < height; y += 1) writeAll(descriptor, row);
  } finally {
    closeSync(descriptor);
  }
}

function composeLargeIdatPng(
  path: string,
  deflatePath: string,
  targetBytes: number,
  width: number,
  height: number,
): { readonly idatBytes: number; readonly ancillaryBytes: number } {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const ihdr = chunk('IHDR', header);
  const iend = chunk('IEND', Buffer.alloc(0));
  const idatBytes = statSync(deflatePath).size;
  const ancillaryBytes =
    targetBytes - signature.length - ihdr.length - iend.length - idatBytes - 12 - 12;
  if (
    !Number.isSafeInteger(targetBytes) ||
    idatBytes > 0xffffffff ||
    ancillaryBytes < 0 ||
    ancillaryBytes > 0xffffffff
  ) {
    throw new Error('Requested large-IDAT PNG fixture size is outside the supported range.');
  }
  const descriptor = openSync(path, 'w');
  try {
    writeAll(descriptor, signature);
    writeAll(descriptor, ihdr);
    writeStreamingAncillaryChunk(descriptor, ancillaryBytes);
    writeFileBackedChunk(descriptor, 'IDAT', deflatePath, idatBytes);
    writeAll(descriptor, iend);
  } finally {
    closeSync(descriptor);
  }
  return { idatBytes, ancillaryBytes };
}

function writeFileBackedChunk(
  descriptor: number,
  type: string,
  sourcePath: string,
  length: number,
): void {
  const typeBytes = Buffer.from(type, 'ascii');
  const header = Buffer.alloc(8);
  header.writeUInt32BE(length, 0);
  typeBytes.copy(header, 4);
  writeAll(descriptor, header);
  let crc = updateCrc32(0xffffffff, typeBytes);
  const source = openSync(sourcePath, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let consumed = 0;
    while (consumed < length) {
      const read = readSync(source, buffer, 0, Math.min(buffer.length, length - consumed), null);
      if (read === 0) throw new Error(`Unexpected end of ${type} fixture data.`);
      const segment = buffer.subarray(0, read);
      writeAll(descriptor, segment);
      crc = updateCrc32(crc, segment);
      consumed += read;
    }
  } finally {
    closeSync(source);
  }
  const footer = Buffer.alloc(4);
  footer.writeUInt32BE(finishCrc32(crc), 0);
  writeAll(descriptor, footer);
}

function writeAll(descriptor: number, bytes: Buffer): void {
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset);
}

function updateCrc32(crc: number, bytes: Buffer): number {
  let next = crc;
  for (const byte of bytes) {
    next ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      next = (next >>> 1) ^ (next & 1 ? 0xedb88320 : 0);
    }
  }
  return next;
}

function finishCrc32(crc: number): number {
  return (crc ^ 0xffffffff) >>> 0;
}

function unlinkIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
}
