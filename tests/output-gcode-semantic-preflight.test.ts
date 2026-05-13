/**
 * T3-18: final emitted G-code needs a semantic safety scan, not just
 * template validation. Templates can be safe while generated body lines,
 * custom output, or future emitters leave unsafe modal state behind.
 *
 * Run: npx tsx tests/output-gcode-semantic-preflight.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBlankProfile } from '../src/core/devices/DeviceProfile';
import {
  PREFLIGHT_CODES,
  runPreflight,
  type PreflightContext,
} from '../src/core/preflight/Preflight';
import { validateEmittedGcode } from '../src/core/preflight/rules/OutputValidator';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';

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

function makeScene(): Scene {
  const scene = createScene(300, 300, 'T3-18 output validator');
  scene.objects = [createRect(scene.layers[0].id, 10, 10, 20, 20)];
  return scene;
}

function makeCtx(gcode: string | null): PreflightContext {
  const profile = createBlankProfile('T3-18 profile');
  profile.bedWidth = 300;
  profile.bedHeight = 300;
  profile.maxSpindle = 1000;
  return {
    scene: makeScene(),
    profile,
    optimizeOrderEnabled: true,
    preflightBedWidthMm: 300,
    preflightBedHeightMm: 300,
    hasGcode: gcode != null && gcode.length > 0,
    emittedGcode: gcode,
  };
}

function codes(gcode: string): string[] {
  return validateEmittedGcode(gcode, { maxSpindle: 1000 }).map(f => f.code);
}

console.log('\n=== T3-18 emitted G-code semantic preflight ===\n');

{
  const safe = [
    'G21',
    'G17',
    'G90',
    'G94',
    'M5 S0',
    'G0 X0 Y0',
    'M4 S500',
    'G1 X10 Y0 F1000',
    'M5 S0',
    'M2',
  ].join('\n');
  assert(validateEmittedGcode(safe, { maxSpindle: 1000 }).length === 0,
    'safe baseline job produces no output semantic findings');
}

{
  assert(codes('M4 S500\nG21\nG90\nG1 X10 F1000\nM5').includes(PREFLIGHT_CODES.OUTPUT_LASER_ON_BEFORE_SETUP),
    'laser-on before modal setup is blocked');
  // T1-17-followup-preflight: G0-with-non-zero-S in M3 (constant-power)
  // mode IS dangerous and stays blocked.
  assert(codes('G21\nG90\nM3 S500\nG0 X10 Y10\nM5').includes(PREFLIGHT_CODES.OUTPUT_RAPID_WITH_LASER_ON),
    'M3 + rapid move with non-zero S is blocked (constant-power dangerous case)');
  assert(codes('G21\nG17\nG90\nG94\nM5\nM3S500\nG0X10Y10\nM5').includes(PREFLIGHT_CODES.OUTPUT_RAPID_WITH_LASER_ON),
    'compact GRBL words are parsed before rapid laser checks (M3 case)');
  // T1-17-followup-preflight: M4 dynamic-power mode auto-zeros laser
  // on G0 rapids regardless of commanded S — that's the contract
  // T1-31's raster strategy relies on. M4 + G0 + non-zero S must NOT
  // be flagged. A 12 MP photo raster import surfaced 1023 false-
  // positive blockers when this rule fired on M4 output.
  assert(!codes('G21\nG90\nM4 S500\nG0 X10 Y10\nM5').includes(PREFLIGHT_CODES.OUTPUT_RAPID_WITH_LASER_ON),
    'M4 dynamic-power + rapid move + non-zero S is NOT blocked (auto-zero case)');
  assert(!codes('G21\nG17\nG90\nG94\nM5\nM4S500\nG0X10Y10\nM5').includes(PREFLIGHT_CODES.OUTPUT_RAPID_WITH_LASER_ON),
    'M4 + compact GRBL words + rapid is NOT blocked');
  assert(codes('G21\nG90\nM4 S500\nG1 X10 F1000').includes(PREFLIGHT_CODES.OUTPUT_LASER_LEFT_ON),
    'job ending with laser modal active is blocked');
  assert(codes('G21\nG90\nM4 S1200\nG1 X10 F1000\nM5').includes(PREFLIGHT_CODES.OUTPUT_SPINDLE_EXCEEDS_MAX),
    'S values above maxSpindle are blocked');
  assert(codes('G21\nG90\nM4 S500\nG1 X10 F0\nM5').includes(PREFLIGHT_CODES.OUTPUT_FEED_INVALID),
    'non-positive feed rates are blocked');
  assert(codes('G21\nG90\nM117 hello\nM5').includes(PREFLIGHT_CODES.OUTPUT_UNSUPPORTED_COMMAND),
    'unsupported emitted command is blocked');
  assert(codes(`G21\nG90\nG1 X${'1'.repeat(130)}\nM5`).includes(PREFLIGHT_CODES.OUTPUT_LINE_TOO_LONG),
    'overlong emitted lines are blocked');
}

{
  // T1-17-followup-preflight: severity pin uses M3 (the still-blocking case).
  const results = runPreflight(makeCtx('G21\nG90\nM3 S500\nG0 X5 Y5\nM5'));
  const finding = results.find(r => r.code === PREFLIGHT_CODES.OUTPUT_RAPID_WITH_LASER_ON);
  assert(finding?.severity === 'error', 'runPreflight wires output semantic validator as blocking');
}

{
  const results = runPreflight(makeCtx(null));
  assert(!results.some(r => String(r.code).startsWith('OUTPUT_') && r.code !== PREFLIGHT_CODES.OUTPUT_NEGATIVE_X),
    'missing emitted G-code skips the semantic scan');
}

{
  const here = dirname(fileURLToPath(import.meta.url));
  const preflightSrc = readFileSync(resolve(here, '../src/core/preflight/Preflight.ts'), 'utf-8');
  const preflightContextSrc = readFileSync(resolve(here, '../src/core/preflight/PreflightContext.ts'), 'utf-8');
  const ruleSrc = readFileSync(resolve(here, '../src/core/preflight/rules/OutputValidator.ts'), 'utf-8');
  assert(/emittedGcode\?:\s*string \| null/.test(preflightContextSrc), 'PreflightContext exposes emittedGcode');
  assert(/runOutputGcodeSemanticChecks\(ctx, results\)/.test(preflightSrc),
    'runPreflight calls runOutputGcodeSemanticChecks');
  assert(/T3-18/.test(ruleSrc), 'OutputValidator carries T3-18 marker');
  assert(/MAX_GRBL_LINE_LENGTH = 127/.test(ruleSrc), 'GRBL 127-byte line limit is pinned');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
