/**
 * T1-127: regression test for the pure GRBL WCS parser. Third slice
 * of the audit's Sprint 4 "extract pure parsers first" sequence
 * (T1-124 status-report, T1-126 settings, T1-127 WCS).
 *
 * Pre-T1-127 the parser was inline as `_tryParseG54WcsLine` plus a
 * top-level `GRBL_G54_WCS_LINE` regex constant in `GrblController`.
 * The parser is small but the audit's pattern is "every parsing
 * rule gets a pure module so the controller's interpretation logic
 * is testable in isolation."
 *
 * This test pins:
 *   - Happy path: `[G54:1.234,5.678,9.012]` → { x, y, z }.
 *   - Reject cases: anything that isn't `[G54:...]`, lines with
 *     missing fields, `[G55:...]`, etc.
 *   - Finite-only gate: NaN / Infinity coordinates return null
 *     (T1-117's fail-closed WCS path depends on this gate; if a
 *     malformed line set `_currentG54 = { NaN, NaN, NaN }` the
 *     placement-uncertain logic would mis-classify it as
 *     'verified' instead of 'malformed_g54').
 *   - Source-pin: the inline parser + top-level regex constant
 *     are gone from GrblController.ts.
 *
 * Run: npx tsx tests/grbl-wcs-parser.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGrblG54WcsLine } from '../src/controllers/grbl/GrblWcsParser';

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

console.log('\n=== T1-127 GRBL [G54:...] WCS parser ===\n');

// -------- 1. happy path --------
{
  const r = parseGrblG54WcsLine('[G54:1.234,5.678,9.012]');
  assert(r != null && r.x === 1.234 && r.y === 5.678 && r.z === 9.012,
    `[G54:1.234,5.678,9.012] → { 1.234, 5.678, 9.012 } (got ${JSON.stringify(r)})`);
}
{
  const r = parseGrblG54WcsLine('[G54:0.000,0.000,0.000]');
  assert(r != null && r.x === 0 && r.y === 0 && r.z === 0,
    `[G54:0,0,0] → all zeros`);
}
{
  const r = parseGrblG54WcsLine('[G54:-50.5,100.0,-3.25]');
  assert(r != null && r.x === -50.5 && r.y === 100 && r.z === -3.25,
    `[G54:-50.5,100.0,-3.25] → handles negatives`);
}

// -------- 2. reject non-G54 lines --------
{
  for (const line of [
    'ok',
    'error:1',
    '<Idle|MPos:0,0,0>',
    '[VER:1.1f.0]',
    '[OPT:VL,15,128]',
    '[G55:1,2,3]',           // non-G54 work coordinate
    '[G54]',                  // missing values
    '[G54:1,2]',              // only two coords
    '$30=1000',
    '',
  ]) {
    assert(parseGrblG54WcsLine(line) === null,
      `rejects '${line}'`);
  }
}

// -------- 3. finite-only gate (T1-117 load-bearing) --------
{
  const r = parseGrblG54WcsLine('[G54:bad,bad,bad]');
  assert(r === null,
    `[G54:bad,bad,bad] → null (NaN coords; T1-117 needs this for malformed_g54 classification)`);
}
{
  // Mixed bad: only y unparseable.
  const r = parseGrblG54WcsLine('[G54:1.0,bad,3.0]');
  assert(r === null,
    `[G54:1.0,bad,3.0] → null (any non-finite → reject)`);
}

// -------- 4. trailing whitespace inside numbers (parseFloat allows leading whitespace, not trailing in regex match) --------
{
  // The regex captures `1.0 ` (trailing space inside the match group); parseFloat trims.
  const r = parseGrblG54WcsLine('[G54:1.0 , 2.0 ,3.0]');
  // parseFloat('1.0 ') === 1.0, parseFloat(' 2.0 ') === 2.0, parseFloat('3.0') === 3.0
  // All finite, so we expect a hit.
  assert(r != null && r.x === 1 && r.y === 2 && r.z === 3,
    `[G54:1.0 , 2.0 ,3.0] → parseFloat tolerates leading whitespace`);
}

// -------- 5. Source-level pins --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const ctlSrc = readFileSync(
    resolve(here, '../src/controllers/grbl/GrblController.ts'),
    'utf-8',
  );
  assert(/parseGrblG54WcsLine/.test(ctlSrc),
    'GrblController imports / uses parseGrblG54WcsLine');
  assert(/T1-127/.test(ctlSrc),
    'GrblController carries T1-127 marker');
  assert(
    !/^const GRBL_G54_WCS_LINE = /m.test(ctlSrc),
    'top-level GRBL_G54_WCS_LINE regex constant is gone',
  );
  assert(
    !/_tryParseG54WcsLine[\s\S]{0,200}line\.match\(GRBL_G54_WCS_LINE\)/.test(ctlSrc),
    'inline regex match in _tryParseG54WcsLine is gone',
  );

  const parserSrc = readFileSync(
    resolve(here, '../src/controllers/grbl/GrblWcsParser.ts'),
    'utf-8',
  );
  assert(/T1-127/.test(parserSrc),
    'GrblWcsParser carries T1-127 marker');
  assert(/export function parseGrblG54WcsLine/.test(parserSrc),
    'parseGrblG54WcsLine is exported');
  assert(/export interface ParsedGrblWcs/.test(parserSrc),
    'ParsedGrblWcs interface is exported');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
