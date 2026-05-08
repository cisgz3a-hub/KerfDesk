/**
 * T1-40: right-origin X mirror support. Front-right and rear-right
 * machines have their physical zero on the right side of the bed;
 * positive canvas X (right of design origin) corresponds to NEGATIVE
 * machine X relative to the right-edge zero. The transform mirrors
 * via `machineX = bedWidthMm - canvasX (+ offset)`, symmetric to the
 * existing front-origin Y mirror.
 *
 * Without this fix, a user who selected `front-right` or `rear-right`
 * during initial setup got gcode that's correct for `front-left`/
 * `rear-left` — silently mirrored output on real right-origin
 * machines.
 *
 * Hardware verification needed — Falcon A1 Pro front-origin burn test.
 * (The Falcon is front-LEFT; this test verifies right-origin
 * computational correctness so we can ship right-origin support
 * confidently. Hardware test on a right-origin machine is the
 * full validation; in its absence, the mathematical pin shows
 * the expected mirror behavior.)
 *
 * Run: npx tsx tests/right-origin-x-flip.test.ts
 */
import {
  applyMachineTransform,
  transformPointToMachine,
  shouldFlipXForRightOrigin,
  type MachineTransformOptions,
} from '../src/core/plan/MachineTransform';
import type { Plan } from '../src/core/plan/Plan';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

console.log('\n=== T1-40 right-origin X-flip ===\n');

// ── 1. shouldFlipXForRightOrigin helper classification ─────────────────
{
  assert(shouldFlipXForRightOrigin('front-right') === true, 'front-right → flipX = true');
  assert(shouldFlipXForRightOrigin('rear-right') === true, 'rear-right → flipX = true');
  assert(shouldFlipXForRightOrigin('front-left') === false, 'front-left → flipX = false (no change)');
  assert(shouldFlipXForRightOrigin('rear-left') === false, 'rear-left → flipX = false (no change)');
}

// ── 2. transformPointToMachine: front-right mirrors X and flips Y ─
{
  const sceneBounds = { minX: 10, minY: 20, maxX: 110, maxY: 70 };
  const opts: MachineTransformOptions = {
    startMode: 'absolute',
    savedOrigin: null,
    originCorner: 'front-right',
    bedHeightMm: 300,
    bedWidthMm: 400,
  };
  // Top-left of design (canvasX=10, canvasY=20).
  // Front-origin Y-flip: machineY = bedH - canvasY = 300 - 20 = 280.
  // Right-origin X-flip: machineX = bedW - canvasX = 400 - 10 = 390.
  const tl = transformPointToMachine({ x: 10, y: 20 }, sceneBounds, opts);
  assert(Math.abs(tl.x - 390) < 0.001 && Math.abs(tl.y - 280) < 0.001,
    `front-right top-left maps to (390, 280); got (${tl.x}, ${tl.y})`);
  // Bottom-right of design (canvasX=110, canvasY=70):
  //   machineX = 400 - 110 = 290; machineY = 300 - 70 = 230
  const br = transformPointToMachine({ x: 110, y: 70 }, sceneBounds, opts);
  assert(Math.abs(br.x - 290) < 0.001 && Math.abs(br.y - 230) < 0.001,
    `front-right bottom-right maps to (290, 230); got (${br.x}, ${br.y})`);
  // Sanity: design width is preserved (390 - 290 = 100 = canvas width).
  assert(Math.abs((tl.x - br.x) - 100) < 0.001,
    'front-right: X span is preserved at 100 mm (canvas width)');
}

// ── 3. transformPointToMachine: rear-right mirrors X, no Y flip ─
{
  const sceneBounds = { minX: 10, minY: 20, maxX: 110, maxY: 70 };
  const opts: MachineTransformOptions = {
    startMode: 'absolute',
    savedOrigin: null,
    originCorner: 'rear-right',
    bedHeightMm: 300,
    bedWidthMm: 400,
  };
  const tl = transformPointToMachine({ x: 10, y: 20 }, sceneBounds, opts);
  // Rear-origin: no Y flip; rear-right: X mirror only.
  assert(Math.abs(tl.x - 390) < 0.001 && Math.abs(tl.y - 20) < 0.001,
    `rear-right top-left maps to (390, 20); got (${tl.x}, ${tl.y})`);
}

// ── 4. front-left baseline unchanged ─────────────────────────────
{
  const sceneBounds = { minX: 10, minY: 20, maxX: 110, maxY: 70 };
  const opts: MachineTransformOptions = {
    startMode: 'absolute',
    savedOrigin: null,
    originCorner: 'front-left',
    bedHeightMm: 300,
    // bedWidthMm intentionally omitted — left-origin doesn't need it.
  };
  const tl = transformPointToMachine({ x: 10, y: 20 }, sceneBounds, opts);
  // Front-left: X passes through (machineX = canvasX); Y flips
  // (machineY = bedH - canvasY = 280).
  assert(Math.abs(tl.x - 10) < 0.001 && Math.abs(tl.y - 280) < 0.001,
    `front-left top-left maps to (10, 280); got (${tl.x}, ${tl.y})`);
}

// ── 5. rear-left baseline unchanged ──────────────────────────────
{
  const sceneBounds = { minX: 10, minY: 20, maxX: 110, maxY: 70 };
  const opts: MachineTransformOptions = {
    startMode: 'absolute',
    savedOrigin: null,
    originCorner: 'rear-left',
    bedHeightMm: 300,
  };
  const tl = transformPointToMachine({ x: 10, y: 20 }, sceneBounds, opts);
  assert(Math.abs(tl.x - 10) < 0.001 && Math.abs(tl.y - 20) < 0.001,
    `rear-left top-left maps to (10, 20); got (${tl.x}, ${tl.y})`);
}

// ── 6. Right-origin without bedWidthMm throws ────────────────────
{
  const sceneBounds = { minX: 10, minY: 20, maxX: 110, maxY: 70 };
  const optsBad: MachineTransformOptions = {
    startMode: 'absolute',
    savedOrigin: null,
    originCorner: 'front-right',
    bedHeightMm: 300,
    // bedWidthMm intentionally omitted
  };
  let threw = false;
  try {
    transformPointToMachine({ x: 10, y: 20 }, sceneBounds, optsBad);
  } catch (e) {
    threw = e instanceof Error && /bedWidthMm/i.test(e.message);
  }
  assert(threw,
    'transformPointToMachine throws when right-origin and bedWidthMm missing');
}

// ── 7. applyMachineTransform: front-right Plan transformation ────
{
  const plan: Plan = {
    operations: [{
      moves: [
        { type: 'rapid', to: { x: 10, y: 20 } } as Plan['operations'][0]['moves'][0],
        { type: 'linear', to: { x: 110, y: 20 } } as Plan['operations'][0]['moves'][0],
        { type: 'linear', to: { x: 110, y: 70 } } as Plan['operations'][0]['moves'][0],
        { type: 'linear', to: { x: 10, y: 70 } } as Plan['operations'][0]['moves'][0],
      ],
    } as unknown as Plan['operations'][0]],
    bounds: { minX: 10, minY: 20, maxX: 110, maxY: 70 },
  } as Plan;
  const result = applyMachineTransform(plan, {
    startMode: 'absolute',
    savedOrigin: null,
    originCorner: 'front-right',
    bedHeightMm: 300,
    bedWidthMm: 400,
  });
  const moves = result.plan.operations[0].moves as Array<{ to: { x: number; y: number } }>;
  // Move 0 (rapid to canvas (10, 20)):
  //   machineX = 400 - 10 = 390; machineY = 300 - 20 = 280.
  assert(Math.abs(moves[0].to.x - 390) < 0.001 && Math.abs(moves[0].to.y - 280) < 0.001,
    `front-right move 0 → (390, 280); got (${moves[0].to.x}, ${moves[0].to.y})`);
  // Move 1 (linear to canvas (110, 20)):
  //   machineX = 400 - 110 = 290; machineY = 280.
  assert(Math.abs(moves[1].to.x - 290) < 0.001 && Math.abs(moves[1].to.y - 280) < 0.001,
    `front-right move 1 → (290, 280); got (${moves[1].to.x}, ${moves[1].to.y})`);
}

// ── 8. applyMachineTransform: front-right without bedWidthMm throws ─
{
  const plan: Plan = {
    operations: [{
      moves: [{ type: 'rapid', to: { x: 0, y: 0 } } as Plan['operations'][0]['moves'][0]],
    } as unknown as Plan['operations'][0]],
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  } as Plan;
  let threw = false;
  try {
    applyMachineTransform(plan, {
      startMode: 'absolute',
      savedOrigin: null,
      originCorner: 'rear-right',
      bedHeightMm: 300,
    });
  } catch (e) {
    threw = e instanceof Error && /bedWidthMm/i.test(e.message);
  }
  assert(threw,
    'applyMachineTransform throws when right-origin and bedWidthMm missing');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
