import { describe, expect, it } from 'vitest';
import { createProject, primaryOperationForObject } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { applyDrawShape } from './draw-shape-mutation';

function emptySlice() {
  return { project: createProject(), undoStack: [] };
}

describe('applyDrawShape', () => {
  it('adds the drawn shape to the scene and selects it', () => {
    const shape = createRectangle({
      id: 'S1',
      color: '#ff0000',
      spec: { widthMm: 30, heightMm: 20, cornerRadiusMm: 0 },
    });
    const result = applyDrawShape(emptySlice(), shape);
    expect(result.project.scene.objects.map((o) => o.id)).toEqual(['S1']);
    expect(result.selectedObjectId).toBe('S1');
    expect(result.additionalSelectedIds.size).toBe(0);
  });

  it('auto-creates the first line operation in black', () => {
    const shape = createRectangle({
      id: 'S2',
      color: '#123456',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    });
    const result = applyDrawShape(emptySlice(), shape);
    const stored = result.project.scene.objects[0];
    const layer =
      stored === undefined ? null : primaryOperationForObject(stored, result.project.scene.layers);
    expect(layer).not.toBeNull();
    expect(layer?.color).toBe('#000000');
    // Drawn vectors default to a line/cut layer (LightBurn parity).
    expect(layer?.mode).toBe('line');
  });

  it('pushes the prior project onto the undo stack and flips dirty', () => {
    const shape = createRectangle({
      id: 'S3',
      color: '#000000',
      spec: { widthMm: 5, heightMm: 5, cornerRadiusMm: 0 },
    });
    const slice = emptySlice();
    const result = applyDrawShape(slice, shape);
    expect(result.undoStack).toEqual([slice.project]);
    expect(result.redoStack).toEqual([]);
    expect(result.dirty).toBe(true);
  });
});
