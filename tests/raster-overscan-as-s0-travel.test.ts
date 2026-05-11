/**
 * T1-173 (audit Critical #1): the raster overscan region must be
 * traversed with the laser OFF (G1 S0 travel), not burned at power.
 *
 * Pre-T1-173 evidence:
 *
 *   // src/core/plan/RasterGenerator.ts:248-260 (pre-T1-173)
 *   const startX = originX + colStart * pixelSizeMm - overscanning;
 *   const endX   = originX + colEnd   * pixelSizeMm + overscanning;
 *   return { startX, endX, y, power };
 *
 *   // src/core/plan/PlanOptimizer.ts (pre-T1-173)
 *   moves.push({ type: 'rapid', to: { x: adjusted[0].startX, ... } });
 *   ...
 *   appendRasterBurnMoves(moves, seg.startX, seg.endX, ..., seg.power);
 *
 * Result: a 3 mm overscan setting burned 3 mm BEYOND the artwork on
 * every segment edge, engraving outside the intended image. White
 * gaps narrower than 2× overscan got bridged and burned. The audit
 * (response received 2026-05-11) flagged this as Critical #1 — a
 * physical safety defect.
 *
 * Post-T1-173:
 *  1. `RasterSegment.startX/endX` contain PURE artwork pixel bounds.
 *  2. `RasterScanline` gains `overscanFromX` / `overscanToX` — the
 *     row's travel envelope.
 *  3. `planRasterOperation` mirrors the fill pattern exactly:
 *     - rapid to `overscanFromX`
 *     - G1 S0 approach from `overscanFromX` to first burn-start
 *     - burn each segment at its power
 *     - G1 S0 gap-bridge between adjacent segments (unchanged)
 *     - G1 S0 exit from last burn-end to `overscanToX`
 *
 * The critical invariant this test pins: emitted BURN moves (laser ON)
 * cover exactly the artwork bounds; OVERSCAN moves (laser OFF) cover
 * the headroom.
 *
 * Run: npx tsx tests/raster-overscan-as-s0-travel.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateRasterScanlines,
  type RasterSettings,
} from '../src/core/plan/RasterGenerator';
import { optimizePlan } from '../src/core/plan/PlanOptimizer';
import {
  createEmptyJob,
  type Operation,
  type ResolvedLaserSettings,
  type ProcessedBitmap,
} from '../src/core/job/Job';

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

console.log('\n=== T1-173 raster overscan is S0 travel (Critical #1 audit fix) ===\n');

// -------- 1. createSegment no longer bakes overscan into startX/endX --------
{
  // A 4-pixel, all-ON row at originX=10, pixelSize=1mm, overscan=3mm.
  // Pre-T1-173 the single segment would be startX=10-3=7, endX=14+3=17.
  // Post-T1-173 startX=10, endX=14. Overscan envelope is 7..17 at
  // the SCANLINE level (G1 S0).
  const bitmap: ProcessedBitmap = {
    width: 4,
    height: 1,
    data: new Uint8Array([255, 255, 255, 255]),
    mode: '1bit',
    position: { x: 10, y: 0 },
    physicalWidth: 4,
    physicalHeight: 1,
    sourceObjectId: 'test-bitmap',
  } as unknown as ProcessedBitmap;

  const settings: RasterSettings = {
    powerMin: 0,
    powerMax: 80,
    speed: 1200,
    biDirectional: false,
    overscanning: 3,
  };

  const scanlines = generateRasterScanlines(bitmap, settings);
  assert(scanlines.length === 1, `single-row bitmap → 1 scanline (got ${scanlines.length})`);
  if (scanlines.length === 1) {
    const sl = scanlines[0];
    assert(sl.segments.length === 1, `all-ON row → 1 segment (got ${sl.segments.length})`);
    if (sl.segments.length === 1) {
      const seg = sl.segments[0];
      assert(
        seg.startX === 10,
        `seg.startX === artwork left edge (10, got ${seg.startX}) — no -overscan bake-in`,
      );
      assert(
        seg.endX === 14,
        `seg.endX === artwork right edge (14, got ${seg.endX}) — no +overscan bake-in`,
      );
    }
    assert(
      sl.overscanFromX === 7,
      `LTR scanline.overscanFromX === firstSeg.startX - overscan (7, got ${sl.overscanFromX})`,
    );
    assert(
      sl.overscanToX === 17,
      `LTR scanline.overscanToX === lastSeg.endX + overscan (17, got ${sl.overscanToX})`,
    );
  }
}

// -------- 2. Overscan = 0 → envelope collapses to artwork bounds --------
{
  const bitmap: ProcessedBitmap = {
    width: 4,
    height: 1,
    data: new Uint8Array([255, 255, 255, 255]),
    mode: '1bit',
    position: { x: 10, y: 0 },
    physicalWidth: 4,
    physicalHeight: 1,
    sourceObjectId: 'test-bitmap',
  } as unknown as ProcessedBitmap;
  const settings: RasterSettings = {
    powerMin: 0, powerMax: 80, speed: 1200, biDirectional: false, overscanning: 0,
  };
  const scanlines = generateRasterScanlines(bitmap, settings);
  const sl = scanlines[0];
  assert(sl.overscanFromX === sl.segments[0].startX, 'overscan=0: overscanFromX === firstSeg.startX');
  assert(sl.overscanToX === sl.segments[sl.segments.length - 1].endX, 'overscan=0: overscanToX === lastSeg.endX');
}

// -------- 3. RTL row: envelope mirrors direction --------
{
  // Bidirectional mode, 2 rows. Row 1 is RTL.
  const bitmap: ProcessedBitmap = {
    width: 4,
    height: 2,
    data: new Uint8Array([
      255, 255, 255, 255, // row 0: LTR
      255, 255, 255, 255, // row 1: RTL
    ]),
    mode: '1bit',
    position: { x: 10, y: 0 },
    physicalWidth: 4,
    physicalHeight: 2,
    sourceObjectId: 'test-bitmap',
  } as unknown as ProcessedBitmap;
  const settings: RasterSettings = {
    powerMin: 0, powerMax: 80, speed: 1200, biDirectional: true, overscanning: 3,
  };
  const scanlines = generateRasterScanlines(bitmap, settings);
  assert(scanlines.length === 2, 'bidirectional 2 rows → 2 scanlines');
  if (scanlines.length === 2) {
    const ltr = scanlines[0];
    const rtl = scanlines[1];
    assert(ltr.direction === 'ltr', 'row 0 is LTR');
    assert(rtl.direction === 'rtl', 'row 1 is RTL');
    // RTL: segments swapped so firstSeg.startX is the rightmost burn-start (14).
    assert(rtl.segments[0].startX === 14, `RTL firstSeg.startX === artwork right edge (14, got ${rtl.segments[0].startX})`);
    assert(rtl.segments[0].endX === 10, `RTL firstSeg.endX === artwork left edge (10, got ${rtl.segments[0].endX})`);
    assert(
      rtl.overscanFromX === 17,
      `RTL overscanFromX === firstSeg.startX + overscan (17, got ${rtl.overscanFromX}) — enter from RIGHT of artwork`,
    );
    assert(
      rtl.overscanToX === 7,
      `RTL overscanToX === lastSeg.endX - overscan (7, got ${rtl.overscanToX}) — exit to LEFT of artwork`,
    );
  }
}

// -------- 4. planRasterOperation emits the rapid + G1 S0 + burn + G1 S0 sequence --------
{
  // Use optimizePlan with a job containing one raster operation.
  const bitmap: ProcessedBitmap = {
    width: 4,
    height: 1,
    data: new Uint8Array([255, 255, 255, 255]),
    mode: '1bit',
    position: { x: 10, y: 0 },
    physicalWidth: 4,
    physicalHeight: 1,
    sourceObjectId: 'test-bitmap',
  } as unknown as ProcessedBitmap;

  const settings: ResolvedLaserSettings = {
    powerMin: 0,
    powerMax: 80,
    speed: 1200,
    passes: 1,
    zStepPerPass: 0,
    fillInterval: 0,
    fillAngle: 0,
    fillMode: 'line',
    fillBiDirectional: false,
    overscanning: 3, // 3 mm overscan
    overcut: 0,
    leadIn: 0,
    tabCount: 0,
    tabWidth: 0,
    insideFirst: false,
    airAssist: false,
    accelAwarePower: false, // disable velocity splits so the burn is exactly one move
    maxAccelMmPerS2: 500,
    minPowerRatioAccel: 0.2,
    scanningOffsets: [],
  };

  const operation: Operation = {
    id: 'op-raster',
    layerId: 'L1',
    layerName: 'Raster',
    layerColor: '#000000',
    order: 0,
    type: 'raster',
    settings,
    geometry: { type: 'raster', bitmap },
    bounds: { minX: 10, minY: 0, maxX: 14, maxY: 1 },
  } as unknown as Operation;

  const job = createEmptyJob('T1-173-raster', 'test-project');
  job.operations = [operation];

  const plan = optimizePlan(job);
  assert(plan.operations.length === 1, 'one planned operation for one raster op');
  const moves = plan.operations[0].moves;

  // Find the burn moves (linear with power > 0) and overscan moves
  // (linear with power === 0). The order in the plan should be:
  //   marker, [setAir?], laserOn power=0, rapid(7,0), linear(10,0) S0,
  //   linear-burn-segments at power=80, linear(17,0) S0, laserOff.
  const linearMoves = moves.filter((m): m is { type: 'linear'; to: { x: number; y: number }; power: number; speed: number } => m.type === 'linear');
  const rapidMoves = moves.filter((m): m is { type: 'rapid'; to: { x: number; y: number } } => m.type === 'rapid');

  assert(rapidMoves.length === 1, `exactly 1 rapid (got ${rapidMoves.length})`);
  if (rapidMoves.length === 1) {
    assert(
      rapidMoves[0].to.x === 7,
      `rapid lands at overscanFromX=7, NOT at artwork left edge 10 (got ${rapidMoves[0].to.x})`,
    );
  }

  const burnLinears = linearMoves.filter(m => m.power > 0);
  const s0Linears = linearMoves.filter(m => m.power === 0);

  assert(burnLinears.length >= 1, `at least 1 burn linear (got ${burnLinears.length})`);
  assert(s0Linears.length === 2, `exactly 2 S0 linears (approach + exit) — got ${s0Linears.length}`);

  // Critical: burn bounds must equal artwork bounds, NOT envelope.
  const burnMinX = Math.min(...burnLinears.map(m => m.to.x));
  const burnMaxX = Math.max(...burnLinears.map(m => m.to.x));
  // The burn moves START at the previous segment's endpoint, so the
  // minX comes from either a burn move's `to.x` or the approach
  // linear's `to.x`. The approach linear ends at the first burn-start
  // (10). The last burn ends at 14. So burnMaxX should be 14.
  assert(
    burnMaxX <= 14 + 1e-6,
    `BURN-bound maxX === artwork right edge (14, got ${burnMaxX}). MUST NOT include +overscan (would be 17). This is the Critical #1 invariant.`,
  );

  // The two S0 linears must hit overscanFromX→firstBurnStart and lastBurnEnd→overscanToX.
  // Approach: to.x === 10 (first burn-start). Exit: to.x === 17 (overscanToX).
  const approachLinear = s0Linears.find(m => Math.abs(m.to.x - 10) < 1e-6);
  const exitLinear = s0Linears.find(m => Math.abs(m.to.x - 17) < 1e-6);
  assert(approachLinear !== undefined, 'S0 approach linear lands at first burn-start (x=10)');
  assert(exitLinear !== undefined, 'S0 exit linear lands at overscanToX (x=17)');
}

// -------- 5. Multi-segment row: gap-bridges still S0; envelope still wraps the row --------
{
  // 8 pixels with a gap in the middle: ON ON ON OFF OFF ON ON ON
  const bitmap: ProcessedBitmap = {
    width: 8,
    height: 1,
    data: new Uint8Array([255, 255, 255, 0, 0, 255, 255, 255]),
    mode: '1bit',
    position: { x: 0, y: 0 },
    physicalWidth: 8,
    physicalHeight: 1,
    sourceObjectId: 'test-bitmap',
  } as unknown as ProcessedBitmap;
  const settings: RasterSettings = {
    powerMin: 0, powerMax: 80, speed: 1200, biDirectional: false, overscanning: 2,
  };
  const scanlines = generateRasterScanlines(bitmap, settings);
  const sl = scanlines[0];
  assert(sl.segments.length === 2, `gap row → 2 segments (got ${sl.segments.length})`);
  if (sl.segments.length === 2) {
    // Segment 0: cols 0..3 → bounds 0..3
    // Segment 1: cols 5..8 → bounds 5..8
    assert(sl.segments[0].startX === 0 && sl.segments[0].endX === 3, `seg0 = artwork [0..3]`);
    assert(sl.segments[1].startX === 5 && sl.segments[1].endX === 8, `seg1 = artwork [5..8]`);
    // Envelope wraps both: 0-2=-2 to 8+2=10
    assert(sl.overscanFromX === -2, `envelope from = first.startX - overscan = -2 (got ${sl.overscanFromX})`);
    assert(sl.overscanToX === 10, `envelope to = last.endX + overscan = 10 (got ${sl.overscanToX})`);
  }
}

// -------- 6. Source pins on the implementation --------
{
  const rgSrc = readFileSync(resolve(here, '../src/core/plan/RasterGenerator.ts'), 'utf-8');
  const poSrc = readFileSync(resolve(here, '../src/core/plan/PlanOptimizer.ts'), 'utf-8');

  assert(/T1-173/.test(rgSrc), 'RasterGenerator carries T1-173 marker');
  assert(/T1-173/.test(poSrc), 'PlanOptimizer carries T1-173 marker');
  assert(/audit Critical #1|Critical #1/.test(rgSrc), 'RasterGenerator cross-references audit Critical #1');
  assert(/audit Critical #1|Critical #1/.test(poSrc), 'PlanOptimizer cross-references audit Critical #1');

  // createSegment must no longer subtract / add overscanning.
  assert(
    !/colStart \* pixelSizeMm - overscanning/.test(rgSrc),
    'RasterGenerator no longer bakes -overscanning into startX',
  );
  assert(
    !/colEnd \* pixelSizeMm \+ overscanning/.test(rgSrc),
    'RasterGenerator no longer bakes +overscanning into endX',
  );

  // RasterScanline now carries the envelope.
  assert(
    /overscanFromX:\s*number/.test(rgSrc) && /overscanToX:\s*number/.test(rgSrc),
    'RasterScanline declares overscanFromX + overscanToX',
  );

  // PlanOptimizer rapid goes to scanline.overscanFromX, not adjusted[0].startX.
  assert(
    /rapid['"\s,:]+to:\s*\{\s*x:\s*scanline\.overscanFromX/.test(poSrc),
    'planRasterOperation rapid lands at scanline.overscanFromX',
  );
  // The old rapid pattern (`adjusted[0].startX`) must be gone.
  assert(
    !/rapid['"\s,:]+to:\s*\{\s*x:\s*adjusted\[0\]\.startX/.test(poSrc),
    'planRasterOperation no longer rapids to adjusted[0].startX (which had -overscan baked in)',
  );
  // The exit-linear path lands at overscanToX.
  assert(
    /to:\s*\{\s*x:\s*scanline\.overscanToX/.test(poSrc),
    'planRasterOperation exit linear lands at scanline.overscanToX',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
