/**
 * F45-07-001: bundled text-to-path output must honor editable text layout.
 *
 * Run: npx tsx tests/text-layout-to-path.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFontBuffer } from '../src/fonts/loadFont';
import { textToPathOpentype } from '../src/fonts/textToPathOpentype';
import { textToPathHershey } from '../src/fonts/textToPathHershey';
import type { SubPath, TextGeometry } from '../src/core/scene/SceneObject';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

function boundsOf(paths: SubPath[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const sp of paths) {
    for (const seg of sp.segments) {
      if (seg.type === 'close') continue;
      const points = [seg.to];
      if (seg.type === 'quadratic') points.push(seg.cp);
      if (seg.type === 'cubic') points.push(seg.cp1, seg.cp2);
      for (const point of points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
    }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function splitLineBoundsByVerticalCenter(paths: SubPath[]): [Bounds, Bounds] {
  const all = boundsOf(paths);
  const midY = all.minY + all.height / 2;
  const first: SubPath[] = [];
  const second: SubPath[] = [];
  for (const sp of paths) {
    const b = boundsOf([sp]);
    const cy = b.minY + b.height / 2;
    if (cy < midY) first.push(sp);
    else second.push(sp);
  }
  return [boundsOf(first), boundsOf(second)];
}

function baseText(overrides: Partial<TextGeometry>): TextGeometry {
  return {
    type: 'text',
    text: 'TEXT',
    fontFamily: 'Inter',
    fontSize: 20,
    bold: false,
    italic: false,
    textAlign: 'left',
    letterSpacing: 0,
    lineSpacing: 120,
    wordSpacing: 100,
    ...overrides,
  };
}

console.log('\n=== bundled text layout to path ===\n');

const ttfPath = join(process.cwd(), 'public', 'fonts', 'Inter-Regular.ttf');
const buffer = readFileSync(ttfPath);
const inter = parseFontBuffer(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));

{
  const plain = textToPathOpentype(baseText({ text: 'A A' }), inter);
  const spaced = textToPathOpentype(baseText({
    text: 'A A',
    letterSpacing: 50,
    wordSpacing: 200,
  }), inter);

  const plainWidth = boundsOf(plain).width;
  const spacedWidth = boundsOf(spaced).width;
  assert(
    spacedWidth > plainWidth + 15,
    `opentype output honors letter/word spacing (plain ${plainWidth.toFixed(2)}, spaced ${spacedWidth.toFixed(2)})`,
  );
}

{
  const single = textToPathOpentype(baseText({ text: 'HI' }), inter);
  const multiline = textToPathOpentype(baseText({
    text: 'HI\nHI',
    lineSpacing: 250,
  }), inter);

  const singleHeight = boundsOf(single).height;
  const multilineHeight = boundsOf(multiline).height;
  assert(
    multilineHeight > singleHeight + 30,
    `opentype output honors multiline line spacing (single ${singleHeight.toFixed(2)}, multiline ${multilineHeight.toFixed(2)})`,
  );
}

{
  const hershey = textToPathHershey(baseText({
    text: 'WW\nI',
    fontFamily: 'Hershey Sans',
    fontSize: 20,
    textAlign: 'right',
    lineSpacing: 200,
  }), 'futural');
  const leftAligned = textToPathHershey(baseText({
    text: 'WW\nI',
    fontFamily: 'Hershey Sans',
    fontSize: 20,
    textAlign: 'left',
    lineSpacing: 200,
  }), 'futural');

  const all = boundsOf(hershey);
  assert(all.height > 35, `Hershey multiline output separates baselines (height ${all.height.toFixed(2)})`);

  const [firstLine, secondLine] = splitLineBoundsByVerticalCenter(hershey);
  const [, leftSecondLine] = splitLineBoundsByVerticalCenter(leftAligned);
  assert(
    secondLine.minX > firstLine.minX + 15,
    `right-aligned short second Hershey line shifts right (first ${firstLine.minX.toFixed(2)}, second ${secondLine.minX.toFixed(2)})`,
  );
  assert(
    secondLine.minX > leftSecondLine.minX + 15,
    `right alignment shifts the short Hershey line versus left alignment (left ${leftSecondLine.minX.toFixed(2)}, right ${secondLine.minX.toFixed(2)})`,
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
