/**
 * T1-137: regression test for the pure GRBL `$I` identity-line parser
 * extracted from `GrblController._tryParseIdentityLine` (T3-50). The
 * VER and OPT lines are emitted by stock GRBL and used by LaserForge
 * for firmware-capability gates (laser-mode detection, build-flag
 * inspection).
 *
 * Pre-T1-137 the parser was a private method writing controller
 * state directly. Post-T1-137 every shape is testable standalone.
 *
 * Run: npx tsx tests/grbl-identity-parser.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGrblIdentityLine } from '../src/controllers/grbl/GrblIdentityParser';

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

console.log('\n=== T1-137 GRBL identity-line parser ===\n');

// -------- 1. VER stock pattern --------
{
  const r = parseGrblIdentityLine('[VER:1.1h.20221128:]');
  assert(r != null && 'firmwareVersion' in r && r.firmwareVersion === '1.1h.20221128',
    'VER with empty trailing build tag → version without trailing colon');
}

// -------- 2. VER with populated build tag --------
{
  const r = parseGrblIdentityLine('[VER:1.1f.20220824:custom-build]');
  assert(r != null && 'firmwareVersion' in r && r.firmwareVersion === '1.1f.20220824:custom-build',
    'VER with populated build tag → kept as-is');
}

// -------- 3. VER without trailing colon at all --------
{
  const r = parseGrblIdentityLine('[VER:1.1h]');
  assert(r != null && 'firmwareVersion' in r && r.firmwareVersion === '1.1h',
    'VER without trailing colon → kept');
}

// -------- 4. VER with leading whitespace inside --------
{
  // Pre-T1-137 behavior: payload is `.trim()`-ed first, then the
  // trailing `:` (if any) is sliced off. trim() only touches the
  // outer ends — interior whitespace is preserved, including spaces
  // that end up trailing after the `:`-strip.
  const r = parseGrblIdentityLine('[VER:  1.1h.test:]');
  assert(r != null && 'firmwareVersion' in r && r.firmwareVersion === '1.1h.test',
    'VER: leading-spaces-then-version trimmed, colon stripped');
}

// -------- 5. OPT happy path --------
{
  const r = parseGrblIdentityLine('[OPT:VL,15,128]');
  assert(r != null && 'buildOptions' in r && r.buildOptions === 'VL,15,128',
    'OPT → build options string');
}

// -------- 6. OPT with whitespace --------
{
  const r = parseGrblIdentityLine('[OPT:  VL,15,128  ]');
  assert(r != null && 'buildOptions' in r && r.buildOptions === 'VL,15,128',
    'OPT payload trimmed');
}

// -------- 7. non-identity lines return null --------
{
  assert(parseGrblIdentityLine('ok') === null,
    'plain "ok" → null');
  assert(parseGrblIdentityLine('<Idle|MPos:0,0,0|FS:0,0>') === null,
    'status report → null');
  assert(parseGrblIdentityLine('error:20') === null,
    'error line → null');
  assert(parseGrblIdentityLine('') === null,
    'empty string → null');
  assert(parseGrblIdentityLine('$10=0') === null,
    'setting line → null');
}

// -------- 8. case-sensitive prefixes (stock GRBL emits uppercase) --------
{
  assert(parseGrblIdentityLine('[ver:1.1h]') === null,
    'lowercase [ver: not matched (case-sensitive)');
  assert(parseGrblIdentityLine('[opt:VL]') === null,
    'lowercase [opt: not matched (case-sensitive)');
}

// -------- 9. malformed brackets → null --------
{
  assert(parseGrblIdentityLine('[VER:1.1h') === null,
    'missing closing bracket → null');
  assert(parseGrblIdentityLine('VER:1.1h]') === null,
    'missing opening bracket → null');
}

// -------- 10. Source-level pin: GrblController delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const ctrlSrc = readFileSync(
    resolve(here, '../src/controllers/grbl/GrblController.ts'),
    'utf-8',
  );
  assert(/from '\.\/GrblIdentityParser'/.test(ctrlSrc),
    'GrblController imports from GrblIdentityParser');
  assert(/parseGrblIdentityLine\(line\)/.test(ctrlSrc),
    'GrblController calls parseGrblIdentityLine');
  assert(/T1-137/.test(ctrlSrc),
    'GrblController carries T1-137 marker');
  // Pre-T1-137 inline `payload.endsWith(':')` slicing is gone from
  // the controller.
  assert(!/payload\.endsWith\(':'\) \? payload\.slice\(0, -1\)/.test(ctrlSrc),
    'inline VER trailing-colon trim is gone from GrblController');

  const helperSrc = readFileSync(
    resolve(here, '../src/controllers/grbl/GrblIdentityParser.ts'),
    'utf-8',
  );
  assert(/T1-137/.test(helperSrc),
    'GrblIdentityParser carries T1-137 marker');
  assert(/export function parseGrblIdentityLine/.test(helperSrc),
    'parseGrblIdentityLine is exported');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
