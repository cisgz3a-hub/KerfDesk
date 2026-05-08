/**
 * T3-25: bidirectional raster direction alternates by raw bitmap row, not emitted scanline count.
 * Run: npx tsx tests/raster-bidirectional-row-parity.test.ts
 */
import type { ProcessedBitmap } from '../src/core/job/Job';
import { generateRasterScanlines, type RasterSettings } from '../src/core/plan/RasterGenerator';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL ${msg}`);
  }
}

function assertEq(actual: unknown, expected: unknown, msg: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    console.error('expected', expected);
    console.error('actual', actual);
  }
  assert(ok, msg);
}

const settings: RasterSettings = {
  powerMin: 0,
  powerMax: 100,
  speed: 1000,
  biDirectional: true,
  overscanning: 0,
};

function makeBitmap(width: number, height: number, data: number[]): ProcessedBitmap {
  return {
    width,
    height,
    dpi: 254,
    sourceObjectId: 'row-parity',
    mode: '1bit',
    data: new Uint8Array(data),
    physicalWidth: width,
    physicalHeight: height,
    position: { x: 0, y: 0 },
    pipeline: {
      brightness: 0,
      contrast: 0,
      gamma: 1,
      ditheringMode: 'threshold',
      inverted: false,
      imageMode: 'threshold',
    },
  };
}

console.log('\n=== raster bidirectional row parity ===\n');

{
  const lines = generateRasterScanlines(
    makeBitmap(3, 3, [
      1, 1, 1,
      0, 0, 0,
      1, 1, 1,
    ]),
    settings,
  );

  assertEq(lines.map(line => line.y), [0, 2], 'empty rows are still skipped');
  assertEq(lines.map(line => line.direction), ['ltr', 'ltr'], 'rows 0 and 2 both use even-row direction');
  assertEq(
    lines.map(line => [line.segments[0].startX, line.segments[0].endX]),
    [[0, 3], [0, 3]],
    'even sparse rows keep left-to-right segment coordinates',
  );
}

{
  const lines = generateRasterScanlines(
    makeBitmap(3, 2, [
      1, 1, 1,
      1, 1, 1,
    ]),
    settings,
  );

  assertEq(lines.map(line => line.direction), ['ltr', 'rtl'], 'adjacent non-empty rows still alternate');
  assertEq(lines[1]?.segments[0]?.startX, 3, 'rtl rows still swap segment start/end');
  assertEq(lines[1]?.segments[0]?.endX, 0, 'rtl rows still swap segment end/start');
}

{
  const lines = generateRasterScanlines(
    makeBitmap(3, 2, [
      0, 0, 0,
      1, 1, 1,
    ]),
    settings,
  );

  assertEq(lines.map(line => line.y), [1], 'single odd non-empty row is emitted');
  assertEq(lines.map(line => line.direction), ['rtl'], 'row 1 uses odd-row right-to-left direction');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
