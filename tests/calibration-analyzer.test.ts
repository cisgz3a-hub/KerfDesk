import {
  analyzeCalibrationPhoto,
  type AnalyzePhotoInput,
} from '../src/core/materials/CalibrationAnalyzer';
import { type CalibrationGridResult } from '../src/core/materials/CalibrationGrid';

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function approx(a: number, b: number, eps = 1e-3): boolean {
  return Math.abs(a - b) <= eps;
}

function makeGrid(powers: number[]): CalibrationGridResult {
  const squares = powers.map((p, i) => ({
    index: i,
    commandedPower: p,
    bounds: { x: i * 10, y: 0, width: 10, height: 10 },
  }));
  return { objects: [], layers: [], squares };
}

function paintRect(
  data: Uint8ClampedArray,
  imageWidth: number,
  rect: { x: number; y: number; width: number; height: number },
  gray: number,
): void {
  const x0 = Math.floor(rect.x);
  const y0 = Math.floor(rect.y);
  const x1 = Math.ceil(rect.x + rect.width);
  const y1 = Math.ceil(rect.y + rect.height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * imageWidth + x) * 4;
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
      data[i + 3] = 255;
    }
  }
}

function buildPhoto(width: number, height: number, roi: { x: number; y: number; width: number; height: number }, grays: number[]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  const sw = roi.width / grays.length;
  for (let i = 0; i < grays.length; i++) {
    paintRect(data, width, { x: roi.x + i * sw, y: roi.y, width: sw, height: roi.height }, grays[i]);
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

console.log('\n=== CalibrationAnalyzer: synthetic darkness fit ===');
{
  const roi = { x: 0, y: 0, width: 1000, height: 100 };
  const input: AnalyzePhotoInput = {
    photo: buildPhoto(1000, 100, roi, [255, 200, 120, 30]),
    roi,
    grid: makeGrid([10, 40, 70, 100]),
    calibrationSpeed: 3000,
    materialName: 'Test Wood',
  };
  const out = analyzeCalibrationPhoto(input);
  assert(out.ok, 'analyzeCalibrationPhoto succeeds on synthetic image');
  if (out.ok) {
    assert(out.curve.points.length === 4, 'curve has expected number of points');
    assert(approx(out.curve.points[0].observedDarkness, 0), 'first point darkness near expected');
    assert(approx(out.curve.points[3].observedDarkness, 1 - 30 / 255), 'last point darkness near expected');
  }
}

console.log('\n=== CalibrationAnalyzer: ROI offset mapping ===');
{
  const roi = { x: 200, y: 40, width: 600, height: 120 };
  const input: AnalyzePhotoInput = {
    photo: buildPhoto(1000, 240, roi, [240, 180, 120, 60]),
    roi,
    grid: makeGrid([5, 35, 65, 95]),
    calibrationSpeed: 2800,
    materialName: 'Offset Material',
  };
  const out = analyzeCalibrationPhoto(input);
  assert(out.ok, 'analyze succeeds with ROI offset from origin');
  if (out.ok) {
    assert(approx(out.measurements[1].meanLuminance, 180, 1), 'mapped square luminance matches expected ROI stripe');
  }
}

console.log('\n=== CalibrationAnalyzer: non-monotonic points dropped ===');
{
  const originalWarn = console.warn;
  let warnCount = 0;
  console.warn = () => { warnCount++; };
  const roi = { x: 0, y: 0, width: 1000, height: 100 };
  const out = analyzeCalibrationPhoto({
    photo: buildPhoto(1000, 100, roi, [250, 40, 220, 30, 20]),
    roi,
    grid: makeGrid([10, 30, 50, 70, 90]),
    calibrationSpeed: 3000,
    materialName: 'Warn Material',
  });
  console.warn = originalWarn;
  assert(out.ok, 'still succeeds when at least three monotonic points remain');
  assert(warnCount >= 1, 'logs warning for dropped non-monotonic point');
}

console.log('\n=== CalibrationAnalyzer: fails with <3 monotonic points ===');
{
  const roi = { x: 0, y: 0, width: 600, height: 100 };
  const out = analyzeCalibrationPhoto({
    photo: buildPhoto(600, 100, roi, [250, 30, 240, 220]),
    roi,
    grid: makeGrid([10, 40, 70, 100]),
    calibrationSpeed: 3000,
    materialName: 'Bad Material',
  });
  assert(!out.ok, 'returns error when fewer than 3 monotonic points survive');
}

console.log('\n=== CalibrationAnalyzer: validateCurve failure bubbles ===');
{
  const roi = { x: 0, y: 0, width: 1000, height: 100 };
  const out = analyzeCalibrationPhoto({
    photo: buildPhoto(1000, 100, roi, [230, 200, 160, 120]),
    roi,
    grid: makeGrid([10, 40, 70, 100]),
    calibrationSpeed: 0,
    materialName: 'Invalid Speed',
  });
  assert(!out.ok, 'returns error on validateCurve failure (invalid calibrationSpeed)');
}

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) throw new Error(`calibration-analyzer.test.ts: ${failed} assertion(s) failed`);
process.exit(0);
