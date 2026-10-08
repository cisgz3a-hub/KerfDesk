import { beforeEach, describe, it, expect } from 'vitest';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { defaultConstrainedSketch } from '../../core/sketch-constraints/default-constrained-sketch';
import type { ImportedSvg } from '../../core/scene';
beforeEach(resetStore);
describe('reviewed sketch application', () => {
  it('creates, revises and bakes with stable identity and one undo per accepted edit', () => {
    const state = useStore.getState(),
      initial = state.project;
    const prepared = state.reviewConstrainedSketch(defaultConstrainedSketch());
    if (prepared.kind !== 'ok') throw new Error(prepared.reason);
    expect(state.applyConstrainedSketch(prepared.review)).toBe(true);
    const object = useStore.getState().project.scene.objects[0] as ImportedSvg,
      project = useStore.getState().project;
    const savedSketch = object.constrainedSketch;
    if (savedSketch === undefined) throw new Error('Missing retained sketch');
    const draft = {
      ...savedSketch,
      parameters: savedSketch.parameters.map((p) => (p.name === 'width' ? { ...p, value: 75 } : p)),
    };
    const revised = useStore.getState().reviewConstrainedSketch(draft, object.id);
    if (revised.kind !== 'ok') throw new Error(revised.reason);
    expect(useStore.getState().applyConstrainedSketch(revised.review)).toBe(true);
    const next = useStore.getState().project.scene.objects[0] as ImportedSvg;
    expect(next.id).toBe(object.id);
    expect(next.transform).toBe(object.transform);
    expect(useStore.getState().undoStack).toEqual([initial, project]);
    expect(next.bounds.maxX).toBeCloseTo(75, 5);
    expect(useStore.getState().bakeConstrainedSketch(next, 0)).toBe(true);
    expect(
      (useStore.getState().project.scene.objects[0] as ImportedSvg).constrainedSketch,
    ).toBeUndefined();
    useStore.getState().undo();
    expect(useStore.getState().project.scene.objects[0]).toBe(next);
  });
  it('rejects conflict and stale previews without altering geometry or history', () => {
    const initial = useStore.getState().project,
      sketch = defaultConstrainedSketch();
    expect(
      useStore.getState().reviewConstrainedSketch({
        ...sketch,
        constraints: [...sketch.constraints, { id: 'conflict', kind: 'x', pointId: 'b', value: 5 }],
      }).kind,
    ).toBe('invalid');
    expect(useStore.getState().project).toBe(initial);
    const prepared = useStore.getState().reviewConstrainedSketch(sketch);
    if (prepared.kind !== 'ok') throw new Error(prepared.reason);
    useStore.setState({ projectDocumentEpoch: 1 });
    expect(useStore.getState().applyConstrainedSketch(prepared.review)).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
    useStore.setState({ projectDocumentEpoch: 0, project: { ...initial, notes: 'another edit' } });
    expect(useStore.getState().applyConstrainedSketch(prepared.review)).toBe(false);
  });
});
