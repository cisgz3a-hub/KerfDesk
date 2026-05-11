/**
 * T1-146: regression test for the pure predicates + color mapping
 * extracted from SceneRenderer.
 *
 * Run: npx tsx tests/scene-renderer-predicates.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AABB, Matrix3x2 } from '../src/core/types';
import {
  isCurrentTransformFinite,
  isRenderableAabb,
  isSafeObjectMatrix,
  previewStrokeForMode,
} from '../src/ui/renderers/sceneRendererPredicates';

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

function mockCtx(matrix: { a: number; b: number; c: number; d: number; e: number; f: number }): CanvasRenderingContext2D {
  return { getTransform: () => matrix } as unknown as CanvasRenderingContext2D;
}

console.log('\n=== T1-146 scene renderer predicates ===\n');

// -------- isCurrentTransformFinite --------
{
  assert(isCurrentTransformFinite(mockCtx({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })),
    'identity transform → finite');
  assert(!isCurrentTransformFinite(mockCtx({ a: NaN, b: 0, c: 0, d: 1, e: 0, f: 0 })),
    'NaN in a → not finite');
  assert(!isCurrentTransformFinite(mockCtx({ a: 1, b: Infinity, c: 0, d: 1, e: 0, f: 0 })),
    'Infinity in b → not finite');
  assert(!isCurrentTransformFinite(mockCtx({ a: 1, b: 0, c: 0, d: 1, e: -Infinity, f: 0 })),
    '-Infinity in e → not finite');
}

// -------- isRenderableAabb --------
{
  assert(isRenderableAabb({ minX: 0, minY: 0, maxX: 10, maxY: 10 } as AABB),
    'positive 10x10 AABB → renderable');
  assert(!isRenderableAabb({ minX: 10, minY: 10, maxX: 10, maxY: 10 } as AABB),
    'collapsed point AABB → not renderable');
  assert(!isRenderableAabb({ minX: 10, minY: 0, maxX: 5, maxY: 10 } as AABB),
    'inverted X (maxX < minX) → not renderable');
  assert(!isRenderableAabb({ minX: 0, minY: 10, maxX: 10, maxY: 5 } as AABB),
    'inverted Y → not renderable');
  assert(!isRenderableAabb({ minX: NaN, minY: 0, maxX: 10, maxY: 10 } as AABB),
    'NaN in minX → not renderable');
  assert(!isRenderableAabb({ minX: 0, minY: 0, maxX: Infinity, maxY: 10 } as AABB),
    'Infinity in maxX → not renderable');
}

// -------- isSafeObjectMatrix --------
{
  assert(isSafeObjectMatrix({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } as Matrix3x2),
    'identity 2D matrix → safe');
  assert(isSafeObjectMatrix({ a: 2, b: 0.5, c: -0.5, d: 2, tx: 10, ty: 20 } as Matrix3x2),
    'mixed scale + skew + translate → safe');
  assert(!isSafeObjectMatrix({ a: NaN, b: 0, c: 0, d: 1, tx: 0, ty: 0 } as Matrix3x2),
    'NaN in a → not safe');
  assert(!isSafeObjectMatrix({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: Infinity } as Matrix3x2),
    'Infinity in ty → not safe');
}

// -------- previewStrokeForMode --------
{
  assert(previewStrokeForMode('cut') === '#ff4466', 'cut → #ff4466 (red-pink)');
  assert(previewStrokeForMode('engrave') === '#00d4ff', 'engrave → #00d4ff (cyan)');
  assert(previewStrokeForMode('score') === '#2dd4a0', 'score → #2dd4a0 (mint)');
  assert(previewStrokeForMode('image') === '#8888aa', 'image → #8888aa (muted gray)');
  // default fallback
  assert(previewStrokeForMode('unknown' as never) === '#8888aa',
    'unknown mode → #8888aa fallback');
}

// -------- Source-level pin: SceneRenderer delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const rendererSrc = readFileSync(
    resolve(here, '../src/ui/renderers/SceneRenderer.ts'),
    'utf-8',
  );
  assert(/from '\.\/sceneRendererPredicates'/.test(rendererSrc),
    'SceneRenderer imports from ./sceneRendererPredicates');
  assert(/T1-146/.test(rendererSrc),
    'SceneRenderer carries T1-146 marker');
  // Inline definitions are gone
  assert(!/^function isCurrentTransformFinite/m.test(rendererSrc),
    'inline isCurrentTransformFinite is gone');
  assert(!/^function isRenderableAabb/m.test(rendererSrc),
    'inline isRenderableAabb is gone');
  assert(!/^function isSafeObjectMatrix/m.test(rendererSrc),
    'inline isSafeObjectMatrix is gone');
  assert(!/^function previewStrokeForMode/m.test(rendererSrc),
    'inline previewStrokeForMode is gone');

  const helperSrc = readFileSync(
    resolve(here, '../src/ui/renderers/sceneRendererPredicates.ts'),
    'utf-8',
  );
  assert(/T1-146/.test(helperSrc),
    'sceneRendererPredicates carries T1-146 marker');
  for (const name of [
    'isCurrentTransformFinite',
    'isRenderableAabb',
    'isSafeObjectMatrix',
    'previewStrokeForMode',
  ]) {
    const re = new RegExp(`export function ${name}`);
    assert(re.test(helperSrc),
      `${name} is exported`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
