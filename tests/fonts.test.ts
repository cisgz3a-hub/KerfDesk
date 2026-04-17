import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFontBuffer } from '../src/fonts/loadFont';
import { textToPathOpentype } from '../src/fonts/textToPathOpentype';
import type { TextGeometry } from '../src/core/scene/SceneObject';

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.error(`  ✗ ${message}`); }
}

console.log('\n=== Fonts: Inter glyph outlines ===');

const ttfPath = join(process.cwd(), 'public', 'fonts', 'Inter-Regular.ttf');
const buffer = readFileSync(ttfPath);
const font = parseFontBuffer(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));

assert(font != null, 'Inter Regular parsed from TTF');
assert(font.unitsPerEm > 0, 'Font reports unitsPerEm');

const geom: TextGeometry = {
  type: 'text',
  text: 'Hi',
  fontFamily: 'Inter',
  fontSize: 10,
};

const subPaths = textToPathOpentype(geom, font);

assert(subPaths.length >= 2, `At least 2 subpaths for "Hi" (got ${subPaths.length})`);
assert(subPaths.every(sp => sp.segments.length > 0), 'Every subpath has segments');
assert(subPaths.every(sp => sp.segments[0].type === 'move'), 'Every subpath starts with a move');

let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
for (const sp of subPaths) {
  for (const seg of sp.segments) {
    if (seg.type === 'close') continue;
    const p = seg.to;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
}
assert(minX >= -1 && maxX <= 15, `X range plausible (${minX.toFixed(2)} to ${maxX.toFixed(2)} mm)`);
assert(maxY - minY >= 5 && maxY - minY <= 12, `Height plausible (${(maxY - minY).toFixed(2)} mm for 10mm font)`);

assert(textToPathOpentype({ ...geom, text: '' }, font).length === 0, 'Empty text returns empty');
assert(textToPathOpentype({ ...geom, fontSize: 0 }, font).length === 0, 'Zero fontSize returns empty');

// End-to-end dispatcher-level coverage for textGeometryToPath is browser-side
// because canvas fallback needs document.createElement in runtime.
// Here we validate the deterministic raw opentype origin to aid normalization checks.
const normalized = subPaths;
let nMinX = Infinity;
let nMinY = Infinity;
for (const sp of normalized) {
  for (const seg of sp.segments) {
    if (seg.type === 'close') continue;
    if (seg.to.x < nMinX) nMinX = seg.to.x;
    if (seg.to.y < nMinY) nMinY = seg.to.y;
  }
}
console.log(`  ℹ raw opentype origin: (${nMinX.toFixed(2)}, ${nMinY.toFixed(2)})`);

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
