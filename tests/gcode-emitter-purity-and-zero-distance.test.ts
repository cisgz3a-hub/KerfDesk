/**
 * T1-180 (external audit High #5): the G-code emitter must be pure
 * around the preview pass AND must suppress zero-distance G1 moves.
 *
 * Pre-T1-180 evidence:
 *
 *   // 1. encodeLinear absolute-mode branch (Output.ts:405-413)
 *   if (!this._relative) {
 *     this._prevPos = { x: to.x, y: to.y };
 *     const parts = [`G1 X${to.x.toFixed(3)} Y${to.y.toFixed(3)}`];
 *     ... parts.push(this.encodePowerValue(power));
 *     return parts.join(' ');     // <-- emits G1 even at zero distance
 *   }
 *
 *   // 2. generate() double-footer call (Output.ts:224-228)
 *   const previewFooter = this.encodeFooter(...lines.length + 1);
 *   ... // counts footer lines
 *   const footer = this.encodeFooter(...totalLines);
 *   // <-- preview-pass mutated _prevPos / currentSpeed leak into the
 *   //     final pass; if the footer template behavior depends on
 *   //     totalLines, output diverges from preview.
 *
 * Failure modes the audit flagged:
 *  - Zero-distance: a duplicate point or degenerate segment emits a
 *    stationary nonzero-power G1 = dwell burn (scorches material).
 *  - Double-footer: preview pass mutates modal state; final pass
 *    starts from that mutated state instead of the operations-loop
 *    state; output determinism is broken.
 *
 * Post-T1-180:
 *  1. `encodeLinear` checks `|dx| < eps && |dy| < eps` BEFORE the
 *     absolute/relative split; returns `; G1 skipped (zero distance — ...)`
 *     for any zero-distance move regardless of mode.
 *  2. `generate()` snapshots `_prevPos`, `_prevZ`, `currentSpeed`
 *     BEFORE the preview encodeFooter call, restores them BEFORE the
 *     final encodeFooter call. Preview mutation cannot leak.
 *
 * Run: npx tsx tests/gcode-emitter-purity-and-zero-distance.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GrblOutputStrategy } from '../src/core/output/GrblStrategy';

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

console.log('\n=== T1-180 G-code emitter purity + zero-distance suppression (audit High #5) ===\n');

// -------- 1. encodeLinear suppresses zero-distance G1 (absolute mode) --------
{
  const strategy = new GrblOutputStrategy();
  // Reach into the private state to set up. The encoder defaults to
  // absolute mode and prevPos=(0,0). Encoding a move to (0,0) at
  // non-zero power should suppress.
  const priv = strategy as unknown as {
    _maxSpindle: number;
    _prevPos: { x: number; y: number };
    _relative: boolean;
    currentSpeed: number;
  };
  priv._maxSpindle = 1000;
  priv._prevPos = { x: 50, y: 50 };
  priv._relative = false;
  priv.currentSpeed = 0;

  // Same-point move at full power: zero-distance.
  const out = strategy.encodeLinear({ x: 50, y: 50 }, 100, 1200);
  assert(
    /^;\s*G1 skipped/.test(out),
    `absolute zero-distance: returns a comment, not a G1 (got "${out}")`,
  );
  assert(
    /would dwell-burn at S\d+/.test(out),
    'comment carries the dwell-burn warning with the would-be S value',
  );
  // The prevPos must NOT have been mutated — there was no motion.
  assert(
    priv._prevPos.x === 50 && priv._prevPos.y === 50,
    'absolute zero-distance: _prevPos unchanged (no implicit mutation)',
  );
}

// -------- 2. encodeLinear suppresses zero-distance G1 (relative mode) --------
{
  const strategy = new GrblOutputStrategy();
  const priv = strategy as unknown as {
    _maxSpindle: number;
    _prevPos: { x: number; y: number };
    _relative: boolean;
    currentSpeed: number;
  };
  priv._maxSpindle = 1000;
  priv._prevPos = { x: 10, y: 20 };
  priv._relative = true;
  priv.currentSpeed = 800;

  // Same-point move in relative mode → would have been G1 F<speed> S<power>
  // pre-T1-180 if speed differed from currentSpeed.
  const out = strategy.encodeLinear({ x: 10, y: 20 }, 50, 1200);
  assert(
    /^;\s*G1 skipped/.test(out),
    `relative zero-distance: returns a comment, not a stationary G1 F.. S.. (got "${out}")`,
  );
  assert(
    priv.currentSpeed === 800,
    'relative zero-distance: currentSpeed unchanged (no implicit modal mutation)',
  );
}

// -------- 3. Real motion still emits G1 with X/Y/F/S --------
{
  const strategy = new GrblOutputStrategy();
  const priv = strategy as unknown as {
    _maxSpindle: number;
    _prevPos: { x: number; y: number };
    _relative: boolean;
    currentSpeed: number;
  };
  priv._maxSpindle = 1000;
  priv._prevPos = { x: 0, y: 0 };
  priv._relative = false;
  priv.currentSpeed = 0;

  const out = strategy.encodeLinear({ x: 50, y: 50 }, 100, 1200);
  assert(
    /^G1 X50\.000 Y50\.000/.test(out),
    `real motion: emits G1 X/Y (got "${out}")`,
  );
  assert(
    /F1200/.test(out) && /S1000/.test(out),
    'real motion: includes F and S values',
  );
  assert(
    priv._prevPos.x === 50 && priv._prevPos.y === 50,
    'real motion: _prevPos updated to new target',
  );
}

// -------- 4. Source pins on the implementation --------
{
  const src = readFileSync(resolve(here, '../src/core/output/Output.ts'), 'utf-8');

  assert(/T1-180/.test(src), 'Output.ts carries T1-180 marker');
  assert(/audit High #5/.test(src), 'Output.ts cross-references audit High #5');

  // Source-positional check: the encodeLinear function body must
  // contain the zero-distance suppression BEFORE the `!this._relative`
  // absolute branch (so absolute mode is also gated). Use string
  // indices for robustness; widen the slice to 5000 chars to cover
  // the function's full body including the T1-180 doc comment.
  // `encodeLinear(to:` appears twice — once in the abstract method
  // declaration on `OutputStrategy`, once in the BaseGCodeStrategy
  // implementation. Use lastIndexOf to find the implementation.
  const encodeLinearIdx = src.lastIndexOf('encodeLinear(to:');
  assert(encodeLinearIdx > 0, 'encodeLinear implementation found');
  const encodeLinearSlice = src.slice(encodeLinearIdx, encodeLinearIdx + 5000);
  // Find the SECOND occurrence of `encodeLinear(` if needed, so we
  // don't confuse encodeLinear declaration vs. encodeLinear body —
  // actually just look in the slice for our markers.
  // We want the zero-distance check that's at the top of the body
  // (the one introduced by T1-180), distinguish from the relative-
  // branch one if any remained.
  const zeroDistCheckIdx = encodeLinearSlice.indexOf('Math.abs(dx) < eps && Math.abs(dy) < eps');
  const absoluteBranchIdx = encodeLinearSlice.indexOf('if (!this._relative)');
  assert(
    zeroDistCheckIdx > 0 && absoluteBranchIdx > 0 && zeroDistCheckIdx < absoluteBranchIdx,
    `zero-distance check (idx ${zeroDistCheckIdx}) precedes the !_relative absolute branch (idx ${absoluteBranchIdx})`,
  );
  assert(
    encodeLinearSlice.includes('G1 skipped (zero distance'),
    'encodeLinear emits "; G1 skipped (zero distance ..." comment',
  );

  // The snapshot/restore pattern is present in generate().
  assert(
    /stateSnapshot = \{/.test(src) && /prevZ:\s*this\._prevZ/.test(src),
    'generate(): stateSnapshot literal declared with prevZ field',
  );
  assert(
    /this\._prevPos = \{ x: stateSnapshot\.prevPos\.x, y: stateSnapshot\.prevPos\.y \}/.test(src),
    'generate(): restores _prevPos from snapshot',
  );
  assert(
    /this\._prevZ = stateSnapshot\.prevZ/.test(src),
    'generate(): restores _prevZ from snapshot',
  );
  assert(
    /this\.currentSpeed = stateSnapshot\.currentSpeed/.test(src),
    'generate(): restores currentSpeed from snapshot',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
