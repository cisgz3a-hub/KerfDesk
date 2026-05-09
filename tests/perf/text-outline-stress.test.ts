/**
 * T3-40: text outline stress guardrails.
 *
 * Run: npx tsx tests/perf/text-outline-stress.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { expandTextOutlinesForCompile, textOutlineFingerprint } from '../../src/geometry/expandTextForCompile';
import { createScene, type Scene } from '../../src/core/scene/Scene';
import { createLayer } from '../../src/core/scene/Layer';
import { compileJob } from '../../src/core/job/JobCompiler';
import { optimizePlan } from '../../src/core/plan/PlanOptimizer';
import { generateId, IDENTITY_MATRIX } from '../../src/core/types';
import type { SceneObject, TextGeometry } from '../../src/core/scene/SceneObject';

function makeTextScene(text: string): Scene {
  const scene = createScene(400, 300, 'T3-40 text outline stress');
  const layer = createLayer(0, 'cut', 'Cut');
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  const geometry: TextGeometry = {
    type: 'text',
    text,
    fontSize: 8,
    fontFamily: 'Hershey Sans',
    bold: false,
    italic: false,
    textAlign: 'left',
    letterSpacing: 0,
    lineSpacing: 120,
    wordSpacing: 100,
  };
  const object: SceneObject = {
    id: generateId(),
    type: 'text',
    name: 'large-paragraph',
    layerId: layer.id,
    parentId: null,
    transform: { ...IDENTITY_MATRIX, tx: 10, ty: 20 },
    geometry,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
  scene.objects = [object];
  return scene;
}

function outlineCount(scene: Scene): number {
  const geom = scene.objects[0]?.geometry;
  assert.equal(geom?.type, 'text');
  return geom.outlineSubPaths?.length ?? 0;
}

test('large paragraph converts to outlines, plans, and reuses bounded cache clones', async () => {
  const paragraph = [
    'LASERFORGE STRESS TEST NAME PLATE',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789',
    'Repeatable text outlines should stay selectable and compilable.',
  ].join('\n');

  const expandedA = await expandTextOutlinesForCompile(makeTextScene(paragraph));
  assert.equal(expandedA.failedTextObjects.length, 0);
  assert.ok(outlineCount(expandedA.scene) > 0, 'first expansion produced text outlines');

  const expandedB = await expandTextOutlinesForCompile(makeTextScene(paragraph));
  assert.equal(expandedB.failedTextObjects.length, 0);
  assert.equal(outlineCount(expandedA.scene), outlineCount(expandedB.scene), 'cache hit preserves outline count');
  const geomA = expandedA.scene.objects[0].geometry;
  const geomB = expandedB.scene.objects[0].geometry;
  assert.equal(geomA.type, 'text');
  assert.equal(geomB.type, 'text');
  assert.notEqual(geomA.outlineSubPaths, geomB.outlineSubPaths, 'cache returns clones, not shared mutable outline arrays');

  const job = compileJob(expandedB.scene);
  const plan = optimizePlan(job);
  assert.ok(job.operations.length > 0, 'expanded text compiles into an operation');
  assert.ok(plan.stats.moveCount > 0, 'expanded text produces plan moves');
});

test('text outline fingerprint invalidates on edit and cache remains source-bounded', async () => {
  const base = makeTextScene('Large customer name');
  const edited = makeTextScene('Large customer name Jr.');
  const baseText = base.objects[0].geometry as TextGeometry;
  const editedText = edited.objects[0].geometry as TextGeometry;

  assert.notEqual(
    textOutlineFingerprint(baseText),
    textOutlineFingerprint(editedText),
    'editing the text changes the outline-cache fingerprint',
  );

  for (let i = 0; i < 20; i++) {
    const expanded = await expandTextOutlinesForCompile(makeTextScene(`Customer ${i} - ${'X'.repeat(30)}`));
    assert.equal(expanded.failedTextObjects.length, 0);
    assert.ok(outlineCount(expanded.scene) > 0);
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.resolve(here, '../../src/geometry/expandTextForCompile.ts'), 'utf-8');
  assert.match(source, /const TEXT_OUTLINE_CACHE_MAX = 64/);
  assert.match(source, /while \(textOutlineCache\.size > TEXT_OUTLINE_CACHE_MAX\)/);
});
