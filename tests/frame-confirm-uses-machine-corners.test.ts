/**
 * T1-42: ConnectionPanelMain's frame bounds confirmation must derive
 * from `buildFrameCorners` (the same source frame motion uses),
 * NOT from `computeGcodeOffset` applied to raw scene bounds. The
 * pre-fix `workFrame` skipped the front-origin Y-flip and (post-
 * T1-40) the right-origin X-flip, so the displayed bounds and the
 * bed-bounds confirmation diverged from the actual machine-space
 * frame motion. On front-origin machines (most consumer diodes)
 * this could say "inside bed" while the frame went off-bed.
 *
 * Two-part pin:
 *   1. Behavioral pin on the derivation: a 100×50 design at canvas
 *      (10, 20) on a front-left bed produces machine-space bounds
 *      that match the corners' bounding box (Y is flipped).
 *   2. Source-level pin on ConnectionPanelMain: `workFrame` is
 *      gone, `frameMachineBounds` reads through buildFrameCorners,
 *      `confirmFrameBounds` consumes `frameMachineBounds`, and
 *      off-bed bounds trigger a showAlert (block) rather than the
 *      old warn-and-continue confirm.
 *
 * Hardware verification needed — Falcon A1 Pro front-origin burn test.
 *
 * Run: npx tsx tests/frame-confirm-uses-machine-corners.test.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildFrameCorners } from '../src/app/frameGcode';

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

console.log('\n=== T1-42 frame-confirm uses machine corners ===\n');

// ── 1. Behavioral pin: derived bounds match buildFrameCorners ──
{
  // Front-left machine, 100×50 design at canvas (10, 20), bed 400×300.
  const sceneBounds = { minX: 10, minY: 20, maxX: 110, maxY: 70 };
  const corners = buildFrameCorners(sceneBounds, {
    startMode: 'absolute',
    savedOrigin: null,
    originCorner: 'front-left',
    bedHeightMm: 300,
  });
  // Compute the bounds shape that ConnectionPanelMain's
  // frameMachineBounds memo uses.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of corners) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  // Front-left absolute mode: X passes through (canvas (10..110) →
  // machine X 10..110), Y flips against bedHeightMm = 300:
  // canvas Y=20 → machine Y=280; canvas Y=70 → machine Y=230.
  assert(minX === 10 && maxX === 110,
    `front-left absolute: machine X bounds = [10, 110]; got [${minX}, ${maxX}]`);
  assert(minY === 230 && maxY === 280,
    `front-left absolute: Y is flipped to [230, 280]; got [${minY}, ${maxY}]`);

  // Pre-T1-42 `workFrame` would have computed bounds in canvas space
  // shifted only by computeGcodeOffset — for absolute mode that's
  // (0, 0), giving raw [10, 110] × [20, 70]. Show that the new
  // derivation diverges (Y is the diagnostic).
  assert(minY !== 20 && maxY !== 70,
    'front-left absolute: Y bounds diverge from raw scene bounds (pre-T1-42 wrong shape)');
}

// ── 2. Source-level pin on ConnectionPanelMain ─────────────────
{
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, '../src/ui/components/ConnectionPanelMain.tsx');
  const src = readFileSync(path, 'utf-8');

  assert(!/const\s+workFrame\s*=\s*useMemo/.test(src),
    'workFrame useMemo is removed (replaced by frameMachineBounds)');
  assert(/const\s+frameMachineBounds\s*=\s*useMemo/.test(src),
    'frameMachineBounds useMemo is defined');

  // Find the frameMachineBounds memo body and verify it uses
  // buildFrameCorners.
  const memoStart = src.indexOf('const frameMachineBounds = useMemo');
  assert(memoStart >= 0, 'frameMachineBounds memo block locatable');
  const memoEnd = src.indexOf('}, [', memoStart);
  const memoBody = src.slice(memoStart, memoEnd);
  assert(/buildFrameCorners\(/.test(memoBody),
    'frameMachineBounds memo calls buildFrameCorners (single source of truth with frame motion)');
  assert(/bedWidthMm:\s*bedWidth/.test(memoBody),
    'frameMachineBounds memo passes bedWidthMm (T1-40 right-origin support)');

  // confirmFrameBounds body: consumes frameMachineBounds, blocks
  // off-bed via showAlert, keeps the coverage-only warning as
  // showConfirm.
  const confStart = src.indexOf('const confirmFrameBounds = useCallback');
  assert(confStart >= 0, 'confirmFrameBounds is defined');
  const confEnd = src.indexOf('}, [frameMachineBounds', confStart);
  assert(confEnd > confStart, 'confirmFrameBounds dep array starts with frameMachineBounds');
  const confBody = src.slice(confStart, confEnd);

  assert(/frameMachineBounds\.minX/.test(confBody),
    'confirmFrameBounds reads frameMachineBounds.minX (NOT workFrame.minX)');
  assert(/frameMachineBounds\.maxY/.test(confBody),
    'confirmFrameBounds reads frameMachineBounds.maxY (NOT workFrame.maxY)');
  assert(!/workFrame\./.test(confBody),
    'confirmFrameBounds no longer references workFrame');

  // Off-bed block path uses showAlert (not just showConfirm).
  assert(/showAlert\(\s*'Frame would go off the bed'/.test(confBody),
    'off-bed bounds: confirmFrameBounds calls showAlert (block, not warn)');
  assert(/return false/.test(confBody),
    'off-bed path: confirmFrameBounds returns false (frame motion blocked)');

  // The coverage-only warning still uses showConfirm.
  assert(/showConfirm\(\s*'Frame'/.test(confBody),
    'coverage warning still uses showConfirm (warn-and-allow for quality concern)');

  // T1-42 marker present.
  assert(/T1-42/.test(confBody) || /T1-42/.test(memoBody),
    'T1-42 marker present in either the memo or the confirm body');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
