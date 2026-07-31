import { describe, expect, it } from 'vitest';
import type { Sketch } from '../../core/design';
import { createProject, operationIdsForObject } from '../../core/scene';
import { applyDesignSketch } from './design-apply-mutation';

function emptySlice() {
  return { project: createProject(), undoStack: [] };
}

const plaque: Sketch = {
  entities: [
    {
      kind: 'rect',
      id: 'plate',
      origin: { x: 10, y: 10 },
      widthMm: 120,
      heightMm: 80,
      cornerRadiusMm: 5,
    },
    { kind: 'circle', id: 'hole', center: { x: 25, y: 25 }, radiusMm: 2.5 },
    { kind: 'line', id: 'score', start: { x: 20, y: 60 }, end: { x: 110, y: 60 } },
  ],
};

const ids = ['a', 'b', 'c'];

describe('applyDesignSketch', () => {
  it('inserts one object per output entity, with the ids given', () => {
    const result = applyDesignSketch(emptySlice(), plaque, ids);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.project.scene.objects.map((object) => object.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps rect and circle parametric and bakes the line', () => {
    const result = applyDesignSketch(emptySlice(), plaque, ids);
    if (result === null) throw new Error('expected insertion');
    expect(result.project.scene.objects.map((object) => object.kind)).toEqual([
      'shape',
      'shape',
      'imported-svg',
    ]);
  });

  // A sketch without explicit layers lives on the default carve layer, so the
  // whole apply still shares ONE operation — now named after that layer
  // (ADR-272 Amendment 1 clause 2).
  it('shares one auto-created line operation across the whole apply', () => {
    const result = applyDesignSketch(emptySlice(), plaque, ids);
    if (result === null) throw new Error('expected insertion');
    expect(result.project.scene.layers).toHaveLength(1);
    const [operation] = result.project.scene.layers;
    expect(operation?.name).toBe('Layer 1');
    expect(operation?.mode).toBe('line');
    expect(
      result.project.scene.objects.map((object) =>
        operationIdsForObject(object, result.project.scene.layers),
      ),
    ).toEqual([[operation?.id], [operation?.id], [operation?.id]]);
  });

  it('selects everything it inserted and nothing else', () => {
    const result = applyDesignSketch(emptySlice(), plaque, ids);
    if (result === null) throw new Error('expected insertion');
    expect(result.selectedObjectId).toBe('a');
    expect([...result.additionalSelectedIds].sort()).toEqual(['b', 'c']);
  });

  // The headline contract: many drawing steps inside the Studio collapse to ONE
  // step in the project's history.
  it('is exactly one project undo entry and marks the project dirty', () => {
    const slice = emptySlice();
    const result = applyDesignSketch(slice, plaque, ids);
    if (result === null) throw new Error('expected insertion');
    expect(result.undoStack).toEqual([slice.project]);
    expect(result.redoStack).toEqual([]);
    expect(result.dirty).toBe(true);
  });

  it('leaves a second apply independent of the first', () => {
    const first = applyDesignSketch(emptySlice(), plaque, ids);
    if (first === null) throw new Error('expected insertion');
    const second = applyDesignSketch(
      { project: first.project, undoStack: first.undoStack },
      plaque,
      ['d', 'e', 'f'],
    );
    if (second === null) throw new Error('expected insertion');
    expect(second.project.scene.objects).toHaveLength(6);
    // uniqueOperationName suffixes the second apply's duplicate layer name.
    expect(second.project.scene.layers.map((operation) => operation.name)).toEqual([
      'Layer 1',
      'Layer 1 2',
    ]);
  });

  it('excludes construction geometry from the output', () => {
    const withGuide: Sketch = {
      entities: [
        ...plaque.entities,
        {
          kind: 'line',
          id: 'guide',
          start: { x: 0, y: 45 },
          end: { x: 140, y: 45 },
          construction: true,
        },
      ],
    };
    const result = applyDesignSketch(emptySlice(), withGuide, ['a', 'b', 'c', 'd']);
    if (result === null) throw new Error('expected insertion');
    expect(result.project.scene.objects).toHaveLength(3);
    expect(result.project.scene.objects.map((object) => object.id)).not.toContain('d');
  });

  it('does nothing for an empty sketch', () => {
    expect(applyDesignSketch(emptySlice(), { entities: [] }, [])).toBeNull();
  });

  it('does nothing for a sketch of guides alone', () => {
    const guidesOnly: Sketch = {
      entities: [
        {
          kind: 'line',
          id: 'g',
          start: { x: 0, y: 0 },
          end: { x: 50, y: 0 },
          construction: true,
        },
      ],
    };
    expect(applyDesignSketch(emptySlice(), guidesOnly, ['x'])).toBeNull();
  });

  it('stops early rather than reusing an id when fewer ids than entities are given', () => {
    const result = applyDesignSketch(emptySlice(), plaque, ['only-one']);
    if (result === null) throw new Error('expected insertion');
    expect(result.project.scene.objects.map((object) => object.id)).toEqual(['only-one']);
  });

  it('does not mutate the input project', () => {
    const slice = emptySlice();
    applyDesignSketch(slice, plaque, ids);
    expect(slice.project.scene.objects).toHaveLength(0);
    expect(slice.project.scene.layers).toHaveLength(0);
  });
});
