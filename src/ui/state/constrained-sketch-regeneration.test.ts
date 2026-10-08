import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import { cncPassXyPoints } from '../../core/job/job';
import { defaultConstrainedSketch } from '../../core/sketch-constraints/default-constrained-sketch';
import { sketchGeometryMatches } from '../../core/sketch-constraints/materialize-constrained-sketch';
import { deserializeProject, serializeProject } from '../../io/project';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { useStore } from './store';
import { resetStore } from './test-helpers';
beforeEach(resetStore);
function cncMaximum(project: Project): number {
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.preflight));
  return Math.max(
    ...prepared.job.groups.flatMap((group) =>
      group.kind === 'cnc' ? group.passes.flatMap(cncPassXyPoints).map((point) => point.x) : [],
    ),
  );
}
describe('retained sketch materialization', () => {
  it('replaces reopened canonical profile curves when dimensions change and recompiles the associated CNC geometry', () => {
    const state = useStore.getState();
    const reviewed = state.reviewConstrainedSketch(defaultConstrainedSketch());
    if (reviewed.kind !== 'ok') throw new Error(reviewed.reason);
    expect(state.applyConstrainedSketch(reviewed.review)).toBe(true);
    const original = useStore.getState().project;
    const object = original.scene.objects[0] as ImportedSvg;
    const operation = object.operationIds?.[0];
    if (operation === undefined) throw new Error('Missing sketch operation');
    const source = {
      ...object,
      operationIds: ['profile'],
      paths: object.paths.map((path) => ({ ...path, operationIds: ['profile'] })),
    };
    const layer = {
      ...createLayer({ id: 'profile', name: 'Profile', color: '#000000' }),
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'profile-on-path' as const,
        depthMm: 1,
        depthPerPassMm: 1,
        tabsEnabled: false,
      },
    };
    const loaded = deserializeProject(
      serializeProject({
        ...original,
        machine: DEFAULT_CNC_MACHINE_CONFIG,
        scene: { ...original.scene, objects: [source], layers: [layer] },
      }),
    );
    if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
    const project = loaded.project,
      current = project.scene.objects[0] as ImportedSvg;
    const sketch = current.constrainedSketch;
    if (sketch === undefined) throw new Error('Missing saved sketch');
    const before = cncMaximum(project);
    useStore.setState({ project, undoStack: [] });
    const resized = useStore.getState().reviewConstrainedSketch(
      {
        ...sketch,
        parameters: sketch.parameters.map((parameter) =>
          parameter.name === 'width' ? { ...parameter, value: 75 } : parameter,
        ),
      },
      current.id,
    );
    if (resized.kind !== 'ok') throw new Error(resized.reason);
    expect(resized.review.replacesManualGeometry).toBe(false);
    expect(resized.review.affectedOperationIds).toEqual(['profile']);
    expect(useStore.getState().applyConstrainedSketch(resized.review)).toBe(true);
    const after = useStore.getState().project;
    expect(cncMaximum(after) - before).toBeCloseTo(15, 5);
    const changed = after.scene.objects[0] as ImportedSvg;
    expect(changed.paths[0]?.curves).not.toEqual(current.paths[0]?.curves);
    expect(changed.paths.map((path) => path.operationIds)).toEqual(
      current.paths.map((path) => path.operationIds),
    );
    expect(changed.transform).toBe(current.transform);
    expect(sketchGeometryMatches(changed)).toBe(true);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(project);
  });
  it('keeps oversized reviewed dimensions at authored scale with one undo action', () => {
    const initial = useStore.getState().project;
    const sketch = defaultConstrainedSketch();
    const reviewed = useStore.getState().reviewConstrainedSketch({
      ...sketch,
      parameters: sketch.parameters.map((parameter) =>
        parameter.name === 'width' ? { ...parameter, value: 500 } : parameter,
      ),
    });
    if (reviewed.kind !== 'ok') throw new Error(reviewed.reason);
    expect(reviewed.review.object.transform.scaleX).toBe(1);
    expect(useStore.getState().applyConstrainedSketch(reviewed.review)).toBe(true);
    expect((useStore.getState().project.scene.objects[0] as ImportedSvg).transform.scaleX).toBe(1);
    expect(useStore.getState().undoStack).toEqual([initial]);
  });
});
