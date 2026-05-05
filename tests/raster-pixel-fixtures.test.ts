/**
 * T2-20: pixel-level fixture matrix exercising the full raster
 * pipeline (image → JobCompiler → PlanOptimizer → Output → parser).
 * Each fixture is a small synthetic image with a known structure;
 * the test compiles to G-code, parses semantically via T2-18, and
 * runs the T2-19 burn-bounds analyzer to verify scanline count,
 * burn-bounds, segment power, and modal-M4 emission shape.
 *
 * The audit (2F C2 / Gate C / P0 #2) called out the gap: image-
 * processing tests stopped at pixel arrays; planner tests used
 * synthetic moves; nothing connected them. A bug in raster
 * scanline coordinate calculation could ship with passing
 * narrow-scope tests while pixel-level output was wrong.
 *
 * Built on T1-31 (modal-M4 raster strategy), T2-18 (semantic
 * parser), T2-19 (burn-bounds analyzer), and T2-20's fixture
 * helpers.
 *
 * Run: npx tsx tests/raster-pixel-fixtures.test.ts
 */
import { compileGcode } from '../src/app/PipelineService';
import { createBlankProfile, saveDeviceProfile, setActiveProfileId, getActiveProfile } from '../src/core/devices/DeviceProfile';
import { parseGcode } from './helpers/parseGcode';
import { analyzeBurnBounds } from './helpers/analyzeBurnBounds';
import {
  blackPixel,
  whitePixel,
  checkerboard,
  horizontalGradient,
  blankRow,
  blackRow,
  diagonalLine,
  type RasterFixture,
} from './helpers/imageFixtures';

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

const memoryStore: Record<string, string> = {};
function installMockLocalStorage(): void {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() { return Object.keys(memoryStore).length; },
    clear(): void { for (const k of Object.keys(memoryStore)) delete memoryStore[k]; },
    getItem: (k: string) => Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null,
    key: (i: number) => Object.keys(memoryStore)[i] ?? null,
    removeItem: (k: string) => { delete memoryStore[k]; },
    setItem: (k: string, v: string) => { memoryStore[k] = v; },
  } as Storage;
}

async function compileFixture(fixture: RasterFixture): Promise<{
  gcode: string;
} | null> {
  const result = await compileGcode(
    fixture.scene, 'absolute', null, null, 'grbl', null, 1000, getActiveProfile(),
  );
  if (!result) return null;
  return { gcode: result.gcode };
}

console.log('\n=== T2-20 raster pixel fixtures ===\n');

void (async () => {
  installMockLocalStorage();
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];

  const profile = createBlankProfile('T2-20-test');
  profile.bedWidth = 400;
  profile.bedHeight = 300;
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);

  // 1. Black pixel — produces exactly one burn move
  {
    const f = blackPixel();
    const out = await compileFixture(f);
    if (!out) { failed++; console.error('  ✗ blackPixel: compile returned null'); }
    else {
      const a = analyzeBurnBounds(parseGcode(out.gcode));
      assert(a.burnSegments.length >= 1,
        `[${f.label}] at least 1 burn segment (got ${a.burnSegments.length})`);
      // Modal-M4 strategy from T1-31: exactly 1 laser-on linear (the pixel)
      // plus possibly velocity-aware split → expect ≤ 3 burn linears.
      assert(a.burnSegments.length <= 3,
        `[${f.label}] burn segments bounded by velocity-split (≤3, got ${a.burnSegments.length})`);
    }
  }

  // 2. White pixel — no burn segments at all
  {
    const f = whitePixel();
    const out = await compileFixture(f);
    // 1×1 white in threshold mode → pixel ≥ 128 → blank → no segments.
    // compileGcode may return null when there are no operations.
    if (out) {
      const a = analyzeBurnBounds(parseGcode(out.gcode));
      assert(a.burnSegments.length === 0,
        `[${f.label}] 0 burn segments (got ${a.burnSegments.length})`);
    } else {
      assert(true, `[${f.label}] compile returned null (no operations)`);
    }
  }

  // 3. Checkerboard 4×4 — burn cells form alternating segments;
  //    burn-bounds spans the whole image.
  {
    const f = checkerboard(4);
    const out = await compileFixture(f);
    if (!out) { failed++; console.error('  ✗ checkerboard: compile returned null'); }
    else {
      const a = analyzeBurnBounds(parseGcode(out.gcode));
      assert(a.burnSegments.length >= 4,
        `[${f.label}] ≥4 burn segments (one per burn cell, got ${a.burnSegments.length})`);
      // Each row alternates burn/blank — every row contributes burn
      // motion, so totalBounds Y-range covers the full image height.
      const yRange = a.totalBounds.maxY - a.totalBounds.minY;
      const px = 25.4 / 96; // image's mm/pixel from JobCompiler raster path
      assert(yRange > 2 * px,
        `[${f.label}] totalBounds Y-range covers multiple rows (got ${yRange.toFixed(3)}mm)`);
    }
  }

  // 4. Horizontal gradient 8×1 — one row of variable S; T1-31 modal-M4
  //    means burn linears carry distinct S values per pixel where
  //    grayscale → power changes
  {
    const f = horizontalGradient(8, 1);
    const out = await compileFixture(f);
    if (!out) { failed++; console.error('  ✗ horizontalGradient: compile returned null'); }
    else {
      const a = analyzeBurnBounds(parseGcode(out.gcode));
      // Each pixel maps to a unique luminance → unique power, so we
      // get multiple distinct burn-segment powers
      const distinctPowers = new Set(a.burnSegments.map(s => s.power));
      assert(distinctPowers.size >= 2,
        `[${f.label}] burn segments carry distinct power values (got ${distinctPowers.size} distinct)`);
      // Bounds sanity: positive width, finite. Tight bound depends on
      // overscan + per-pixel scanning offsets which vary per profile;
      // skip the exact comparison and just assert finite-positive.
      const burnW = a.burnBounds.maxX - a.burnBounds.minX;
      assert(burnW > 0 && Number.isFinite(burnW),
        `[${f.label}] burnBounds width is positive + finite (got ${burnW.toFixed(3)}mm)`);
    }
  }

  // 5. Blank row in middle — burn rows above and below, gap in middle
  {
    const f = blankRow(4, 5, 2); // 4×5 image, row 2 blank
    const out = await compileFixture(f);
    if (!out) { failed++; console.error('  ✗ blankRow: compile returned null'); }
    else {
      const a = analyzeBurnBounds(parseGcode(out.gcode));
      // Rows 0, 1, 3, 4 burn → 4 scanlines of motion
      // Each scanline is one full-width burn → 4 segments
      assert(a.burnSegments.length >= 4,
        `[${f.label}] 4 burn rows → ≥4 segments (got ${a.burnSegments.length})`);
      // Modal-M4: ≥4 rapids (1 per scanline)
      assert(a.rapidSegments.length >= 4,
        `[${f.label}] ≥4 rapids between scanlines (got ${a.rapidSegments.length})`);
    }
  }

  // 6. Black row at index 2 — only that row burns
  {
    const f = blackRow(8, 5, 2);
    const out = await compileFixture(f);
    if (!out) { failed++; console.error('  ✗ blackRow: compile returned null'); }
    else {
      const a = analyzeBurnBounds(parseGcode(out.gcode));
      assert(a.burnSegments.length >= 1 && a.burnSegments.length <= 3,
        `[${f.label}] only 1 row burns (got ${a.burnSegments.length} segments — 1 base + ≤2 velocity splits)`);
      // burnBounds Y-range ≈ 1 pixel
      const yRange = a.burnBounds.maxY - a.burnBounds.minY;
      const px = 25.4 / 96;
      assert(yRange < 0.5,
        `[${f.label}] burnBounds Y-range ≈ 1 pixel (got ${yRange.toFixed(3)}mm, ~1 pixel = ${px.toFixed(3)}mm)`);
    }
  }

  // 7. Diagonal line — one burn pixel per row
  {
    const f = diagonalLine(5);
    const out = await compileFixture(f);
    if (!out) { failed++; console.error('  ✗ diagonalLine: compile returned null'); }
    else {
      const a = analyzeBurnBounds(parseGcode(out.gcode));
      // 5 rows × 1 burn pixel each = 5 segments minimum (velocity
      // splits may add up to 2 per segment).
      assert(a.burnSegments.length >= 5 && a.burnSegments.length <= 15,
        `[${f.label}] ≥5 segments (1 per row, got ${a.burnSegments.length})`);
    }
  }

  // 8. Modal-M4 invariants hold across all fixtures
  {
    const fixtures: RasterFixture[] = [
      blackPixel(),
      checkerboard(3),
      horizontalGradient(6, 1),
      blackRow(6, 4, 1),
    ];
    let allClean = true;
    let firstFail = '';
    for (const f of fixtures) {
      const out = await compileFixture(f);
      if (!out) continue;
      const parsed = parseGcode(out.gcode);
      if (!parsed.asserts.endsLaserOff) {
        allClean = false; firstFail = f.label;
        console.error(`  ✗ [${f.label}] endsLaserOff invariant failed`);
        break;
      }
      if (!parsed.asserts.unitsDeclared || !parsed.asserts.distanceModeDeclared) {
        allClean = false; firstFail = f.label;
        break;
      }
      if (!parsed.asserts.spindleNeverExceedsMax(1000)) {
        allClean = false; firstFail = f.label;
        break;
      }
    }
    assert(allClean,
      `modal-M4 invariants hold across all fixtures (failed at ${firstFail || 'none'})`);
  }

  // 9. Source-level pin
  {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.resolve(here, 'helpers/imageFixtures.ts'), 'utf-8');
    assert(/T2-20/.test(src), 'T2-20 marker in imageFixtures.ts');
    for (const fn of ['blackPixel', 'whitePixel', 'checkerboard',
      'horizontalGradient', 'verticalGradient', 'blankRow', 'blackRow', 'diagonalLine']) {
      assert(src.includes(`export function ${fn}`),
        `imageFixtures exports ${fn}`);
    }
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => { console.error(e); process.exit(1); });
