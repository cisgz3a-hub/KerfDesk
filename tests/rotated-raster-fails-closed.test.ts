/**
 * T1-187 (external audit High #6): the image CAM path must fail
 * closed when a raster's SceneObject transform has non-zero skew /
 * rotation components.
 *
 * Pre-T1-187 evidence (JobCompiler.ts:661-673):
 *   const sx = obj.transform.a;
 *   const sy = obj.transform.d;
 *   // b and c (skew / rotation) silently ignored
 *
 * A rotated image previewed rotated but compiled as axis-aligned —
 * a preview ↔ output divergence. The audit recommended either
 * "fail closed for non-axis-aligned rasters" OR "implement affine
 * raster sampling." T1-187 takes the fail-closed path; affine
 * sampling is a multi-week effort deferred to a future ticket.
 *
 * Post-T1-187: throws `RotatedRasterUnsupportedError` carrying the
 * offending object ID + full transform when `|b| > eps || |c| > eps`.
 *
 * Run: npx tsx tests/rotated-raster-fails-closed.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileJob, RotatedRasterUnsupportedError } from '../src/core/job/JobCompiler';
import { createScene } from '../src/core/scene/Scene';
import { createLayer } from '../src/core/scene/Layer';
import type { SceneObject, ImageGeometry } from '../src/core/scene/SceneObject';
import { generateId } from '../src/core/types';

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

function makeImageObject(transform: {
  a: number; b: number; c: number; d: number; tx: number; ty: number;
}): SceneObject {
  const geom: ImageGeometry = {
    type: 'image',
    originalWidth: 100,
    originalHeight: 100,
    cropWidth: 100,
    cropHeight: 100,
    cropX: 0,
    cropY: 0,
    src: 'data:image/png;base64,iVBORw0KGgo=',
    grayscaleData: new Uint8Array(100 * 100).fill(128),
    grayscaleWidth: 100,
    grayscaleHeight: 100,
  } as unknown as ImageGeometry;
  return {
    id: generateId(),
    type: 'image',
    name: 'img',
    layerId: '',
    parentId: null,
    transform,
    geometry: geom,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  } as unknown as SceneObject;
}

function compileSceneWithImage(transform: Parameters<typeof makeImageObject>[0]): {
  threw: boolean;
  err: unknown;
} {
  const scene = createScene(400, 300, 'T1-187-rotated');
  const layer = createLayer(0, 'image', 'Raster');
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  const obj = makeImageObject(transform);
  (obj as { layerId: string }).layerId = layer.id;
  scene.objects = [obj];
  try {
    compileJob(scene, { machineAccelMmPerS2: 1000, strategySupportsDynamicLaserPower: false });
    return { threw: false, err: null };
  } catch (e) {
    return { threw: true, err: e };
  }
}

console.log('\n=== T1-187 rotated/skewed raster fails closed (audit High #6) ===\n');

// -------- 1. Identity transform: NO throw --------
{
  const result = compileSceneWithImage({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
  assert(!result.threw, 'identity transform: compileJob does NOT throw');
}

// -------- 2. Scale-only transform: NO throw --------
{
  const result = compileSceneWithImage({ a: 2, b: 0, c: 0, d: 0.5, tx: 10, ty: 20 });
  assert(!result.threw, 'scale-only transform: compileJob does NOT throw');
}

// -------- 3. Negative scale (mirror): NO throw --------
{
  const result = compileSceneWithImage({ a: -1, b: 0, c: 0, d: 1, tx: 50, ty: 0 });
  assert(!result.threw, 'negative scale (mirror): compileJob does NOT throw');
}

// -------- 4. 90° rotation (b=1, c=-1): THROWS --------
{
  const result = compileSceneWithImage({ a: 0, b: 1, c: -1, d: 0, tx: 0, ty: 0 });
  assert(result.threw, '90° rotation: compileJob THROWS');
  assert(
    result.err instanceof RotatedRasterUnsupportedError,
    `90° rotation: error is RotatedRasterUnsupportedError (got ${(result.err as Error)?.name})`,
  );
  if (result.err instanceof RotatedRasterUnsupportedError) {
    assert(result.err.diagnostics.transform.b === 1, 'diagnostics.transform.b === 1');
    assert(result.err.diagnostics.transform.c === -1, 'diagnostics.transform.c === -1');
    assert(typeof result.err.diagnostics.objectId === 'string' && result.err.diagnostics.objectId.length > 0, 'diagnostics.objectId is a non-empty string');
  }
}

// -------- 5. Pure skew (c != 0, b == 0): THROWS --------
{
  const result = compileSceneWithImage({ a: 1, b: 0, c: 0.5, d: 1, tx: 0, ty: 0 });
  assert(result.threw, 'pure X-skew: compileJob THROWS');
  assert(result.err instanceof RotatedRasterUnsupportedError, 'pure X-skew: typed error');
}

// -------- 6. Tiny skew below epsilon: NO throw (numerical noise tolerated) --------
{
  const result = compileSceneWithImage({ a: 1, b: 1e-12, c: -1e-12, d: 1, tx: 0, ty: 0 });
  assert(!result.threw, 'sub-epsilon skew: compileJob does NOT throw (numerical noise)');
}

// -------- 7. Error message includes remediation --------
{
  const result = compileSceneWithImage({ a: 0, b: 1, c: -1, d: 0, tx: 0, ty: 0 });
  if (result.err instanceof RotatedRasterUnsupportedError) {
    assert(
      /rotate or flatten the image/i.test(result.err.message),
      'error message includes the remediation hint',
    );
    assert(
      /affine raster sampling/i.test(result.err.message),
      'error message names the missing feature',
    );
  }
}

// -------- 8. Source pins --------
{
  const src = readFileSync(resolve(here, '../src/core/job/JobCompiler.ts'), 'utf-8');
  assert(/T1-187/.test(src), 'JobCompiler.ts carries T1-187 marker');
  assert(/audit High #6/.test(src), 'JobCompiler.ts cross-references audit High #6');
  assert(
    /export class RotatedRasterUnsupportedError/.test(src),
    'RotatedRasterUnsupportedError class exported',
  );
  assert(
    /Math\.abs\(obj\.transform\.b\) > SKEW_EPSILON/.test(src),
    'skew check on transform.b present',
  );
  assert(
    /Math\.abs\(obj\.transform\.c\) > SKEW_EPSILON/.test(src),
    'skew check on transform.c present',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
