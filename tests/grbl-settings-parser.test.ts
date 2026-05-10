/**
 * T1-126: regression test for the pure GRBL `$N=value` settings
 * parser extracted from `_parseDollarSetting`. Second slice of the
 * audit's Sprint 4 "extract pure parsers first" sequence (T1-124
 * extracted the status-report parser).
 *
 * This test pins:
 *   1. `parseGrblSettingLine` regex correctly accepts `$N=value`,
 *      rejects everything else, trims whitespace, parses N as int.
 *   2. `interpretGrblSettingValue` applies the right per-setting
 *      gate semantics:
 *        - $30 (maxSpindle): only set when finite and > 0
 *        - $32 (laserMode): boolean, NaN → false
 *        - $120/$121 (max accel): only set when finite and > 0
 *        - $110/$111 (max feed) + $130/$131 (bed): set when finite,
 *          even for negative values (preserves pre-T1-126 lack of
 *          gating on those)
 *        - $23 (homingDir): defaults 0 on NaN
 *        - unknown setting numbers return empty interpreted view
 *   3. Source-pin: GrblController._parseDollarSetting now delegates
 *      to the parser; the inline switch + regex are gone.
 *
 * Run: npx tsx tests/grbl-settings-parser.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  interpretGrblSettingValue,
  parseGrblSettingLine,
} from '../src/controllers/grbl/GrblSettingsParser';

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

console.log('\n=== T1-126 GRBL $$ settings parser ===\n');

// -------- 1. parseGrblSettingLine: happy path --------
{
  const r = parseGrblSettingLine('$30=1000.000');
  assert(r != null && r.number === 30 && r.rawValue === '1000.000',
    `'$30=1000.000' → { number: 30, rawValue: '1000.000' }`);
}
{
  const r = parseGrblSettingLine('$10=255');
  assert(r != null && r.number === 10 && r.rawValue === '255',
    `'$10=255' parsed`);
}
{
  const r = parseGrblSettingLine('$130=400.000');
  assert(r != null && r.number === 130, `'$130=400.000' parsed (3-digit number)`);
}

// -------- 2. parseGrblSettingLine: trims trailing whitespace in value --------
{
  const r = parseGrblSettingLine('$30=1000.000   ');
  assert(r != null && r.rawValue === '1000.000',
    `trailing whitespace trimmed`);
}

// -------- 3. parseGrblSettingLine: rejects non-setting lines --------
{
  for (const line of [
    'ok',
    'error:1',
    '<Idle|MPos:0,0,0|FS:0,0>',
    '[VER:1.1f.0]',
    '$$',
    '$=value',         // missing number
    'value',           // no $
    '',
  ]) {
    assert(parseGrblSettingLine(line) === null,
      `rejects '${line}'`);
  }
}

// -------- 4. interpretGrblSettingValue: $30 maxSpindle --------
{
  const r = interpretGrblSettingValue(30, '1000');
  assert(r.maxSpindle === 1000, `$30=1000 → maxSpindle=1000`);
}
{
  const r = interpretGrblSettingValue(30, '0');
  assert(r.maxSpindle === undefined, `$30=0 → maxSpindle undefined (gate: > 0)`);
}
{
  const r = interpretGrblSettingValue(30, '-100');
  assert(r.maxSpindle === undefined, `$30=-100 → maxSpindle undefined (gate: > 0)`);
}
{
  const r = interpretGrblSettingValue(30, 'bogus');
  assert(r.maxSpindle === undefined, `$30=bogus → maxSpindle undefined (gate: finite)`);
}

// -------- 5. interpretGrblSettingValue: $32 laserMode --------
{
  assert(interpretGrblSettingValue(32, '1').laserMode === true, `$32=1 → laserMode true`);
  assert(interpretGrblSettingValue(32, '0').laserMode === false, `$32=0 → laserMode false`);
  assert(interpretGrblSettingValue(32, '255').laserMode === true,
    `$32=255 → laserMode true (any non-zero int)`);
  // Pin the exact pre-fix idiom: parseInt(rawVal, 10) !== 0.
  // parseInt('bogus', 10) = NaN; NaN !== 0 is TRUE; so laserMode = true.
  // That's intentional — preserves pre-T1-126 inline behavior.
  assert(interpretGrblSettingValue(32, 'bogus').laserMode === true,
    `$32=bogus → laserMode true (NaN !== 0 holds; matches pre-T1-126 idiom)`);
}

// -------- 6. interpretGrblSettingValue: $23 homingDir --------
{
  assert(interpretGrblSettingValue(23, '3').homingDir === 3, `$23=3 → homingDir 3`);
  assert(interpretGrblSettingValue(23, '0').homingDir === 0, `$23=0 → homingDir 0`);
  assert(interpretGrblSettingValue(23, 'bogus').homingDir === 0,
    `$23=bogus → homingDir 0 (NaN coerces to 0)`);
}

// -------- 7. $130/$131 bed dims --------
{
  assert(interpretGrblSettingValue(130, '400').bedWidth === 400, `$130=400 → bedWidth=400`);
  assert(interpretGrblSettingValue(131, '300').bedHeight === 300, `$131=300 → bedHeight=300`);
  assert(interpretGrblSettingValue(130, 'bogus').bedWidth === undefined,
    `$130=bogus → bedWidth undefined (gate: finite)`);
  // Pre-T1-126 didn't gate negative values for $130/$131; preserve that.
  assert(interpretGrblSettingValue(130, '-50').bedWidth === -50,
    `$130=-50 → bedWidth=-50 (no positive-only gate; matches pre-T1-126)`);
}

// -------- 8. $110/$111 max feed --------
{
  assert(interpretGrblSettingValue(110, '12000').maxFeedX === 12000, `$110=12000 → maxFeedX=12000`);
  assert(interpretGrblSettingValue(111, '10000').maxFeedY === 10000, `$111 → maxFeedY`);
}

// -------- 9. $120/$121 max accel (positive-only gate) --------
{
  assert(interpretGrblSettingValue(120, '1500').maxAccelX === 1500, `$120=1500 → maxAccelX=1500`);
  assert(interpretGrblSettingValue(120, '0').maxAccelX === undefined,
    `$120=0 → maxAccelX undefined (gate: > 0)`);
  assert(interpretGrblSettingValue(121, '-100').maxAccelY === undefined,
    `$121=-100 → maxAccelY undefined (gate: > 0)`);
}

// -------- 10. Unknown setting number → empty interpreted view --------
{
  const r = interpretGrblSettingValue(99, '42');
  assert(Object.keys(r).length === 0,
    `$99 (unknown) → empty interpreted view (caller still stores rawValue in map)`);
}

// -------- 11. Source-level pins on the wiring --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const ctlSrc = readFileSync(
    resolve(here, '../src/controllers/grbl/GrblController.ts'),
    'utf-8',
  );
  assert(/parseGrblSettingLine/.test(ctlSrc),
    'GrblController imports / uses parseGrblSettingLine');
  assert(/interpretGrblSettingValue/.test(ctlSrc),
    'GrblController imports / uses interpretGrblSettingValue');
  assert(/T1-126/.test(ctlSrc), 'GrblController carries T1-126 marker');
  // The pre-fix top-level GRBL_SETTING_LINE constant is gone (the
  // regex now lives inside the parser module).
  assert(
    !/^const GRBL_SETTING_LINE = \/\^\\\$\(\\d\+\)=/m.test(ctlSrc),
    'top-level GRBL_SETTING_LINE regex constant is gone from GrblController.ts',
  );
  // The inline per-number switch is gone — the controller no longer
  // hand-rolls parseFloat/parseInt for known settings.
  assert(
    !/case 30: \{[\s\S]*?const v = parseFloat\(rawVal\)/.test(ctlSrc),
    'inline `case 30 { parseFloat(rawVal) }` block is gone',
  );

  const parserSrc = readFileSync(
    resolve(here, '../src/controllers/grbl/GrblSettingsParser.ts'),
    'utf-8',
  );
  assert(/T1-126/.test(parserSrc),
    'GrblSettingsParser carries T1-126 marker');
  assert(/export function parseGrblSettingLine/.test(parserSrc),
    'parseGrblSettingLine is exported');
  assert(/export function interpretGrblSettingValue/.test(parserSrc),
    'interpretGrblSettingValue is exported');
  assert(/export interface ParsedGrblSetting/.test(parserSrc),
    'ParsedGrblSetting interface is exported');
  assert(/export interface InterpretedGrblSetting/.test(parserSrc),
    'InterpretedGrblSetting interface is exported');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
