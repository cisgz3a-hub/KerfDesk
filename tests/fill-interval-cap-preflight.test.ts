/**
 * F45-12-001: dense fills must not silently coarsen the requested line
 * interval when the scanline cap is hit. The job may remain startable, but
 * preflight must disclose the effective interval so output density is not a
 * surprise.
 *
 * Run: npx tsx tests/fill-interval-cap-preflight.test.ts
 */
import {
  runCompileComplexityChecks,
} from '../src/core/preflight/rules/CompileComplexityPreflight';
import {
  PREFLIGHT_CODES,
  type PreflightContext,
  type PreflightResult,
} from '../src/core/preflight/Preflight';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { createLayer } from '../src/core/scene/Layer';
import type { RectGeometry, SceneObject } from '../src/core/scene/SceneObject';
import { generateId, IDENTITY_MATRIX } from '../src/core/types';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function makeRectObject(layerId: string, width: number, height: number): SceneObject {
  const geometry: RectGeometry = {
    type: 'rect',
    x: 0,
    y: 0,
    width,
    height,
    cornerRadius: 0,
  };
  return {
    id: generateId(),
    type: 'rect',
    name: 'dense-fill-rect',
    layerId,
    parentId: null,
    transform: { ...IDENTITY_MATRIX },
    geometry,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

function makeEngraveFillScene(heightMm: number, intervalMm: number): Scene {
  const scene = createScene(800, 800, `fill ${heightMm}mm @ ${intervalMm}`);
  const layer = createLayer(0, 'engrave', 'Dense fill');
  layer.settings.fill.enabled = true;
  layer.settings.fill.interval = intervalMm;
  layer.settings.fill.angle = 0;
  layer.settings.fill.mode = 'line';
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  scene.objects = [makeRectObject(layer.id, 20, heightMm)];
  return scene;
}

function makeCtx(scene: Scene): PreflightContext {
  return {
    scene,
    profile: null,
    optimizeOrderEnabled: true,
    preflightBedWidthMm: 800,
    preflightBedHeightMm: 800,
  };
}

console.log('\n=== F45-12-001 fill interval cap preflight ===\n');

{
  const out: PreflightResult[] = [];
  runCompileComplexityChecks(makeCtx(makeEngraveFillScene(600, 0.01)), out);
  const issue = out.find(result => result.code === PREFLIGHT_CODES.FILL_INTERVAL_COARSENED);

  assert(issue != null, 'dense 600mm fill emits a fill-interval coarsening warning');
  assert(issue?.severity === 'warning', 'fill-interval coarsening is non-blocking warning severity');
  assert(/0\.010/.test(issue?.message ?? ''), 'warning names the requested 0.010mm interval');
  assert(/0\.012/.test(issue?.message ?? ''), 'warning names the effective 0.012mm interval');
  assert(/50,000/.test(issue?.message ?? ''), 'warning names the 50,000 scanline cap');
}

{
  const out: PreflightResult[] = [];
  runCompileComplexityChecks(makeCtx(makeEngraveFillScene(20, 0.1)), out);
  const issue = out.find(result => result.code === PREFLIGHT_CODES.FILL_INTERVAL_COARSENED);

  assert(issue == null, 'normal small fill preserves requested interval without warning');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
