/**
 * === FILE: /tests/pipeline.test.ts ===
 * 
 * Purpose:    Smoke test for the full pipeline: Scene → Job → Plan → Output.
 *             Verifies that the core data flows correctly through all stages.
 *             This is the FIRST test to run — if this fails, nothing works.
 * 
 * Dependencies: All core modules
 * Last updated: Phase 5, Step 18d — Raster scanline generation
 * 
 * Run with: npx tsx tests/pipeline.test.ts
 */

import { createScene } from '../src/core/scene/Scene';
import { createLayer } from '../src/core/scene/Layer';
import { createRect, createEllipse, createLine } from '../src/core/scene/SceneObject';
import { compileJob } from '../src/core/job/JobCompiler';
import {
  type Job, type Operation, type ProcessedBitmap,
  type ResolvedLaserSettings, createEmptyJob,
} from '../src/core/job/Job';
import { type Plan, type Move } from '../src/core/plan/Plan';
import { optimizePlan } from '../src/core/plan/PlanOptimizer';
import { getOutputStrategy } from '../src/core/output/Output';
import { applyMachineTransform } from '../src/core/plan/MachineTransform';
import '../src/core/output/GrblStrategy';  // Register GRBL strategy
import { generateId } from '../src/core/types';
import { simulatePlan } from '../src/core/plan/Simulation';
import { computeFitBounds, computeSceneBounds, computeSimulationBounds } from '../src/geometry/bounds';

// ─── ASSERTIONS ──────────────────────────────────────────────────

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

function assertClose(actual: number, expected: number, tolerance: number, message: string): void {
  assert(Math.abs(actual - expected) < tolerance, `${message} (actual=${actual.toFixed(2)}, expected=${expected})`);
}

// ─── TEST: SCENE CREATION ────────────────────────────────────────

console.log('\n=== Test: Scene Creation ===');

const scene = createScene(400, 300, 'Test Project');
assert(scene.layers.length === 1, 'Scene has 1 default layer');
assert(scene.objects.length === 0, 'Scene starts with no objects');
assert(scene.canvas.width === 400, 'Canvas width is 400mm');
assert(scene.canvas.height === 300, 'Canvas height is 300mm');

// Add layers
const engraveLayer = createLayer(1, 'engrave', 'Engrave');
const scoreLayer = createLayer(2, 'score', 'Score Lines');
scene.layers.push(engraveLayer, scoreLayer);
assert(scene.layers.length === 3, 'Scene has 3 layers after adding');

// Add objects
const cutLayer = scene.layers[0];
const rect1 = createRect(cutLayer.id, 50, 30, 100, 80, 'Box Outline');
const rect2 = createRect(engraveLayer.id, 60, 40, 80, 20, 'Logo Area');
const circle = createEllipse(cutLayer.id, 250, 80, 40, 40, 'Circle Cut');
const foldLine = createLine(scoreLayer.id, 50, 70, 150, 70, 'Fold Line');
scene.objects.push(rect1, rect2, circle, foldLine);
assert(scene.objects.length === 4, 'Scene has 4 objects');

// ─── TEST: JOB COMPILATION ──────────────────────────────────────

console.log('\n=== Test: Job Compilation ===');

const job: Job = compileJob(scene);
assert(job.operations.length === 3, 'Job has 3 operations (one per active layer)');
assert(job.metadata.objectCount === 4, 'Job reports 4 objects');

// Check processing order: engrave → score → cut
const opTypes = job.operations.map(op => op.type);
assert(opTypes[0] === 'engrave', 'First operation is engrave');
assert(opTypes[1] === 'score', 'Second operation is score');
assert(opTypes[2] === 'cut', 'Third operation is cut');

// Check that settings are resolved
const cutOp = job.operations.find(op => op.type === 'cut')!;
assert(cutOp.settings.powerMax === 80, 'Cut power max is 80%');
assert(cutOp.settings.speed === 150, 'Cut speed is 150 mm/min');
assert(cutOp.settings.insideFirst === true, 'Inside-first is enabled');

// Check geometry is flattened
assert(cutOp.geometry.type === 'vector', 'Cut geometry is vector type');
if (cutOp.geometry.type === 'vector') {
  assert(cutOp.geometry.paths.length === 2, 'Cut layer has 2 paths (rect + ellipse)');
  
  const rectPath = cutOp.geometry.paths[0];
  assert(rectPath.closed === true, 'Rectangle path is closed');
  assert(rectPath.coords.length === 8, 'Rectangle has 4 points (8 coords)');
  
  // Verify coordinates are in world space (transform applied)
  assert(rectPath.coords[0] === 50, 'First point X = 50 (transform applied)');
  assert(rectPath.coords[1] === 30, 'First point Y = 30 (transform applied)');
}

// Check engrave layer
const engraveOp = job.operations.find(op => op.type === 'engrave')!;
assert(engraveOp.geometry.type === 'fill', 'Engrave geometry is fill type');
assert(engraveOp.settings.fillInterval === 0.1, 'Fill interval is 0.1mm');

// ─── TEST: PLAN OPTIMIZER ────────────────────────────────────────

console.log('\n=== Test: Plan Optimizer ===');

const plan: Plan = optimizePlan(job);

// Plan should have one PlannedOperation per operation (1 pass each)
assert(plan.operations.length === 3, 'Plan has 3 planned operations');

// Verify operation names preserved
const planNames = plan.operations.map(op => op.layerName);
assert(planNames.includes('Engrave'), 'Plan includes Engrave operation');
assert(planNames.includes('Score Lines'), 'Plan includes Score operation');
assert(planNames.includes('Cut'), 'Plan includes Cut operation');

// All operations should be pass 0 (single pass)
assert(plan.operations.every(op => op.passIndex === 0), 'All operations are single-pass (index 0)');

// ─── TEST: MOVE SEQUENCE STRUCTURE ───────────────────────────────

console.log('\n=== Test: Move Sequence Structure ===');

// Find the cut operation in the plan
const cutPlanned = plan.operations.find(op => op.layerName === 'Cut')!;
const cutMoves = cutPlanned.moves;

// Cut operation has 2 paths (rect + circle), so expect:
// setAir(on) + [rapid, laserOn, ...linear, laserOff] × 2 + setAir(off)

// First move should be air assist ON
assert(cutMoves[0].type === 'setAir', 'Cut starts with air assist');
assert(cutMoves[0].type === 'setAir' && cutMoves[0].on === true, 'Air assist is ON');

// Last move should be air assist OFF
assert(cutMoves[cutMoves.length - 1].type === 'setAir', 'Cut ends with air assist');
assert(cutMoves[cutMoves.length - 1].type === 'setAir' && (cutMoves[cutMoves.length - 1] as any).on === false, 'Air assist is OFF');

// Count laserOn and laserOff — should be exactly 2 each (one per path)
const laserOnCount = cutMoves.filter(m => m.type === 'laserOn').length;
const laserOffCount = cutMoves.filter(m => m.type === 'laserOff').length;
assert(laserOnCount === 2, `Cut has 2 laserOn moves (one per path), got ${laserOnCount}`);
assert(laserOffCount === 2, `Cut has 2 laserOff moves (one per path), got ${laserOffCount}`);

// Verify laserOn always comes before laserOff (no interleaving)
let laserState = false;
let orderCorrect = true;
for (const move of cutMoves) {
  if (move.type === 'laserOn') {
    if (laserState) { orderCorrect = false; break; }  // laserOn without prior laserOff
    laserState = true;
  }
  if (move.type === 'laserOff') {
    if (!laserState) { orderCorrect = false; break; }  // laserOff without prior laserOn
    laserState = false;
  }
}
assert(orderCorrect, 'Laser state transitions are correctly ordered (on→off→on→off)');
assert(!laserState, 'Laser ends in OFF state');

// Every rapid must appear when laser is OFF
let laserDuringRapid = false;
let ls = false;
for (const move of cutMoves) {
  if (move.type === 'laserOn') ls = true;
  if (move.type === 'laserOff') ls = false;
  if (move.type === 'rapid' && ls) { laserDuringRapid = true; break; }
}
assert(!laserDuringRapid, 'No rapid moves occur while laser is ON');

// Verify laserOn carries correct power from settings
const firstLaserOn = cutMoves.find(m => m.type === 'laserOn');
assert(firstLaserOn !== undefined && firstLaserOn.type === 'laserOn' && firstLaserOn.power === 80, 'laserOn carries power=80 from cut settings');

// ─── TEST: SCORE OPERATION ───────────────────────────────────────

console.log('\n=== Test: Score Operation ===');

const scorePlanned = plan.operations.find(op => op.layerName === 'Score Lines')!;
const scoreMoves = scorePlanned.moves;

// Score has 1 path (the fold line), no air assist (score default is false)
const scoreLaserOns = scoreMoves.filter(m => m.type === 'laserOn').length;
assert(scoreLaserOns === 1, 'Score has 1 laserOn (one line path)');

// Score line is not closed, so no closing linear move
const scoreLinears = scoreMoves.filter(m => m.type === 'linear').length;
assert(scoreLinears === 1, 'Score has 1 linear move (open path, 2 points → 1 segment)');

// ─── TEST: INSIDE-FIRST ORDERING ─────────────────────────────────

console.log('\n=== Test: Inside-First Ordering ===');

// Create a scene with a large outer square and a small inner square.
// The inner square MUST be cut before the outer square.
const ifScene = createScene(400, 400, 'Inside-First Test');
const ifLayer = ifScene.layers[0]; // Default cut layer

const outerSquare = createRect(ifLayer.id, 10, 10, 200, 200, 'Outer');
const innerSquare = createRect(ifLayer.id, 60, 60, 80, 80, 'Inner');

// Add outer FIRST — optimizer must still cut inner first
ifScene.objects.push(outerSquare, innerSquare);

const ifJob = compileJob(ifScene);
assert(ifJob.operations.length === 1, 'IF: Job has 1 cut operation');

const ifCutOp = ifJob.operations[0];
if (ifCutOp.geometry.type === 'vector') {
  assert(ifCutOp.geometry.paths.length === 2, 'IF: 2 paths (outer + inner)');
}

const ifPlan = optimizePlan(ifJob);
assert(ifPlan.operations.length === 1, 'IF: Plan has 1 planned operation');

const ifMoves = ifPlan.operations[0].moves;

// Find the rapid moves — they tell us which path is visited first.
// First rapid = first path to cut. Second rapid = second path.
const rapids = ifMoves.filter(m => m.type === 'rapid');
assert(rapids.length === 2, 'IF: 2 rapid moves (one per path)');

if (rapids.length === 2 && rapids[0].type === 'rapid' && rapids[1].type === 'rapid') {
  const firstRapidTo = rapids[0].to;
  const secondRapidTo = rapids[1].to;

  // Inner square starts at (60, 60). Outer starts at (10, 10).
  // The first rapid should go to the inner square's region.
  const firstGoesToInner =
    firstRapidTo.x >= 60 && firstRapidTo.x <= 140 &&
    firstRapidTo.y >= 60 && firstRapidTo.y <= 140;

  const secondGoesToOuter =
    secondRapidTo.x <= 10.01 || secondRapidTo.y <= 10.01 ||
    secondRapidTo.x >= 209.99 || secondRapidTo.y >= 209.99 ||
    (secondRapidTo.x >= 10 && secondRapidTo.y >= 10);

  assert(firstGoesToInner, `IF: Inner square cut FIRST (rapid to ${firstRapidTo.x.toFixed(1)}, ${firstRapidTo.y.toFixed(1)})`);
  assert(secondGoesToOuter, `IF: Outer square cut SECOND (rapid to ${secondRapidTo.x.toFixed(1)}, ${secondRapidTo.y.toFixed(1)})`);
}

// Also test: three levels of nesting
const ifScene2 = createScene(400, 400, 'Triple Nesting');
const ifLayer2 = ifScene2.layers[0];
const big = createRect(ifLayer2.id, 0, 0, 300, 300, 'Big');
const mid = createRect(ifLayer2.id, 50, 50, 200, 200, 'Mid');
const small = createRect(ifLayer2.id, 100, 100, 100, 100, 'Small');
ifScene2.objects.push(big, mid, small);

const ifJob2 = compileJob(ifScene2);
const ifPlan2 = optimizePlan(ifJob2);
const ifRapids2 = ifPlan2.operations[0].moves.filter(m => m.type === 'rapid');
assert(ifRapids2.length === 3, 'IF3: 3 rapid moves for triple nesting');

if (ifRapids2.length === 3 && ifRapids2[0].type === 'rapid' && ifRapids2[1].type === 'rapid' && ifRapids2[2].type === 'rapid') {
  // First rapid should go to innermost (Small at 100,100)
  // Second rapid should go to middle (Mid at 50,50)
  // Third rapid should go to outermost (Big at 0,0)
  const r0 = ifRapids2[0].to;
  const r1 = ifRapids2[1].to;
  const r2 = ifRapids2[2].to;

  // Innermost is deepest — its first point should be closest to (100,100)
  const firstIsInnermost = r0.x >= 100 && r0.y >= 100;
  const lastIsOutermost = r2.x <= 0.01 || r2.y <= 0.01;

  assert(firstIsInnermost, `IF3: Innermost cut first (rapid to ${r0.x.toFixed(0)},${r0.y.toFixed(0)})`);
  assert(lastIsOutermost, `IF3: Outermost cut last (rapid to ${r2.x.toFixed(0)},${r2.y.toFixed(0)})`);
}

// ─── TEST: FILL SCANLINE GENERATION ──────────────────────────────

console.log('\n=== Test: Fill Scanline Generation ===');

// Create a scene with one rectangle on an engrave layer
const fillScene = createScene(400, 400, 'Fill Test');
const fillLayer = createLayer(0, 'engrave', 'Engrave Fill');
fillLayer.settings.fill.interval = 1.0;    // 1mm spacing for easy counting
fillLayer.settings.fill.angle = 0;          // horizontal scanlines
fillLayer.settings.fill.biDirectional = true;
fillLayer.settings.fill.overscanning = 0;   // no overscan for precise testing
fillScene.layers = [fillLayer];

// 10mm × 20mm rectangle at (50, 50)
const fillRect = createRect(fillLayer.id, 50, 50, 10, 20, 'Fill Rect');
fillScene.objects.push(fillRect);

const fillJob = compileJob(fillScene);
assert(fillJob.operations.length === 1, 'Fill: 1 engrave operation');
assert(fillJob.operations[0].type === 'engrave', 'Fill: operation type is engrave');
assert(fillJob.operations[0].geometry.type === 'fill', 'Fill: geometry type is fill');

const fillPlan = optimizePlan(fillJob);
assert(fillPlan.operations.length === 1, 'Fill: plan has 1 operation');

const fillMoves = fillPlan.operations[0].moves;

// Count scanlines — a 20mm tall rect at 1mm interval ≈ ~19 scanlines
// (offset by half-interval from edges, so slightly fewer than height/interval)
const fillRapids = fillMoves.filter(m => m.type === 'rapid');
const fillLinears = fillMoves.filter(m => m.type === 'linear');
const fillLaserOns = fillMoves.filter(m => m.type === 'laserOn');
const fillLaserOffs = fillMoves.filter(m => m.type === 'laserOff');

assert(fillRapids.length > 0, `Fill: has rapid moves (${fillRapids.length})`);
assert(fillLinears.length > 0, `Fill: has linear moves (${fillLinears.length})`);
assert(fillLaserOns.length === fillLinears.length, 'Fill: laserOn count matches linear count (one per scanline)');
assert(fillLaserOffs.length === fillLinears.length, 'Fill: laserOff count matches linear count (one per scanline)');

// Each scanline should be ~10mm wide (rectangle width)
// Allow some tolerance for float math
const firstLinear = fillLinears[0];
if (firstLinear.type === 'linear') {
  const firstRapid = fillRapids[0];
  if (firstRapid.type === 'rapid') {
    const scanWidth = Math.abs(firstLinear.to.x - firstRapid.to.x);
    assert(Math.abs(scanWidth - 10) < 0.5, `Fill: scanline width ≈ 10mm (got ${scanWidth.toFixed(2)})`);
  }
}

// Verify scanline count is reasonable (height / interval, approximately)
const expectedLines = Math.floor(20 / 1.0);  // 20mm height / 1mm interval
assert(fillLinears.length >= expectedLines - 2, `Fill: at least ${expectedLines - 2} scanlines (got ${fillLinears.length})`);
assert(fillLinears.length <= expectedLines + 2, `Fill: at most ${expectedLines + 2} scanlines (got ${fillLinears.length})`);

// Verify bidirectional: first two linears should go opposite directions
if (fillLinears.length >= 2 && fillLinears[0].type === 'linear' && fillLinears[1].type === 'linear') {
  const dir0 = fillLinears[0].to.x - (fillRapids[0].type === 'rapid' ? fillRapids[0].to.x : 0);
  const dir1 = fillLinears[1].to.x - (fillRapids[1].type === 'rapid' ? fillRapids[1].to.x : 0);
  const isAlternating = (dir0 > 0 && dir1 < 0) || (dir0 < 0 && dir1 > 0);
  assert(isAlternating, 'Fill: bidirectional — scanlines alternate direction');
}

// Verify laserOn power matches layer settings
const fillFirstOn = fillLaserOns[0];
if (fillFirstOn.type === 'laserOn') {
  assert(fillFirstOn.power === fillLayer.settings.power.max, `Fill: laserOn power = ${fillLayer.settings.power.max}%`);
}

console.log(`  ℹ Scanlines: ${fillLinears.length}`);
console.log(`  ℹ Total fill moves: ${fillMoves.length}`);

// ─── TEST: MAIN SCENE ENGRAVE OPERATION ──────────────────────────

console.log('\n=== Test: Main Scene Engrave Now Uses Fill ===');

// The original scene has an engrave layer — verify it now generates scanlines
const engravePlanned = plan.operations.find(op => op.layerName === 'Engrave')!;
const engraveMoves = engravePlanned.moves;
const engraveLinears = engraveMoves.filter(m => m.type === 'linear').length;
const engraveRapids = engraveMoves.filter(m => m.type === 'rapid').length;

// With scanlines: many linears (one per scanline) and many rapids
// Previous behavior was 4 linears (rectangle outline) — now should be much more
assert(engraveLinears > 10, `Engrave: uses scanlines, not outline (${engraveLinears} linear moves)`);
assert(engraveRapids === engraveLinears, `Engrave: rapid count matches linear count (${engraveRapids})`);

// ─── TEST: RASTER (1-BIT) SCANLINE GENERATION ────────────────────

console.log('\n=== Test: Raster 1-bit Scanline Generation ===');

// Create a synthetic 10×10 1-bit bitmap with a known pattern:
// Row 0: ██████████  (all ON)
// Row 1: ██████████  (all ON)
// Row 2: ___██████_  (cols 3-8 ON)
// Row 3: ___██████_  (cols 3-8 ON)
// Row 4: __________  (all OFF — should be skipped)
// Row 5: __________  (all OFF — should be skipped)
// Row 6: ██__██__██  (3 separate segments)
// Row 7: ██__██__██  (3 separate segments)
// Row 8: __________  (all OFF)
// Row 9: ██████████  (all ON)

const bitmapWidth = 10;
const bitmapHeight = 10;
const bitmapData = new Uint8Array(bitmapWidth * bitmapHeight);

// Fill known rows
function setRow(row: number, pattern: number[]) {
  for (let i = 0; i < pattern.length; i++) {
    bitmapData[row * bitmapWidth + i] = pattern[i];
  }
}
setRow(0, [1,1,1,1,1,1,1,1,1,1]);
setRow(1, [1,1,1,1,1,1,1,1,1,1]);
setRow(2, [0,0,0,1,1,1,1,1,1,0]);
setRow(3, [0,0,0,1,1,1,1,1,1,0]);
// rows 4,5 = all zero (default)
setRow(6, [1,1,0,0,1,1,0,0,1,1]);
setRow(7, [1,1,0,0,1,1,0,0,1,1]);
// row 8 = all zero
setRow(9, [1,1,1,1,1,1,1,1,1,1]);

const testBitmap: ProcessedBitmap = {
  width: bitmapWidth,
  height: bitmapHeight,
  dpi: 254,  // 0.1mm per pixel
  mode: '1bit',
  data: bitmapData,
  physicalWidth: bitmapWidth * (25.4 / 254),   // ~1mm
  physicalHeight: bitmapHeight * (25.4 / 254),  // ~1mm
  position: { x: 100, y: 100 },
  pipeline: { brightness: 0, contrast: 0, gamma: 1, ditheringMode: 'threshold', inverted: false },
};

// Build a synthetic Job with one raster operation
const rasterSettings: ResolvedLaserSettings = {
  powerMin: 10, powerMax: 80, speed: 2000,
  passes: 1, zStepPerPass: 0,
  fillInterval: 0.1, fillAngle: 0, fillMode: 'line', fillBiDirectional: true, overscanning: 0,
  overcut: 0, leadIn: 0, tabCount: 0, tabWidth: 0, insideFirst: false,
  airAssist: false,
};

const rasterJob = createEmptyJob('Raster Test', 'test');
rasterJob.operations.push({
  id: generateId(),
  layerId: 'raster-layer',
  layerName: 'Image',
  layerColor: '#F0B429',
  order: 0,
  type: 'raster',
  settings: rasterSettings,
  geometry: { type: 'raster', bitmap: testBitmap },
  bounds: {
    minX: testBitmap.position.x,
    minY: testBitmap.position.y,
    maxX: testBitmap.position.x + testBitmap.physicalWidth,
    maxY: testBitmap.position.y + testBitmap.physicalHeight,
  },
});

const rasterPlan = optimizePlan(rasterJob);
assert(rasterPlan.operations.length === 1, 'Raster: plan has 1 operation');

const rasterMoves = rasterPlan.operations[0].moves;
const rasterLinears = rasterMoves.filter(m => m.type === 'linear');
const rasterLaserOns = rasterMoves.filter(m => m.type === 'laserOn');
const rasterLaserOffs = rasterMoves.filter(m => m.type === 'laserOff');

// Count expected segments:
// Row 0: 1 segment (full row)
// Row 1: 1 segment
// Row 2: 1 segment (cols 3-8)
// Row 3: 1 segment
// Row 4: 0 (empty — skipped)
// Row 5: 0 (empty — skipped)
// Row 6: 3 segments (2+2+2 with gaps)
// Row 7: 3 segments
// Row 8: 0 (empty)
// Row 9: 1 segment
// Total: 1+1+1+1+3+3+1 = 11 segments
assert(rasterLinears.length === 11, `Raster: 11 burn segments (got ${rasterLinears.length})`);
assert(rasterLaserOns.length === 11, `Raster: 11 laserOn events`);
assert(rasterLaserOffs.length === 11, `Raster: 11 laserOff events`);

// Verify power = powerMax for 1-bit mode (all ON pixels use max power)
const rasterFirstOn = rasterLaserOns[0];
assert(rasterFirstOn.type === 'laserOn' && rasterFirstOn.power === 80, 'Raster 1-bit: laserOn power = 80%');

// Verify empty rows were skipped (no moves at rows 4, 5, 8 Y-coordinates)
const rasterRapids = rasterMoves.filter(m => m.type === 'rapid');
const rapidYs = rasterRapids.map(m => m.type === 'rapid' ? m.to.y : -1);
const pixelSize = 25.4 / 254;
const row4Y = 100 + 4 * pixelSize;
const row5Y = 100 + 5 * pixelSize;
const row8Y = 100 + 8 * pixelSize;
const hasRow4 = rapidYs.some(y => Math.abs(y - row4Y) < 0.001);
const hasRow5 = rapidYs.some(y => Math.abs(y - row5Y) < 0.001);
const hasRow8 = rapidYs.some(y => Math.abs(y - row8Y) < 0.001);
assert(!hasRow4, 'Raster: empty row 4 skipped');
assert(!hasRow5, 'Raster: empty row 5 skipped');
assert(!hasRow8, 'Raster: empty row 8 skipped');

console.log(`  ℹ Burn segments: ${rasterLinears.length}`);
console.log(`  ℹ Total raster moves: ${rasterMoves.length}`);

// ─── TEST: RASTER (8-BIT) VARIABLE POWER ─────────────────────────

console.log('\n=== Test: Raster 8-bit Variable Power ===');

// Create a 5×1 bitmap with gradient: [0, 64, 128, 192, 255]
const gradientData = new Uint8Array([0, 64, 128, 192, 255]);
const gradientBitmap: ProcessedBitmap = {
  width: 5, height: 1, dpi: 254, mode: '8bit',
  data: gradientData,
  physicalWidth: 5 * pixelSize,
  physicalHeight: 1 * pixelSize,
  position: { x: 50, y: 50 },
  pipeline: { brightness: 0, contrast: 0, gamma: 1, ditheringMode: 'none', inverted: false },
};

const gradientJob = createEmptyJob('Gradient Test', 'test');
gradientJob.operations.push({
  id: generateId(),
  layerId: 'grad-layer',
  layerName: 'Gradient',
  layerColor: '#9B6DFF',
  order: 0,
  type: 'raster',
  settings: { ...rasterSettings, powerMin: 10, powerMax: 100 },
  geometry: { type: 'raster', bitmap: gradientBitmap },
  bounds: { minX: 50, minY: 50, maxX: 50 + gradientBitmap.physicalWidth, maxY: 50 + gradientBitmap.physicalHeight },
});

const gradientPlan = optimizePlan(gradientJob);
const gradientMoves = gradientPlan.operations[0].moves;
const gradientLinears = gradientMoves.filter(m => m.type === 'linear');
const gradientLaserOns = gradientMoves.filter(m => m.type === 'laserOn');

// Pixel 0 is zero → skipped. Pixels 1-4 are non-zero → 1 segment (consecutive)
assert(gradientLinears.length === 1, `8-bit: 1 burn segment (4 consecutive non-zero pixels)`);

// Power should be mapped from max pixel (255) → powerMax (100%)
const gradientPower = gradientLaserOns[0];
assert(gradientPower.type === 'laserOn' && gradientPower.power === 100, '8-bit: power = 100% (from max pixel 255)');

console.log(`  ℹ 8-bit segments: ${gradientLinears.length}`);

// ─── TEST: PLAN STATISTICS ───────────────────────────────────────

console.log('\n=== Test: Plan Statistics ===');

assert(plan.stats.moveCount > 0, `Plan has ${plan.stats.moveCount} total moves`);
assert(plan.stats.cutDistanceMm > 0, `Cut distance: ${plan.stats.cutDistanceMm.toFixed(1)}mm`);
assert(plan.stats.rapidDistanceMm > 0, `Rapid distance: ${plan.stats.rapidDistanceMm.toFixed(1)}mm`);
assert(plan.stats.estimatedTimeSeconds > 0, `Estimated time: ${plan.stats.estimatedTimeSeconds.toFixed(1)}s`);
assert(plan.stats.operationCount === 3, 'Stats report 3 operations');

// Bounds should encompass all objects
assert(plan.bounds.minX <= 50, `Bounds minX <= 50 (got ${plan.bounds.minX.toFixed(1)})`);
assert(plan.bounds.maxX >= 250, `Bounds maxX >= 250 (got ${plan.bounds.maxX.toFixed(1)})`);

console.log(`  ℹ Total moves: ${plan.stats.moveCount}`);
console.log(`  ℹ Cut distance: ${plan.stats.cutDistanceMm.toFixed(1)}mm`);
console.log(`  ℹ Rapid distance: ${plan.stats.rapidDistanceMm.toFixed(1)}mm`);
console.log(`  ℹ Estimated time: ${plan.stats.estimatedTimeSeconds.toFixed(1)}s`);

// ─── TEST: OUTPUT GENERATION (GRBL) ─────────────────────────────

console.log('\n=== Test: Output Generation (GRBL) ===');

const grblStrategy = getOutputStrategy('grbl');
assert(grblStrategy !== undefined, 'GRBL strategy is registered');

if (grblStrategy) {
  const { plan: machinePlan } = applyMachineTransform(plan, {
    startMode: 'current',
    savedOrigin: null,
    flipY: true,
  });
  const output = grblStrategy.generate(machinePlan, job);
  
  assert(output.format === 'grbl', 'Output format is GRBL');
  assert(output.text !== null, 'Output has text content');
  assert(output.lineCount > 0, 'Output has lines');
  assert(output.fileSizeBytes > 0, 'Output has file size');
  
  const text = output.text!;
  assert(text.includes('G21'), 'G-code includes G21 (mm mode)');
  assert(text.includes('G90'), 'G-code includes G90 (absolute)');
  assert(text.includes('M4'), 'G-code includes M4 (dynamic laser ON)');
  assert(text.includes('M5'), 'G-code includes M5 (laser OFF)');
  assert(text.includes('G0'), 'G-code includes G0 (rapid moves)');
  assert(text.includes('G1'), 'G-code includes G1 (linear moves)');
  assert(text.includes('M2'), 'G-code includes M2 (program end)');
  assert(text.includes('M8'), 'G-code includes M8 (air assist ON)');
  assert(text.includes('M9'), 'G-code includes M9 (air assist OFF)');
  
  // Verify M4 appears BEFORE the first G1 in the output
  const m4Pos = text.indexOf('M4');
  const firstG1 = text.indexOf('G1');
  assert(m4Pos < firstG1, 'M4 (laser on) appears before first G1 (cut move)');

  // Verify M5 appears AFTER M4 (laser on before off)
  const firstM5After = text.indexOf('M5 S0', m4Pos);
  assert(firstM5After > m4Pos, 'M5 (laser off) appears after M4 (laser on)');
  
  console.log(`  ℹ G-code: ${output.lineCount} lines, ${output.fileSizeBytes} bytes`);
  console.log('\n--- G-code Preview (first 25 lines) ---');
  text.split('\n').slice(0, 25).forEach(line => console.log(`  ${line}`));
  console.log('  ...');
}

// ─── RESULTS ─────────────────────────────────────────────────────

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

if (failed > 0) {
  process.exit(1);
}
