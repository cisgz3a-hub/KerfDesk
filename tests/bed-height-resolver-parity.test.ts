/**
 * resolveBedWidthMm / resolveBedHeightMm — controller > profile > default (Burn parity).
 *
 * Run: npx tsx tests/bed-height-resolver-parity.test.ts
 */

import type { DeviceProfile } from '../src/core/devices/DeviceProfile';
import { resolveBedHeightMm, resolveBedWidthMm } from '../src/app/PipelineService';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

const prof268 = { bedHeight: 268, bedWidth: 250 } as DeviceProfile;

console.log('\n=== bed-height-resolver-parity ===');

// ─── resolveBedHeightMm ───────────────────────────────────────────────────
{
  const h = resolveBedHeightMm(prof268, { width: 400, height: 300 });
  assert(h === 300, 'height: prefers controller when positive');
}

{
  const h = resolveBedHeightMm(prof268, null);
  assert(h === 268, 'height: falls back to profile.bedHeight when controller missing');
}

{
  const h = resolveBedHeightMm(null, null);
  assert(h === 300, 'height: default 300 when profile has no bedHeight');
}

{
  const h = resolveBedHeightMm(prof268, { width: 400, height: 0 });
  assert(h === 268, 'height: ignores zero controller height');
}

{
  const h = resolveBedHeightMm(prof268, { width: 400, height: -10 });
  assert(h === 268, 'height: ignores negative controller height');
}

// ─── resolveBedWidthMm ────────────────────────────────────────────────────
{
  const w = resolveBedWidthMm(prof268, { width: 363, height: 100 });
  assert(w === 363, 'width: prefers controller when positive');
}

{
  const w = resolveBedWidthMm(prof268, null);
  assert(w === 250, 'width: falls back to profile.bedWidth when controller missing');
}

{
  const w = resolveBedWidthMm(null, null);
  assert(w === 300, 'width: default 300 when profile has no bedWidth');
}

{
  const w = resolveBedWidthMm(prof268, { width: 0, height: 100 });
  assert(w === 250, 'width: ignores zero controller width');
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
