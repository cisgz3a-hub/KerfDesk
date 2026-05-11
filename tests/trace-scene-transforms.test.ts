/**
 * T1-140: regression test for the pure trace-scene transforms
 * extracted from PropertiesPanel.handleTrace.
 *
 *   - scaleSubPathsForTrace: per-axis scale of every endpoint AND
 *     every control point in a path's subpaths.
 *   - buildSceneAfterTrace: scene composition (scale, inherit
 *     transform, replace-or-append).
 *
 * Pre-T1-140 these ~40 lines were wedged inside an async useCallback
 * mixed with UI side effects. Post-T1-140 every contract is testable
 * standalone.
 *
 * Run: npx tsx tests/trace-scene-transforms.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scene } from '../src/core/scene/Scene';
import type { PathGeometry, SceneObject, SubPath } from '../src/core/scene/SceneObject';
import type { Layer } from '../src/core/scene/Layer';
import {
  buildSceneAfterTrace,
  scaleSubPathsForTrace,
} from '../src/ui/components/properties/traceSceneTransforms';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

console.log('\n=== T1-140 trace-scene transforms ===\n');

// -------- 1. scaleSubPathsForTrace: move + line endpoints --------
{
  const sp: SubPath[] = [
    {
      segments: [
        { type: 'move', to: { x: 10, y: 20 } },
        { type: 'line', to: { x: 30, y: 40 } },
        { type: 'close' },
      ],
      closed: true,
    },
  ];
  const r = scaleSubPathsForTrace(sp, 2, 3);
  const segs = r[0].segments;
  assert(segs[0].type === 'move' && (segs[0] as { to: { x: number; y: number } }).to.x === 20,
    'move endpoint X scaled by 2');
  assert((segs[0] as { to: { x: number; y: number } }).to.y === 60,
    'move endpoint Y scaled by 3');
  assert(segs[1].type === 'line' && (segs[1] as { to: { x: number; y: number } }).to.x === 60,
    'line endpoint X scaled');
  assert(segs[2].type === 'close',
    'close segment passes through');
}

// -------- 2. quadratic: cp + to scale --------
{
  const sp: SubPath[] = [
    {
      segments: [
        { type: 'quadratic', cp: { x: 5, y: 10 }, to: { x: 15, y: 20 } },
      ],
      closed: false,
    },
  ];
  const r = scaleSubPathsForTrace(sp, 2, 0.5);
  const seg = r[0].segments[0] as { cp: { x: number; y: number }; to: { x: number; y: number } };
  assert(seg.cp.x === 10 && seg.cp.y === 5, 'quadratic cp scaled');
  assert(seg.to.x === 30 && seg.to.y === 10, 'quadratic to scaled');
}

// -------- 3. cubic: cp1 + cp2 + to scale --------
{
  const sp: SubPath[] = [
    {
      segments: [
        {
          type: 'cubic',
          cp1: { x: 1, y: 2 },
          cp2: { x: 3, y: 4 },
          to: { x: 5, y: 6 },
        },
      ],
      closed: false,
    },
  ];
  const r = scaleSubPathsForTrace(sp, 10, 10);
  const seg = r[0].segments[0] as {
    cp1: { x: number; y: number };
    cp2: { x: number; y: number };
    to: { x: number; y: number };
  };
  assert(seg.cp1.x === 10 && seg.cp1.y === 20, 'cubic cp1 scaled');
  assert(seg.cp2.x === 30 && seg.cp2.y === 40, 'cubic cp2 scaled');
  assert(seg.to.x === 50 && seg.to.y === 60, 'cubic to scaled');
}

// -------- 4. scale 1.0 → identity --------
{
  const sp: SubPath[] = [
    {
      segments: [{ type: 'move', to: { x: 7, y: 11 } }],
      closed: false,
    },
  ];
  const r = scaleSubPathsForTrace(sp, 1, 1);
  const seg = r[0].segments[0] as { to: { x: number; y: number } };
  assert(seg.to.x === 7 && seg.to.y === 11, 'scale (1,1) → identity');
}

// -------- 5. doesn't mutate input --------
{
  const sp: SubPath[] = [
    {
      segments: [{ type: 'move', to: { x: 1, y: 2 } }],
      closed: false,
    },
  ];
  const original = sp[0].segments[0] as { to: { x: number } };
  const originalX = original.to.x;
  scaleSubPathsForTrace(sp, 5, 5);
  assert(original.to.x === originalX, 'input unchanged after scaling');
}

// -------- 6. buildSceneAfterTrace: deleteImage path --------
{
  const image: SceneObject = {
    id: 'img-1',
    layerId: 'l1',
    name: 'img',
    visible: true,
    locked: false,
    selected: false,
    transform: { a: 2, b: 0, c: 0, d: 2, tx: 5, ty: 6 },
    geometry: { type: 'image' } as never,
  } as unknown as SceneObject;

  const traced: SceneObject = {
    id: 'path-1',
    layerId: 'l-target',
    name: 'Trace',
    visible: true,
    locked: false,
    selected: false,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    geometry: {
      type: 'path',
      subPaths: [
        { segments: [{ type: 'move', to: { x: 1, y: 1 } }], closed: false },
      ],
    } as PathGeometry,
  } as unknown as SceneObject;

  const scene: Scene = {
    id: 's',
    version: 1,
    canvas: { width: 200, height: 200 } as never,
    objects: [image, { id: 'other', layerId: 'l1' } as unknown as SceneObject],
    layers: [{ id: 'l1' } as Layer],
    activeLayerId: 'l1',
    metadata: { name: 't' } as never,
  } as unknown as Scene;

  const layersForCommit = [
    { id: 'l1' } as Layer,
    { id: 'l-target' } as Layer,
  ];
  const r = buildSceneAfterTrace({
    scene,
    sourceImage: image,
    traced,
    scaleX: 0.5,
    scaleY: 0.5,
    targetLayerId: 'l-target',
    layersForCommit,
    deleteImageAfterTrace: true,
  });

  assert(r.scene.objects.length === 2,
    'delete-image: source replaced (other + traced = 2 objects)');
  assert(r.scene.objects.find((o) => o.id === 'img-1') === undefined,
    'delete-image: source image is gone');
  const tracedInScene = r.scene.objects.find((o) => o.id === 'path-1');
  assert(tracedInScene != null, 'delete-image: traced path is present');
  assert(tracedInScene!.transform.a === 2 && tracedInScene!.transform.tx === 5,
    'delete-image: traced inherits source image transform');
  assert(r.scene.activeLayerId === 'l-target',
    'delete-image: activeLayerId set to target');
  assert(r.scene.layers === layersForCommit,
    'delete-image: layers replaced with layersForCommit');
  assert(r.addedObjectId === 'path-1',
    'delete-image: addedObjectId returned');
  // Verify scaling happened
  const pathGeom = tracedInScene!.geometry as PathGeometry;
  const firstSeg = pathGeom.subPaths[0].segments[0] as { to: { x: number; y: number } };
  assert(firstSeg.to.x === 0.5 && firstSeg.to.y === 0.5,
    'delete-image: subPaths scaled (0.5 * 1 = 0.5)');
}

// -------- 7. buildSceneAfterTrace: keep image (append) --------
{
  const image: SceneObject = {
    id: 'img-2',
    layerId: 'l1',
    name: 'img',
    visible: true,
    locked: false,
    selected: false,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    geometry: { type: 'image' } as never,
  } as unknown as SceneObject;

  const traced: SceneObject = {
    id: 'path-2',
    layerId: 'l2',
    name: 'Trace',
    visible: true,
    locked: false,
    selected: false,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    geometry: {
      type: 'path',
      subPaths: [
        { segments: [{ type: 'move', to: { x: 0, y: 0 } }], closed: false },
      ],
    } as PathGeometry,
  } as unknown as SceneObject;

  const scene: Scene = {
    id: 's',
    version: 1,
    canvas: { width: 100, height: 100 } as never,
    objects: [image],
    layers: [{ id: 'l1' } as Layer],
    activeLayerId: 'l1',
    metadata: { name: 't' } as never,
  } as unknown as Scene;

  const r = buildSceneAfterTrace({
    scene,
    sourceImage: image,
    traced,
    scaleX: 1,
    scaleY: 1,
    targetLayerId: 'l2',
    layersForCommit: [{ id: 'l1' } as Layer, { id: 'l2' } as Layer],
    deleteImageAfterTrace: false,
  });

  assert(r.scene.objects.length === 2,
    'append: image preserved + traced added (2 total)');
  assert(r.scene.objects.find((o) => o.id === 'img-2') != null,
    'append: source image preserved');
  assert(r.scene.objects.find((o) => o.id === 'path-2') != null,
    'append: traced path added');
}

// -------- 8. doesn't mutate the input scene.objects --------
{
  const image: SceneObject = {
    id: 'img-3',
    layerId: 'l1',
    name: 'img',
    visible: true,
    locked: false,
    selected: false,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    geometry: { type: 'image' } as never,
  } as unknown as SceneObject;

  const traced: SceneObject = {
    id: 'p',
    layerId: 'l1',
    name: 'p',
    visible: true,
    locked: false,
    selected: false,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    geometry: { type: 'path', subPaths: [] } as PathGeometry,
  } as unknown as SceneObject;

  const scene: Scene = {
    id: 's',
    version: 1,
    canvas: { width: 100, height: 100 } as never,
    objects: [image],
    layers: [{ id: 'l1' } as Layer],
    activeLayerId: 'l1',
    metadata: { name: 't' } as never,
  } as unknown as Scene;

  const originalObjects = scene.objects;
  const r = buildSceneAfterTrace({
    scene,
    sourceImage: image,
    traced,
    scaleX: 1,
    scaleY: 1,
    targetLayerId: 'l1',
    layersForCommit: [{ id: 'l1' } as Layer],
    deleteImageAfterTrace: true,
  });
  assert(scene.objects === originalObjects,
    'input scene.objects reference unchanged');
  assert(r.scene.objects !== originalObjects,
    'output scene.objects is a NEW array');
}

// -------- 9. Source-level pin: PropertiesPanel delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const panelSrc = readFileSync(
    resolve(here, '../src/ui/components/PropertiesPanel.tsx'),
    'utf-8',
  );
  assert(/from '\.\/properties\/traceSceneTransforms'/.test(panelSrc),
    'PropertiesPanel imports buildSceneAfterTrace from traceSceneTransforms');
  assert(/buildSceneAfterTrace\(\{/.test(panelSrc),
    'PropertiesPanel calls buildSceneAfterTrace');
  assert(/T1-140/.test(panelSrc),
    'PropertiesPanel carries T1-140 marker');
  // The pre-T1-140 inline scaling block is gone — pin the cubic
  // cp1.x signature that was unique to the inline body.
  assert(!/cp1: \{ x: seg\.cp1\.x \* scaleX/.test(panelSrc),
    'inline cubic scaling block is gone from PropertiesPanel');

  const helperSrc = readFileSync(
    resolve(here, '../src/ui/components/properties/traceSceneTransforms.ts'),
    'utf-8',
  );
  assert(/T1-140/.test(helperSrc),
    'traceSceneTransforms carries T1-140 marker');
  assert(/export function scaleSubPathsForTrace/.test(helperSrc),
    'scaleSubPathsForTrace is exported');
  assert(/export function buildSceneAfterTrace/.test(helperSrc),
    'buildSceneAfterTrace is exported');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
