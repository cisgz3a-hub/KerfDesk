/**
 * T1-99: savedOrigin should not be in the compile-invalidation dep set.
 *
 * Run: npx tsx tests/savedorigin-not-compile-invalidating.test.ts
 */
import { computeGcodeOffset } from '../src/core/output/GcodeOrigin';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

console.log('\n=== T1-99 savedOrigin not compile-invalidating ===\n');

const designBounds = { minX: 47.5, minY: 32.5 };

// 1. savedOrigin null in 'savedOrigin' startMode -> standard offset.
{
  const off = computeGcodeOffset('savedOrigin', designBounds, null);
  assert(off.x === -47.5 && off.y === -32.5,
    'savedOrigin mode + null savedOrigin -> (-minX, -minY) offset');
}

// 2. savedOrigin {0,0} in 'savedOrigin' mode -> same offset.
{
  const off = computeGcodeOffset('savedOrigin', designBounds, { x: 0, y: 0 });
  assert(off.x === -47.5 && off.y === -32.5,
    'savedOrigin mode + {0,0} -> same offset');
}

// 3. savedOrigin {100,200} in 'savedOrigin' mode -> same offset.
{
  const off = computeGcodeOffset('savedOrigin', designBounds, { x: 100, y: 200 });
  assert(off.x === -47.5 && off.y === -32.5,
    'savedOrigin mode + {100,200} -> same offset');
}

// 4. Two arbitrary saved-origin values produce identical offsets.
{
  const a = computeGcodeOffset('savedOrigin', designBounds, { x: 50, y: 50 });
  const b = computeGcodeOffset('savedOrigin', designBounds, { x: 250, y: 175 });
  assert(a.x === b.x && a.y === b.y,
    'two arbitrary savedOrigin values -> identical offsets');
}

// 5. 'savedOrigin' and 'current' modes produce identical offsets.
{
  const saved = computeGcodeOffset('savedOrigin', designBounds, { x: 99, y: 99 });
  const current = computeGcodeOffset('current', designBounds, null);
  assert(saved.x === current.x && saved.y === current.y,
    "'savedOrigin' offset === 'current' offset");
}

// 6. 'absolute' mode is the actual case where re-emission differs.
{
  const absolute = computeGcodeOffset('absolute', designBounds, null);
  const current = computeGcodeOffset('current', designBounds, null);
  assert(absolute.x !== current.x || absolute.y !== current.y,
    "'absolute' offset !== 'current' offset");
}

// 7. designBounds change still changes offset in 'savedOrigin' mode.
{
  const a = computeGcodeOffset('savedOrigin', { minX: 0, minY: 0 }, { x: 50, y: 50 });
  const b = computeGcodeOffset('savedOrigin', { minX: 100, minY: 100 }, { x: 50, y: 50 });
  assert(a.x !== b.x || a.y !== b.y,
    'designBounds change -> offset change in savedOrigin mode');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
