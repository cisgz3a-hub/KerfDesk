/**
 * LightBurn-derived preview safety regression:
 * laser-off linear moves (M5 or S0) must not be previewed as cutting.
 *
 * Run: npx tsx tests/gcode-preview-laser-state.test.ts
 */
import assert from 'node:assert/strict';

async function run(): Promise<void> {
  const { buildGcodePreviewModel } = await import('../src/ui/components/gcodePreviewModel');

  const model = buildGcodePreviewModel([
    'G21',
    'G90',
    'G0 X1 Y0',
    'M4 S500',
    'G1 X11 Y0 F1000',
    'G1 X21 Y0 S0',
    'G1 X31 Y0 S500',
    'M5',
    'G1 X41 Y0 F1000',
    'G0 X51 Y0 ; M3 S900 is only a comment',
    'G1 X61 Y0 (M4 S1000 comment only)',
  ].join('\n'));

  assert.deepEqual(
    model.moves.map(move => move.type),
    ['rapid', 'cut', 'travel', 'cut', 'travel', 'rapid', 'travel'],
    'preview model separates rapid travel, laser-on cuts, and laser-off linear travel',
  );
  assert.equal(model.cutCount, 2, 'only laser-on linear moves count as cuts');
  assert.equal(model.travelCount, 5, 'rapid and laser-off linear moves count as travel');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
