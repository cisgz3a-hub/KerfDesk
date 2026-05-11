/**
 * T1-158: regression test for the pure SVG parser helpers extracted
 * from SvgParser. Pinning the parser-side rules in isolation so the
 * viewBox grammar, attribute snapshot, and unsupported-feature
 * messages can be exercised without the @xmldom DOM dependency.
 *
 * Run: npx tsx tests/svg-parser-helpers.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractAttributes,
  parseViewBox,
  unsupportedFeatureMessage,
} from '../src/import/svg/svgParserHelpers';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

console.log('\n=== T1-158 SVG parser helpers ===\n');

// -------- parseViewBox --------
{
  const r = parseViewBox('0 0 100 200');
  assert(r != null && r.x === 0 && r.y === 0 && r.width === 100 && r.height === 200,
    'parseViewBox: 4 space-separated numbers');
}
{
  const r = parseViewBox('10,20,300,400');
  assert(r != null && r.x === 10 && r.width === 300,
    'parseViewBox: comma-separated also accepted');
}
{
  const r = parseViewBox('  10  20   300   400  ');
  assert(r != null && r.x === 10 && r.height === 400,
    'parseViewBox: multiple whitespace accepted');
}
{
  const r = parseViewBox('-10 -20 100 200');
  assert(r != null && r.x === -10 && r.y === -20,
    'parseViewBox: negative coords accepted');
}
{
  assert(parseViewBox(null) === null, 'parseViewBox: null → null');
  assert(parseViewBox('') === null, 'parseViewBox: empty → null');
  assert(parseViewBox('1 2 3') === null, 'parseViewBox: only 3 numbers → null');
  assert(parseViewBox('a b c d') === null, 'parseViewBox: non-numeric → null');
  assert(parseViewBox('1 2 bogus 4') === null, 'parseViewBox: one non-numeric → null');
}

// -------- extractAttributes --------
{
  // Build a fake Element with an attributes NamedNodeMap-like shape
  const el = {
    attributes: {
      length: 3,
      0: { name: 'x', value: '10' },
      1: { name: 'y', value: '20' },
      2: { name: 'width', value: '100' },
    },
  } as unknown as Element;
  const attrs = extractAttributes(el);
  assert(attrs.x === '10' && attrs.y === '20' && attrs.width === '100',
    'extractAttributes: all three attrs captured');
}
{
  // No attributes property
  const el = {} as unknown as Element;
  const attrs = extractAttributes(el);
  assert(Object.keys(attrs).length === 0,
    'extractAttributes: no .attributes → empty map');
}
{
  // Attribute missing value
  const el = {
    attributes: {
      length: 2,
      0: { name: 'x', value: '5' },
      1: { name: null, value: '10' },
    },
  } as unknown as Element;
  const attrs = extractAttributes(el);
  assert(attrs.x === '5' && Object.keys(attrs).length === 1,
    'extractAttributes: attrs without name are skipped');
}

// -------- unsupportedFeatureMessage --------
{
  const r = unsupportedFeatureMessage('clipPath', 1);
  assert(r.includes('1 SVG clipPath reference found'),
    'clipPath, count=1: singular noun');
  assert(r.includes('convert clipped artwork'),
    'clipPath includes recovery hint');
}
{
  const r = unsupportedFeatureMessage('clipPath', 3);
  assert(r.includes('3 SVG clipPath references found'),
    'clipPath, count=3: plural noun');
}
{
  const r = unsupportedFeatureMessage('mask', 2);
  assert(r.includes('2 SVG mask references found'),
    'mask: plural');
  assert(r.includes('flatten masked artwork'),
    'mask includes recovery hint');
}
{
  const r = unsupportedFeatureMessage('<style>', 1);
  assert(r.includes('1 SVG <style> block found'),
    '<style>: singular');
  assert(r.includes('use presentation attributes'),
    '<style> includes recovery hint');
}
{
  // Generic fallback
  const r = unsupportedFeatureMessage('foo', 1);
  assert(r.includes('1 unsupported SVG foo feature found'),
    'generic feature: singular fallback');
  const r2 = unsupportedFeatureMessage('foo', 5);
  assert(r2.includes('5 unsupported SVG foo features found'),
    'generic feature: plural fallback');
}

// -------- Source-level pin: SvgParser delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const parserSrc = readFileSync(
    resolve(here, '../src/import/svg/SvgParser.ts'),
    'utf-8',
  );
  assert(/from '\.\/svgParserHelpers'/.test(parserSrc),
    'SvgParser imports from ./svgParserHelpers');
  assert(/T1-158/.test(parserSrc),
    'SvgParser carries T1-158 marker');
  assert(!/^function parseViewBox/m.test(parserSrc),
    'inline parseViewBox is gone');
  assert(!/^function extractAttributes/m.test(parserSrc),
    'inline extractAttributes is gone');
  assert(!/^function unsupportedFeatureMessage/m.test(parserSrc),
    'inline unsupportedFeatureMessage is gone');

  const helperSrc = readFileSync(
    resolve(here, '../src/import/svg/svgParserHelpers.ts'),
    'utf-8',
  );
  assert(/T1-158/.test(helperSrc),
    'svgParserHelpers carries T1-158 marker');
  for (const name of ['parseViewBox', 'extractAttributes', 'unsupportedFeatureMessage']) {
    const re = new RegExp(`export function ${name}`);
    assert(re.test(helperSrc), `${name} is exported`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
