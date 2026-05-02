/**
 * T1-107: preflight bed-bounds and visible-layer-for-output checks
 * ignore objects on layers with output:false.
 *
 * Run: npx tsx tests/preflight-output-layer-filter.test.ts
 */
import { runBoundsChecks } from '../src/core/preflight/rules/OutputBoundsPreflight';
import { runSceneChecks } from '../src/core/preflight/rules/ScenePreflight';
import type { PreflightContext, PreflightResult } from '../src/core/preflight/Preflight';
import { createLayer, type Layer } from '../src/core/scene/Layer';
import { createRect, type SceneObject } from '../src/core/scene/SceneObject';

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

function makeLayer(id: string, opts: Partial<Layer> = {}): Layer {
  return {
    ...createLayer(0, 'cut', id),
    id,
    ...opts,
  };
}

function makeRect(id: string, layerId: string, x: number, y: number, width: number, height: number): SceneObject {
  return {
    ...createRect(layerId, x, y, width, height, id),
    id,
  };
}

function makeCtx(scene: { layers: Layer[]; objects: SceneObject[] }): PreflightContext {
  return {
    scene,
    profile: { bedWidth: 358, bedHeight: 268 },
    machinePlanBounds: null,
  } as unknown as PreflightContext;
}

function hasCode(out: PreflightResult[], code: string): boolean {
  return out.some(result => result.code === code);
}

console.log('\n=== T1-107 preflight ignores output:false layers ===\n');

{
  const out: PreflightResult[] = [];
  const ctx = makeCtx({
    layers: [makeLayer('L1', { output: true })],
    objects: [makeRect('O1', 'L1', 0, 0, 500, 500)],
  });
  runBoundsChecks(ctx, out);
  assert(hasCode(out, 'OUT_OF_BOUNDS_MAX'),
    'output:true + beyond bed -> OUT_OF_BOUNDS_MAX still fires');
}

{
  const out: PreflightResult[] = [];
  const ctx = makeCtx({
    layers: [makeLayer('L1', { output: false })],
    objects: [makeRect('O1', 'L1', 0, 0, 500, 500)],
  });
  runBoundsChecks(ctx, out);
  assert(!hasCode(out, 'OUT_OF_BOUNDS_MAX') && !hasCode(out, 'OUT_OF_BOUNDS_MIN'),
    'output:false guide layer beyond bed -> no OUT_OF_BOUNDS error');
}

{
  const out: PreflightResult[] = [];
  const ctx = makeCtx({
    layers: [
      makeLayer('L1', { output: true }),
      makeLayer('L2', { output: false }),
    ],
    objects: [
      makeRect('O1', 'L1', 10, 10, 50, 50),
      makeRect('O2', 'L2', 0, 0, 500, 500),
    ],
  });
  runBoundsChecks(ctx, out);
  assert(!hasCode(out, 'OUT_OF_BOUNDS_MAX') && !hasCode(out, 'OUT_OF_BOUNDS_MIN'),
    'mixed: only guide-layer object beyond bed -> no error');
}

{
  const out: PreflightResult[] = [];
  const ctx = makeCtx({
    layers: [
      makeLayer('L1', { output: true }),
      makeLayer('L2', { output: false }),
    ],
    objects: [
      makeRect('O1', 'L1', 0, 0, 500, 500),
      makeRect('O2', 'L2', 10, 10, 50, 50),
    ],
  });
  runBoundsChecks(ctx, out);
  assert(hasCode(out, 'OUT_OF_BOUNDS_MAX'),
    'output:true beyond bed with separate guide in bounds -> OUT_OF_BOUNDS_MAX still fires');
}

{
  const out: PreflightResult[] = [];
  const ctx = makeCtx({
    layers: [makeLayer('L1', { output: false })],
    objects: [makeRect('O1', 'L1', 10, 10, 50, 50)],
  });
  runSceneChecks(ctx, out);
  assert(hasCode(out, 'NO_VISIBLE_LAYERS'),
    'all output:false -> NO_VISIBLE_LAYERS error fires');
}

{
  const out: PreflightResult[] = [];
  const ctx = makeCtx({
    layers: [
      makeLayer('L1', { output: true }),
      makeLayer('L2', { output: false }),
    ],
    objects: [
      makeRect('O1', 'L1', 10, 10, 50, 50),
      makeRect('O2', 'L2', 30, 30, 20, 20),
    ],
  });
  runSceneChecks(ctx, out);
  assert(!hasCode(out, 'NO_VISIBLE_LAYERS'),
    'at least one output:true with content -> no NO_VISIBLE_LAYERS error');
}

{
  const out: PreflightResult[] = [];
  const ctx = makeCtx({
    layers: [makeLayer('L1', { visible: false, output: true })],
    objects: [makeRect('O1', 'L1', 10, 10, 50, 50)],
  });
  runSceneChecks(ctx, out);
  assert(hasCode(out, 'NO_VISIBLE_LAYERS'),
    'invisible output:true layer -> NO_VISIBLE_LAYERS still fires');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

export {};
