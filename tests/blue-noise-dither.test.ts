/**
 * T3-26: blue-noise dither mode for photo engraving.
 * Run: npx tsx tests/blue-noise-dither.test.ts
 */
import { readFileSync } from 'node:fs';
import { ditherImage, getDitherModes, type DitherMode } from '../src/import/Dithering';

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

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function filled(width: number, height: number, value: number): Uint8Array {
  return new Uint8Array(width * height).fill(value);
}

function countBurn(out: Uint8Array): number {
  let count = 0;
  for (const v of out) if (v === 255) count++;
  return count;
}

function allBinary(out: Uint8Array): boolean {
  for (const v of out) if (v !== 0 && v !== 255) return false;
  return true;
}

console.log('\n=== blue-noise dither ===\n');

{
  const modes = getDitherModes();
  assert(modes.some(mode => mode.id === 'blue-noise' && mode.name === 'Blue Noise'), 'mode list exposes Blue Noise');
}

{
  const mode: DitherMode = 'blue-noise';
  const data = filled(64, 64, 128);
  const a = ditherImage(data, 64, 64, mode, 128);
  const b = ditherImage(data, 64, 64, mode, 128);
  assert(a.length === 64 * 64, 'blue-noise output length matches input dimensions');
  assert(allBinary(a), 'blue-noise output is strictly 0/255');
  assert(arraysEqual(a, b), 'blue-noise output is deterministic');
}

{
  const black = ditherImage(filled(16, 16, 0), 16, 16, 'blue-noise', 128);
  const white = ditherImage(filled(16, 16, 255), 16, 16, 'blue-noise', 128);
  assert(countBurn(black) === 16 * 16, 'black pixels burn every cell');
  assert(countBurn(white) === 0, 'white pixels burn no cells');
}

{
  const mid = ditherImage(filled(64, 64, 128), 64, 64, 'blue-noise', 128);
  const burn = countBurn(mid);
  const ratio = burn / mid.length;
  assert(ratio > 0.45 && ratio < 0.55, `mid-gray density is close to 50% (got ${(ratio * 100).toFixed(1)}%)`);
}

{
  const data = filled(32, 32, 128);
  const blue = ditherImage(data, 32, 32, 'blue-noise', 128);
  const ordered = ditherImage(data, 32, 32, 'ordered', 128);
  const random = ditherImage(data, 32, 32, 'random', 128);
  assert(!arraysEqual(blue, ordered), 'blue-noise pattern differs from ordered Bayer');
  assert(!arraysEqual(blue, random), 'blue-noise pattern differs from random threshold');
}

{
  const ditherSource = readFileSync('src/import/Dithering.ts', 'utf8');
  const layerSource = readFileSync('src/core/scene/Layer.ts', 'utf8');
  assert(ditherSource.includes("'blue-noise'"), 'Dithering.ts declares the blue-noise mode');
  assert(ditherSource.includes('buildBlueNoiseThresholdTile'), 'blue-noise threshold tile is generated deterministically');
  assert(ditherSource.includes('BLUE_NOISE_TILE_SIZE'), 'blue-noise tile size is named and pinned');
  assert(layerSource.includes("'blue-noise'"), 'Layer DitherMode accepts blue-noise');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
