/**
 * T3-14: Huge G-code previews should not store or render every move.
 * The preview model keeps enough sampled geometry for visual inspection while
 * avoiding the million-move canvas loops that make the modal unusable.
 *
 * Run: npx tsx tests/gcode-preview-large-job-sampling.test.ts
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

console.log('\n=== T3-14 sampled G-code preview ===\n');

const previewSource = readFileSync('src/ui/components/GcodePreview.tsx', 'utf8');
assert.match(previewSource, /buildGcodePreviewModel/, 'GcodePreview uses the sampled preview model');
assert.doesNotMatch(previewSource, /gcode\.split\(['"`]\\n['"`]\)/, 'GcodePreview no longer splits the whole file into an array');
assert.match(previewSource, /sampledLineStep|sampledMoveStep|isSampled/, 'GcodePreview surfaces sampled-preview state');

assert(
  existsSync('src/ui/components/gcodePreviewModel.ts'),
  'pure gcodePreviewModel helper exists for large-preview tests',
);

function hugeGcode(moveCount: number): string {
  const lines = ['G21', 'G90', 'G0 X0 Y0', 'M4 S500'];
  for (let i = 1; i <= moveCount; i++) {
    lines.push(`G1 X${i} Y${i % 200} F1200`);
  }
  lines.push('M5 S0', 'M2');
  return lines.join('\n');
}

async function run(): Promise<void> {
  const { buildGcodePreviewModel, DEFAULT_MAX_PREVIEW_MOVES } = await import('../src/ui/components/gcodePreviewModel');

  const largeModel = buildGcodePreviewModel(hugeGcode(120_000));
  assert(largeModel.isSampled, '120k-move preview is sampled');
  assert(largeModel.moves.length <= DEFAULT_MAX_PREVIEW_MOVES, 'stored preview moves stay under the render cap');
  assert(largeModel.sampledMoveStep > 1, 'large preview uses an adaptive move stride');
  assert.equal(largeModel.totalMoveCount, 120_001, 'model still reports the full motion count');
  assert(largeModel.cutCount > 0, 'sampled model keeps cut moves visible');
  assert(largeModel.totalDuration > 0, 'sampled model keeps duration estimate');

  const smallModel = buildGcodePreviewModel('G21\nG90\nG0 X0 Y0\nG1 X10 Y0 F1000\nG1 X10 Y10\n');
  assert(!smallModel.isSampled, 'small preview is not sampled');
  assert.equal(smallModel.moves.length, 3, 'small preview keeps every move');
  assert.equal(smallModel.sampledMoveStep, 1, 'small preview stride is 1');

  console.log('  ok large previews are sampled and small previews stay exact');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
