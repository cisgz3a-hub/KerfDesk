import { createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { benchmarkImage, benchmarkSvg } from './large-file-benchmark-cases.mjs';
import { benchmarkPng, benchmarkRgbaPng } from './large-file-benchmark-png.mjs';
import { inflateSync } from 'node:zlib';

test('version-1 SVG fixture contains 50,000 deterministic closed paths on a fixed bed', () => {
  const svg = benchmarkSvg();
  assert.equal((svg.match(/<path /g) ?? []).length, 50000);
  assert.ok(svg.includes('width="250mm" height="200mm"'));
  assert.ok(Buffer.byteLength(svg) > 3_000_000);
  assert.equal(svg, benchmarkSvg());
  assert.equal(
    createHash('sha256').update(svg).digest('hex'),
    '00f845086323e7096435aa75c1dfe7018c215458da9f910dc4e09f68a8860757',
  );
});
test('canonical original PNG is pinned and decodes to the same opaque binary pixels', () => {
  const image = benchmarkImage(),
    png = benchmarkPng(image);
  assert.equal(png.length, 2101476);
  assert.equal(
    createHash('sha256').update(png).digest('hex'),
    'b865fcd733410318112d2cd2ebc5beb31161971f2a105aabb0fe207390a72a0d',
  );
  const view = new DataView(png.buffer);
  const idatOffset = 33,
    length = view.getUint32(idatOffset);
  const rows = inflateSync(png.subarray(idatOffset + 8, idatOffset + 8 + length));
  assert.equal(rows.length, 513 * 4096);
  for (let y = 0; y < 4096; y += 1) {
    assert.equal(rows[y * 513], 0);
    for (let x = 0; x < 4096; x += 1) {
      const white = (rows[y * 513 + 1 + (x >> 3)] >> (7 - (x & 7))) & 1;
      assert.equal(white * 255, image.data[(y * 4096 + x) * 4]);
    }
  }
});
test('large canonical RGBA PNG crosses page-backing with the exact same original pixels', () => {
  const image = benchmarkImage(),
    png = benchmarkRgbaPng(image);
  assert.equal(png.length, 67118148);
  assert.equal(
    createHash('sha256').update(png).digest('hex'),
    '9e83e688498e9496b7f5d14e9c40dd2de246a909dac64a7958cdc1ce71d2b9d1',
  );
  const view = new DataView(png.buffer),
    length = view.getUint32(33);
  const rows = inflateSync(png.subarray(41, 41 + length)),
    stride = 4096 * 4 + 1;
  const decoded = createHash('sha256');
  for (let y = 0; y < 4096; y += 1) {
    assert.equal(rows[y * stride], 0);
    decoded.update(rows.subarray(y * stride + 1, (y + 1) * stride));
  }
  assert.equal(
    decoded.digest('hex'),
    '1532db902d9fafd00abf879e9cf79dc7666ee1a00699170a0acb4d91dc2d26e1',
  );
});
test('version-1 raster fixture preserves opaque white, solid, ring and fine-line regions', () => {
  const image = benchmarkImage();
  const pixel = (x, y) => [...image.data.slice((y * 4096 + x) * 4, (y * 4096 + x) * 4 + 4)];
  assert.equal(image.width, 4096);
  assert.equal(image.height, 4096);
  assert.equal(image.data.byteLength, 64 * 1024 * 1024);
  assert.deepEqual(pixel(0, 0), [255, 255, 255, 255]);
  assert.deepEqual(pixel(1200, 1200), [0, 0, 0, 255]);
  assert.deepEqual(pixel(2850, 2650), [255, 255, 255, 255]);
  assert.deepEqual(pixel(3270, 2650), [0, 0, 0, 255]);
  assert.deepEqual(pixel(500, 250), [0, 0, 0, 255]);
  assert.equal(
    createHash('sha256').update(image.data).digest('hex'),
    '1532db902d9fafd00abf879e9cf79dc7666ee1a00699170a0acb4d91dc2d26e1',
  );
});
