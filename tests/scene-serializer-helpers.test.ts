/**
 * T1-159: regression test for the pure validation / version / base64
 * helpers extracted from SceneSerializer.
 *
 * Run: npx tsx tests/scene-serializer-helpers.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  base64ToUint8,
  fileFormatMajor,
  fileFormatMinor,
  uint8ToBase64,
  validateArray,
  validateRequired,
  validateTransform,
} from '../src/io/sceneSerializerHelpers';

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

function expectThrow(fn: () => void, fragment: string, label: string): void {
  let msg = '';
  try {
    fn();
    failed++;
    console.error(`  FAIL ${label} → expected throw, got nothing`);
    return;
  } catch (err) {
    msg = err instanceof Error ? err.message : String(err);
  }
  if (msg.includes(fragment)) {
    passed++;
    console.log(`  PASS ${label}`);
  } else {
    failed++;
    console.error(`  FAIL ${label} → expected message to include "${fragment}", got "${msg}"`);
  }
}

console.log('\n=== T1-159 scene serializer helpers ===\n');

// -------- validateRequired --------
{
  const obj: Record<string, unknown> = { x: 5 };
  // OK: present and right type
  let threw = false;
  try { validateRequired(obj, 'x', 'number'); } catch { threw = true; }
  assert(!threw, 'validateRequired: present + right type → no throw');

  // Missing
  expectThrow(() => validateRequired(obj, 'y', 'number'),
    "missing required field 'y'",
    'validateRequired: missing field → "missing required field"');

  // Wrong type
  expectThrow(() => validateRequired({ x: 'str' }, 'x', 'number'),
    "'x' must be number, got string",
    'validateRequired: wrong type → "must be <type>, got <actual>"');

  // null is treated as missing (the function tests for undefined OR null)
  expectThrow(() => validateRequired({ x: null }, 'x', 'number'),
    "missing required field 'x'",
    'validateRequired: null → treated as missing');
}

// -------- validateArray --------
{
  let threw = false;
  try { validateArray({ a: [1, 2] }, 'a'); } catch { threw = true; }
  assert(!threw, 'validateArray: array → no throw');

  expectThrow(() => validateArray({ a: {} }, 'a'),
    "'a' must be an array",
    'validateArray: object → "must be an array"');
  expectThrow(() => validateArray({ a: 'str' }, 'a'),
    "'a' must be an array",
    'validateArray: string → "must be an array"');
}

// -------- validateTransform --------
{
  const ok = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  let threw = false;
  try { validateTransform(ok, 'test'); } catch { threw = true; }
  assert(!threw, 'validateTransform: identity → no throw');

  expectThrow(() => validateTransform({ ...ok, tx: NaN }, 'obj1'),
    'transform.tx in obj1 is not a finite number',
    'validateTransform: NaN in tx → throws with field + context');

  expectThrow(() => validateTransform({ ...ok, a: Infinity }, 'obj2'),
    'transform.a in obj2',
    'validateTransform: Infinity in a → throws');

  expectThrow(() => validateTransform({ ...ok, b: 'str' }, 'obj3'),
    'transform.b in obj3',
    'validateTransform: non-number → throws');
}

// -------- fileFormatMajor --------
assert(fileFormatMajor('1.2') === 1, '"1.2" → major 1');
assert(fileFormatMajor('2.0') === 2, '"2.0" → major 2');
assert(fileFormatMajor('10') === 10, '"10" → major 10 (no minor)');
assert(fileFormatMajor('') === 1, 'empty → major 1 (default)');
assert(fileFormatMajor(null) === 1, 'null → major 1');
assert(fileFormatMajor(undefined) === 1, 'undefined → major 1');
assert(Number.isNaN(fileFormatMajor('abc')), 'non-numeric → NaN');
assert(fileFormatMajor('  3.5  ') === 3, 'whitespace → trimmed before parse');

// -------- fileFormatMinor --------
assert(fileFormatMinor('1.2') === 2, '"1.2" → minor 2');
assert(fileFormatMinor('1') === 0, '"1" (no minor) → 0');
assert(fileFormatMinor('') === 0, 'empty → minor 0');
assert(fileFormatMinor(null) === 0, 'null → minor 0');
assert(fileFormatMinor('1.5.7') === 5, '"1.5.7" → minor 5 (third part ignored)');
assert(fileFormatMinor('abc') === 0, 'non-numeric → minor 0');

// -------- uint8ToBase64 / base64ToUint8 --------
{
  const original = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
  const b64 = uint8ToBase64(original);
  assert(b64 === 'SGVsbG8=', '"Hello" bytes → "SGVsbG8="');
  const back = base64ToUint8(b64);
  assert(back.length === 5, 'round-trip length preserved');
  for (let i = 0; i < 5; i++) {
    assert(back[i] === original[i],
      `round-trip byte ${i}: ${back[i]} === ${original[i]}`);
  }
}
{
  // Empty round-trip
  const empty = new Uint8Array(0);
  const b64 = uint8ToBase64(empty);
  assert(b64 === '', 'empty Uint8Array → empty base64');
  assert(base64ToUint8('').length === 0, 'empty base64 → empty Uint8Array');
}

// -------- Source-level pin: SceneSerializer delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const ssSrc = readFileSync(
    resolve(here, '../src/io/SceneSerializer.ts'),
    'utf-8',
  );
  assert(/from '\.\/sceneSerializerHelpers'/.test(ssSrc),
    'SceneSerializer imports from ./sceneSerializerHelpers');
  assert(/T1-159/.test(ssSrc),
    'SceneSerializer carries T1-159 marker');
  for (const name of [
    'validateRequired',
    'validateArray',
    'validateTransform',
    'fileFormatMajor',
    'fileFormatMinor',
    'uint8ToBase64',
    'base64ToUint8',
  ]) {
    const re = new RegExp(`^function ${name}\\b`, 'm');
    assert(!re.test(ssSrc),
      `inline ${name} is gone from SceneSerializer`);
  }

  const helperSrc = readFileSync(
    resolve(here, '../src/io/sceneSerializerHelpers.ts'),
    'utf-8',
  );
  assert(/T1-159/.test(helperSrc),
    'sceneSerializerHelpers carries T1-159 marker');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
