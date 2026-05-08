/**
 * T1-109: frame bounds (used by buildFrameCorners → frame motion)
 * must filter by layer.output, the same predicate the JobCompiler
 * uses. Pre-T1-109 the inline sceneBounds in App.tsx filtered only
 * by obj.visible, so guide / reference layers (output: false)
 * inflated the frame box and frame motion walked beyond the burn
 * area — including off-bed.
 *
 * Mirror of T1-107 (preflight) at the frame call site.
 *
 * Run: npx tsx tests/frame-bounds-output-layer-filter.test.ts
 */
import { computeOutputBounds, computeSceneBounds } from '../src/geometry/bounds';
import { createScene } from '../src/core/scene/Scene';
import { createLayer, type Layer } from '../src/core/scene/Layer';
import { createRect, type SceneObject } from '../src/core/scene/SceneObject';
import * as fs from 'fs';
import * as path from 'path';

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
    visible: opts.visible ?? true,
    output: opts.output ?? true,
    ...opts,
  };
}

function makeRect(id: string, layerId: string, x: number, y: number, width: number, height: number): SceneObject {
  return {
    ...createRect(layerId, x, y, width, height, id),
    id,
    visible: true,
  };
}

function buildScene(layers: Layer[], objects: SceneObject[]) {
  const scene = createScene();
  return { ...scene, layers, objects };
}

console.log('\n=== T1-109 frame bounds filter by layer.output ===\n');

// 1. output:true engrave + output:false guide → only engrave AABB
{
  const engrave = makeLayer('engrave', { output: true });
  const guide = makeLayer('guide', { output: false });
  const scene = buildScene(
    [engrave, guide],
    [
      makeRect('E1', engrave.id, 50, 50, 100, 50),  // engrave 50..150 x 50..100
      makeRect('G1', guide.id, 0, 0, 500, 500),      // guide 0..500 (much larger)
    ],
  );
  const out = computeOutputBounds(scene);
  assert(
    out.minX === 50 && out.minY === 50 && out.maxX === 150 && out.maxY === 100,
    'output:true engrave + output:false guide → bounds match engrave only (not the guide)',
  );

  const all = computeSceneBounds(scene);
  assert(
    all.minX === 0 && all.minY === 0 && all.maxX === 500 && all.maxY === 500,
    'computeSceneBounds (regression) still returns the full union including guide',
  );
}

// 2. all output:false with content → empty bounds
{
  const guide1 = makeLayer('g1', { output: false });
  const guide2 = makeLayer('g2', { output: false });
  const scene = buildScene(
    [guide1, guide2],
    [
      makeRect('A', guide1.id, 0, 0, 100, 100),
      makeRect('B', guide2.id, 200, 200, 50, 50),
    ],
  );
  const out = computeOutputBounds(scene);
  assert(
    !Number.isFinite(out.minX) || out.minX > out.maxX,
    'all output:false → empty AABB (no inflation)',
  );
}

// 3. hidden layer (visible:false) ignored even when output:true
{
  const visibleEngrave = makeLayer('vis', { visible: true, output: true });
  const hiddenEngrave = makeLayer('hid', { visible: false, output: true });
  const scene = buildScene(
    [visibleEngrave, hiddenEngrave],
    [
      makeRect('V', visibleEngrave.id, 10, 10, 20, 20),    // 10..30
      makeRect('H', hiddenEngrave.id, 100, 100, 200, 200), // would inflate if not filtered
    ],
  );
  const out = computeOutputBounds(scene);
  assert(
    out.minX === 10 && out.minY === 10 && out.maxX === 30 && out.maxY === 30,
    'hidden layer (visible:false) ignored even when output:true',
  );
}

// 4. hidden object (obj.visible:false) ignored even on visible+output layer
{
  const layer = makeLayer('L', { visible: true, output: true });
  const visibleObj = makeRect('V', layer.id, 10, 10, 20, 20);
  const hiddenObj = { ...makeRect('H', layer.id, 100, 100, 200, 200), visible: false };
  const scene = buildScene([layer], [visibleObj, hiddenObj]);
  const out = computeOutputBounds(scene);
  assert(
    out.minX === 10 && out.minY === 10 && out.maxX === 30 && out.maxY === 30,
    'hidden object (obj.visible:false) ignored even on visible+output layer',
  );
}

// 5. Source-pin: App.tsx no longer iterates raw scene.objects with visible-only filter
{
  const appPath = path.resolve(__dirname, '..', 'src', 'ui', 'components', 'App.tsx');
  const src = fs.readFileSync(appPath, 'utf8');
  assert(
    src.includes('computeOutputBounds(scene)'),
    'App.tsx imports and uses computeOutputBounds(scene)',
  );
  assert(
    !/for\s+\(const\s+obj\s+of\s+scene\.objects\)\s*\{[\s\S]{0,80}if\s+\(!obj\.visible\)\s+continue;[\s\S]{0,200}computeObjectBounds\(obj\)/.test(src),
    'App.tsx no longer contains the inline visible-only sceneBounds loop',
  );
}

// 6. Match JobCompiler's getOutputLayers + visible-object set:
//    parity check against the canonical compile-side filter.
{
  const layerA = makeLayer('A', { visible: true, output: true });
  const layerB = makeLayer('B', { visible: true, output: false });
  const layerC = makeLayer('C', { visible: false, output: true });
  const scene = buildScene(
    [layerA, layerB, layerC],
    [
      makeRect('a1', layerA.id, 10, 10, 40, 40),
      makeRect('b1', layerB.id, 0, 0, 500, 500),
      makeRect('c1', layerC.id, 200, 200, 100, 100),
    ],
  );

  const out = computeOutputBounds(scene);

  // Mirror getOutputLayers + objectsOnLayerInSceneOrder predicate
  const outputLayerIds = new Set(scene.layers.filter(l => l.visible && l.output).map(l => l.id));
  const compileSet = scene.objects.filter(o => o.visible && outputLayerIds.has(o.layerId));
  assert(
    compileSet.length === 1 && compileSet[0]!.id === 'a1',
    'compile-side filter (mirror) selects exactly 1 object: a1',
  );

  // The bounds returned by computeOutputBounds must equal the AABB
  // of that compile-side set, by construction.
  assert(
    out.minX === 10 && out.minY === 10 && out.maxX === 50 && out.maxY === 50,
    'computeOutputBounds AABB matches the JobCompiler compile-side set AABB',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

export {};
