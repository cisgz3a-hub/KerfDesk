// Re-apply is an EDIT, not a duplicate (ADR-272, DS-8e). The maintainer went
// back into the Studio to fix a mistake, pressed Apply again, and got a second
// copy of every shape beside the first — because each Apply minted fresh
// objects and a fresh operation.

import { describe, expect, it } from 'vitest';
import type { Sketch } from '../../core/design';
import { DEFAULT_DESIGN_LAYER } from '../../core/design/layers';
import { createProject, operationIdsForObject } from '../../core/scene';
import { applyDesignSketch } from './design-apply-mutation';
import type { DesignApplyRecord } from './design-apply-record';

const rect = (id: string, x: number, widthMm: number, layerId: string) => ({
  kind: 'rect' as const,
  id,
  origin: { x, y: 0 },
  widthMm,
  heightMm: 20,
  cornerRadiusMm: 0,
  layerId,
});

const LAYERS = [DEFAULT_DESIGN_LAYER] as const;
const first: Sketch = { entities: [rect('a', 0, 40, DEFAULT_DESIGN_LAYER.id)], layers: LAYERS };
// The same drawing after the operator fixed the mistake — wider, same layer.
const fixed: Sketch = { entities: [rect('a', 0, 90, DEFAULT_DESIGN_LAYER.id)], layers: LAYERS };

function applyOnce(
  sketch: Sketch,
  project = createProject(),
  previous: DesignApplyRecord | null = null,
) {
  const result = applyDesignSketch({ project, undoStack: [] }, sketch, ['obj-1'], previous);
  if (result === null) throw new Error('expected the sketch to apply');
  return result;
}

describe('applying a second time', () => {
  it('replaces the artwork instead of adding a duplicate', () => {
    const one = applyOnce(first);
    expect(one.project.scene.objects).toHaveLength(1);
    const two = applyOnce(fixed, one.project, one.applyRecord);
    expect(two.project.scene.objects).toHaveLength(1);
    const only = two.project.scene.objects[0];
    if (only?.kind !== 'shape' || only.spec.kind !== 'rect') throw new Error('expected a rect');
    expect(only.spec.widthMm).toBe(90);
  });

  it('reuses the same operation, so its name gains no suffix', () => {
    const one = applyOnce(first);
    const two = applyOnce(fixed, one.project, one.applyRecord);
    expect(two.project.scene.layers).toHaveLength(1);
    expect(two.project.scene.layers[0]?.name).toBe('Layer 1');
    expect(two.project.scene.layers[0]?.id).toBe(one.project.scene.layers[0]?.id);
  });

  it('keeps the new artwork bound to that reused operation', () => {
    const one = applyOnce(first);
    const two = applyOnce(fixed, one.project, one.applyRecord);
    const object = two.project.scene.objects[0];
    const operation = two.project.scene.layers[0];
    if (object === undefined || operation === undefined) throw new Error('expected both');
    expect(operationIdsForObject(object, two.project.scene.layers)).toEqual([operation.id]);
  });

  // Re-applying must not throw away the feeds an operator tuned on the main
  // canvas; only the carve fields the Studio owns are restated.
  it('preserves settings the operator changed on the reused operation', () => {
    const one = applyOnce(first);
    const operation = one.project.scene.layers[0];
    if (operation === undefined) throw new Error('expected an operation');
    const tuned = {
      ...one.project,
      scene: {
        ...one.project.scene,
        layers: [{ ...operation, speed: 1234 }],
      },
    };
    const two = applyOnce(fixed, tuned, one.applyRecord);
    expect(two.project.scene.layers[0]?.speed).toBe(1234);
  });

  it('still inserts fresh when the operator deleted the previous artwork', () => {
    const one = applyOnce(first);
    const emptied = {
      ...one.project,
      scene: { ...one.project.scene, objects: [], layers: [] },
    };
    const two = applyOnce(fixed, emptied, one.applyRecord);
    expect(two.project.scene.objects).toHaveLength(1);
    expect(two.project.scene.layers).toHaveLength(1);
  });

  it('is one undo entry, which restores the previous artwork', () => {
    const one = applyOnce(first);
    const two = applyOnce(fixed, one.project, one.applyRecord);
    expect(two.undoStack).toHaveLength(1);
    expect(two.undoStack[0]).toBe(one.project);
  });

  // Without a record — the first Apply of a session — nothing is removed.
  it('leaves unrelated artwork alone', () => {
    const one = applyOnce(first);
    const two = applyOnce(fixed, one.project, null);
    expect(two.project.scene.objects).toHaveLength(2);
  });
});
