// Canonical 1-bit grayscale PNG of the opaque binary v1 fixture. Stored DEFLATE
// blocks avoid encoder/platform-dependent compression. No input re-sampling.
export function benchmarkPng(image) {
  const stride = Math.ceil(image.width / 8);
  const raw = new Uint8Array((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4] >= 128)
        raw[y * (stride + 1) + 1 + (x >> 3)] |= 1 << (7 - (x & 7));
    }
  }
  return encodePng(image, raw, 1, 0);
}

/** Same exact original pixels, deliberately over the PNG page-backing boundary. */
export function benchmarkRgbaPng(image) {
  const stride = image.width * 4;
  const raw = new Uint8Array((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1)
    raw.set(image.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return encodePng(image, raw, 8, 6);
}

function encodePng(image, raw, bitDepth, colorType) {
  const header = new Uint8Array(13);
  const dimensions = new DataView(header.buffer);
  dimensions.setUint32(0, image.width);
  dimensions.setUint32(4, image.height);
  header[8] = bitDepth;
  header[9] = colorType;
  const pieces = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', storedZlib(raw)),
    chunk('IEND', new Uint8Array()),
  ];
  const output = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
  let offset = 0;
  for (const piece of pieces) {
    output.set(piece, offset);
    offset += piece.length;
  }
  return output;
}

function storedZlib(raw) {
  const blocks = Math.ceil(raw.length / 65535);
  const output = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  output.set([0x78, 0x01]);
  let offset = 2,
    a = 1,
    b = 0;
  for (let start = 0; start < raw.length; start += 65535) {
    const length = Math.min(65535, raw.length - start),
      final = start + length === raw.length;
    output.set(
      [final ? 1 : 0, length & 255, length >>> 8, ~length & 255, (~length >>> 8) & 255],
      offset,
    );
    offset += 5;
    output.set(raw.subarray(start, start + length), offset);
    offset += length;
    for (let i = start; i < start + length; i += 1) {
      a = (a + raw[i]) % 65521;
      b = (b + a) % 65521;
    }
  }
  new DataView(output.buffer).setUint32(offset, ((b << 16) | a) >>> 0);
  return output;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunk(type, bytes) {
  const output = new Uint8Array(12 + bytes.length);
  const view = new DataView(output.buffer);
  view.setUint32(0, bytes.length);
  output.set(new TextEncoder().encode(type), 4);
  output.set(bytes, 8);
  let crc = 0xffffffff;
  for (const byte of output.subarray(4, 8 + bytes.length))
    crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  view.setUint32(8 + bytes.length, (crc ^ 0xffffffff) >>> 0);
  return output;
}
