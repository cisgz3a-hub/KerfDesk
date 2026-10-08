import { describe, expect, it } from 'vitest';
import { useStore } from './store';
import { analyseJointResize } from '../../core/geometry/joint-resize';
import { jointResizeSelectionMutation, type JointResizeSession } from './joint-resize-actions';
import { jointResizeFixture } from './joint-resize.test-fixture';

const request = {
  currentWidthMm: 3,
  materialThicknessMm: 3.5,
  fitAllowanceMm: 0.1,
  detectionToleranceMm: 0.1,
};
function prepare() {
  const fixture = jointResizeFixture();
  useStore.setState({
    project: fixture.project,
    projectDocumentEpoch: 17,
    selectedObjectId: fixture.object.id,
    additionalSelectedIds: new Set(),
    selectedPathNode: null,
    selectedPathNodes: [],
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
  const session: JointResizeSession = {
    project: fixture.project,
    documentEpoch: 17,
    ids: [fixture.object.id],
  };
  const analysis = analyseJointResize([fixture.object], request);
  if (analysis.kind !== 'ok') throw new Error('bad test fixture');
  return { ...fixture, session, ids: analysis.value.candidates.map((candidate) => candidate.id) };
}
describe('joint resize acceptance', () => {
  it('commits the selected changes as one undo step and retains groups, operation bindings and settings', () => {
    const { project, session, ids, object } = prepare();
    const result = jointResizeSelectionMutation(useStore.getState(), session, request, ids);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    useStore.setState(result.value);
    const state = useStore.getState();
    expect(state.undoStack).toEqual([project]);
    expect(state.project.scene.groups).toBe(project.scene.groups);
    expect(state.project.scene.layers).toBe(project.scene.layers);
    expect(state.project.scene.objects[0]!.operationIds).toBe(object.operationIds);
    const points = (state.project.scene.objects[0] as typeof object).paths[0]!.polylines[0]!.points;
    expect(Math.abs(points[4]!.x - points[5]!.x)).toBeCloseTo(3.6, 10);
  });
  it('rejects owner drift, document reopen and changed selection without changing history', () => {
    const { project, session, ids } = prepare();
    const original = useStore.getState();
    for (const state of [
      { ...original, project: { ...project, notes: 'changed' } },
      { ...original, projectDocumentEpoch: 18 },
      { ...original, selectedObjectId: null },
    ])
      expect(jointResizeSelectionMutation(state, session, request, ids).kind).toBe('error');
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().undoStack).toEqual([]);
  });
  it('independently recalculates acceptance and refuses changed/unsafe request dimensions', () => {
    const { project, session, ids } = prepare();
    expect(
      jointResizeSelectionMutation(
        useStore.getState(),
        session,
        { ...request, materialThicknessMm: 50 },
        ids,
      ).kind,
    ).toBe('error');
    expect(
      jointResizeSelectionMutation(
        useStore.getState(),
        session,
        { ...request, currentWidthMm: 4 },
        ids,
      ).kind,
    ).toBe('error');
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().undoStack).toEqual([]);
  });
  it('excludes retained compound geometry so resizing cannot leave stale editable operands', () => {
    const fixture = prepare();
    const compound = {
      ...fixture.object,
      booleanCompound: {
        operation: 'weld' as const,
        operands: [
          {
            sourceId: 'left',
            sourceKind: 'imported-svg' as const,
            object: { ...fixture.object, id: 'left' },
          },
          {
            sourceId: 'right',
            sourceKind: 'imported-svg' as const,
            object: { ...fixture.object, id: 'right' },
          },
        ],
      },
    };
    const project = {
      ...fixture.project,
      scene: { ...fixture.project.scene, objects: [compound] },
    };
    useStore.setState({ project });
    const before = useStore.getState();
    const analysis = analyseJointResize([compound], request);
    expect(analysis.kind).toBe('ok');
    if (analysis.kind === 'ok') {
      expect(analysis.value.candidates).toEqual([]);
      expect(analysis.value.notices).toEqual([expect.stringContaining('Expand the compound')]);
    }
    const session = { ...fixture.session, project };
    expect(jointResizeSelectionMutation(before, session, request, fixture.ids).kind).toBe('error');
    expect(useStore.getState()).toBe(before);
    expect(compound.paths).toBe(fixture.object.paths);
  });
});
