/**
 * T1-182 (external audit High #2 + #8): the burn envelope must be
 * derivable from the EMITTED G-code bytes, not from the upstream
 * `Plan`. The audit framed this as: "the user may approve a preview
 * that is not the actual program." The plan-derived bounds may
 * include rapids, footer return motion, or overscan-as-burn (the
 * pre-T1-173 raster bug); the emitted-G-code-derived bounds are
 * the ground truth.
 *
 * T1-182 ships the parser foundation: `analyzeEmittedBurnEnvelope`
 * walks the gcode line-by-line, tracks modal state (G0/G1, G90/G91,
 * M3/M4/M5, S), and returns:
 *   - `burnBounds`: AABB of all laser-ON G1 motion (null if none)
 *   - `burnMoveCount`: count of distinct burn segments
 *   - `zeroDistanceLinearCount`: count of stationary G1 moves
 *     observed (post-T1-180 should be 0)
 *
 * `ValidatedJobTicket.emittedBurnBounds` carries this derived AABB
 * so future preview / validator / support-diagnostic code can
 * consume it without re-parsing.
 *
 * Run: npx tsx tests/emitted-burn-envelope.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeEmittedBurnEnvelope } from '../src/core/output/emittedBurnEnvelope';

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));

console.log('\n=== T1-182 emitted-burn-envelope parser (audit High #2 + #8) ===\n');

// -------- 1. Empty / rapid-only gcode → burnBounds null --------
{
  const result = analyzeEmittedBurnEnvelope('G21\nG90\nM5 S0\nG0 X10 Y10\nM2');
  assert(result.burnBounds === null, 'rapid-only gcode: burnBounds === null (no burn moves)');
  assert(result.burnMoveCount === 0, 'rapid-only gcode: burnMoveCount === 0');
}

// -------- 2. Single burn segment: bounds match the segment --------
{
  const gcode = [
    'G21', 'G90', 'G94', 'M5 S0',
    'G0 X10 Y10',
    'M4 S0',
    'G1 X10 Y10 F1200 S1000',   // zero distance — should NOT count as burn
    'G1 X50 Y10 S1000',         // burn from (10,10) to (50,10)
    'M5 S0',
    'M2',
  ].join('\n');
  const result = analyzeEmittedBurnEnvelope(gcode);
  assert(result.burnBounds !== null, 'single burn: burnBounds not null');
  if (result.burnBounds) {
    assert(result.burnBounds.minX === 10, `burnBounds.minX === 10 (got ${result.burnBounds.minX})`);
    assert(result.burnBounds.maxX === 50, `burnBounds.maxX === 50 (got ${result.burnBounds.maxX})`);
    assert(result.burnBounds.minY === 10, `burnBounds.minY === 10 (got ${result.burnBounds.minY})`);
    assert(result.burnBounds.maxY === 10, `burnBounds.maxY === 10 (got ${result.burnBounds.maxY})`);
  }
  assert(result.burnMoveCount === 1, `1 burn move (got ${result.burnMoveCount})`);
  assert(
    result.zeroDistanceLinearCount === 1,
    `zero-distance count === 1 (the stationary G1 X10 Y10 was tallied separately)`,
  );
}

// -------- 3. Multiple burn segments form correct AABB --------
{
  const gcode = [
    'G21', 'G90', 'G94', 'M5 S0',
    'G0 X0 Y0',
    'M4 S0',
    'G1 X10 Y0 S500',
    'G1 X10 Y20 S500',
    'G1 X-5 Y20 S500',   // negative X
    'G1 X-5 Y-3 S500',   // negative Y
    'M5 S0', 'M2',
  ].join('\n');
  const result = analyzeEmittedBurnEnvelope(gcode);
  assert(result.burnBounds !== null, 'multi burn: burnBounds not null');
  if (result.burnBounds) {
    assert(result.burnBounds.minX === -5, `multi burn: minX === -5 (got ${result.burnBounds.minX})`);
    assert(result.burnBounds.maxX === 10, `multi burn: maxX === 10 (got ${result.burnBounds.maxX})`);
    assert(result.burnBounds.minY === -3, `multi burn: minY === -3 (got ${result.burnBounds.minY})`);
    assert(result.burnBounds.maxY === 20, `multi burn: maxY === 20 (got ${result.burnBounds.maxY})`);
  }
  assert(result.burnMoveCount === 4, `4 burn moves (got ${result.burnMoveCount})`);
}

// -------- 4. M5 between G1 moves: subsequent G1 not counted as burn --------
{
  const gcode = [
    'G21', 'G90', 'M5 S0',
    'G0 X0 Y0',
    'M4 S500',
    'G1 X10 Y0',         // burn
    'M5 S0',             // laser off
    'G1 X20 Y0',         // NOT a burn (laser off)
    'M2',
  ].join('\n');
  const result = analyzeEmittedBurnEnvelope(gcode);
  assert(result.burnMoveCount === 1, `M5 interrupts burn: only 1 burn (got ${result.burnMoveCount})`);
  if (result.burnBounds) {
    assert(result.burnBounds.maxX === 10, `M5 interrupt: maxX === 10 (post-M5 G1 not counted)`);
  }
}

// -------- 5. S0 inline (M4 dynamic mode laser off): NOT a burn --------
{
  const gcode = [
    'G21', 'G90', 'M5 S0',
    'M4 S0',             // M4 active, but S=0 → laser off
    'G0 X0 Y0',
    'G1 X10 Y0',         // motion at S=0 — gap-bridge, not a burn
    'G1 X20 Y0 S500',    // S becomes 500 → this IS a burn
    'M5 S0', 'M2',
  ].join('\n');
  const result = analyzeEmittedBurnEnvelope(gcode);
  assert(result.burnMoveCount === 1, `S=0 G1 is not a burn (got ${result.burnMoveCount} burns)`);
  if (result.burnBounds) {
    assert(result.burnBounds.minX === 10, `burn started at (10,0) where S went to 500`);
    assert(result.burnBounds.maxX === 20, `burn ended at (20,0)`);
  }
}

// -------- 6. Comments and parenthesized comments are stripped --------
{
  const gcode = [
    'G21 ; units mm',
    'G90 ; absolute mode',
    'M5 S0  ; safety',
    'G0 X10 Y10 (rapid to start)',
    'M4 S500',
    'G1 X20 Y20 ; first burn',
    '; standalone comment',
    '(parenthesized standalone)',
    'M5 S0 ; trailing safety',
    'M2',
  ].join('\n');
  const result = analyzeEmittedBurnEnvelope(gcode);
  assert(result.burnMoveCount === 1, 'comments stripped: 1 burn');
  if (result.burnBounds) {
    assert(result.burnBounds.maxX === 20 && result.burnBounds.maxY === 20, 'burn bounds (20,20)');
  }
}

// -------- 7. Relative-mode G91 accumulates correctly --------
{
  const gcode = [
    'G21',
    'G91',                  // relative mode
    'M5 S0',
    'G0 X10 Y10',           // relative-rapid to (10, 10)
    'M4 S500',
    'G1 X5 Y0',             // burn from (10,10) to (15,10)
    'G1 X0 Y5',             // burn from (15,10) to (15,15)
    'M5 S0', 'M2',
  ].join('\n');
  const result = analyzeEmittedBurnEnvelope(gcode);
  assert(result.burnMoveCount === 2, 'relative: 2 burn moves');
  if (result.burnBounds) {
    assert(result.burnBounds.minX === 10, `relative: minX === 10 (got ${result.burnBounds.minX})`);
    assert(result.burnBounds.maxX === 15, `relative: maxX === 15 (got ${result.burnBounds.maxX})`);
    assert(result.burnBounds.minY === 10, `relative: minY === 10 (got ${result.burnBounds.minY})`);
    assert(result.burnBounds.maxY === 15, `relative: maxY === 15 (got ${result.burnBounds.maxY})`);
  }
}

// -------- 8. Source pins on the parser + ticket field + PipelineService wiring --------
{
  const parserSrc = readFileSync(resolve(here, '../src/core/output/emittedBurnEnvelope.ts'), 'utf-8');
  const ticketSrc = readFileSync(resolve(here, '../src/core/job/ValidatedJobTicket.ts'), 'utf-8');
  const pipelineSrc = readFileSync(resolve(here, '../src/app/PipelineService.ts'), 'utf-8');

  assert(/T1-182/.test(parserSrc), 'emittedBurnEnvelope.ts carries T1-182 marker');
  assert(/audit High #2 \+ #8/.test(parserSrc), 'emittedBurnEnvelope.ts cross-references audit High #2 + #8');
  assert(
    /export function analyzeEmittedBurnEnvelope/.test(parserSrc),
    'analyzeEmittedBurnEnvelope is exported',
  );

  assert(/T1-182/.test(ticketSrc), 'ValidatedJobTicket carries T1-182 marker');
  assert(
    /emittedBurnBounds:\s*AABB\s*\|\s*null/.test(ticketSrc),
    'ValidatedJobTicket declares emittedBurnBounds: AABB | null',
  );

  assert(/T1-182/.test(pipelineSrc), 'PipelineService carries T1-182 marker');
  assert(
    /emittedBurnBounds:\s*analyzeEmittedBurnEnvelope\(gcode\)\.burnBounds/.test(pipelineSrc),
    'PipelineService populates emittedBurnBounds from analyzeEmittedBurnEnvelope(gcode)',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
