import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import { cncPassXyPoints } from '../../core/job/job';
import {
  cncDependencyStatuses,
  cncPreparationInputs,
} from '../../core/cnc/cnc-preparation-dependencies';
import { defaultPartGenerator, type GeneratedPartObject } from '../../core/parts/part-generator';
import { generatedPart, requirePart } from '../../core/parts/part-generator.test-fixture';
import { partGeneratorGeometryMatches } from '../../core/parts/regenerate-part-generator';
import { serializeProject, deserializeProject } from '../../io/project';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { defaultConstrainedSketch } from '../../core/sketch-constraints/default-constrained-sketch';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(resetStore);
function machiningProject(): Project {
  const source = generatedPart();
  const other: GeneratedPartObject = {
    ...source,
    id: 'independent',
    operationIds: ['other'],
    paths: source.paths.map((path) => ({ ...path, operationIds: ['other'] })),
    transform: { ...source.transform, x: 200 },
  };
  const layers = ['boundary', 'holes', 'other'].map((id, index) => ({
    ...createLayer({ id, name: id, color: ['#000000', '#ff0000', '#0000ff'][index] ?? '#000000' }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'profile-on-path' as const,
      depthMm: 1,
      depthPerPassMm: 1,
      tabsEnabled: false,
    },
  }));
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: { layers, objects: [source, other] },
  };
}
function boundaryMaximum(project: Project): number {
  const output = prepareOutput(project);
  if (!output.ok) throw new Error(JSON.stringify(output.preflight));
  return Math.max(
    ...output.job.groups.flatMap((group) =>
      group.kind === 'cnc' && group.layerId === 'boundary'
        ? group.passes.flatMap(cncPassXyPoints).map((point) => point.x)
        : [],
    ),
  );
}
describe('reviewed parametric part state', () => {
  it('creates a dimensioned object without scaling in one atomic undo action', () => {
    const initial = useStore.getState().project;
    const definition = { ...defaultPartGenerator('panel'), widthMm: 500 };
    const prepared = requirePart(useStore.getState().preparePartGenerator(definition));
    expect(useStore.getState().project).toBe(initial);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(prepared.object.transform.scaleX).toBe(1);
    expect(prepared.operationNames).toEqual(['Panel']);
    expect(requirePart(useStore.getState().acceptPartGenerator(prepared))).toBe(prepared.object.id);
    const accepted = useStore.getState().project;
    expect(useStore.getState().selectedObjectId).toBe(prepared.object.id);
    expect(accepted.scene.layers).toHaveLength(1);
    expect(useStore.getState().undoStack).toEqual([initial]);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(initial);
    useStore.getState().redo();
    expect(useStore.getState().project).toBe(accepted);
  });
  it('regenerates associated CNC sources while preserving bindings, overrides, transform and unrelated readiness', () => {
    const original = machiningProject();
    const source = original.scene.objects[0] as GeneratedPartObject;
    useStore.setState({ project: original, selectedObjectId: source.id });
    const oldMax = boundaryMaximum(original);
    const baseline = cncPreparationInputs(original);
    const prepared = requirePart(
      useStore
        .getState()
        .preparePartGenerator({ ...source.partGenerator.definition, widthMm: 75 }, source.id),
    );
    expect(prepared.operationNames).toEqual(['boundary', 'holes']);
    expect(useStore.getState().project).toBe(original);
    requirePart(useStore.getState().acceptPartGenerator(prepared));
    const revised = useStore.getState().project;
    const object = revised.scene.objects[0] as GeneratedPartObject;
    expect(object.id).toBe(source.id);
    expect(object.transform).toBe(source.transform);
    expect(object.operationOverride).toBe(source.operationOverride);
    expect(object.paths.map((path) => path.operationIds)).toEqual(
      source.paths.map((path) => path.operationIds),
    );
    expect(boundaryMaximum(revised) - oldMax).toBeCloseTo(15, 5);
    const status = cncDependencyStatuses(cncPreparationInputs(revised), baseline);
    expect(status.find((item) => item.operationId === 'boundary')?.status).toBe('dirty');
    expect(status.find((item) => item.operationId === 'other')?.status).toBe('ready');
    const reopened = deserializeProject(serializeProject(revised));
    if (reopened.kind !== 'ok') throw new Error(JSON.stringify(reopened));
    const saved = reopened.project.scene.objects[0] as GeneratedPartObject;
    expect(saved.partGenerator).toEqual(object.partGenerator);
    expect(saved.paths).toEqual(object.paths);
    expect(partGeneratorGeometryMatches(saved)).toBe(true);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(original);
  });
  it('rejects stale, invalid, locked and competing-source edits without changing artwork or undo', () => {
    const original = machiningProject();
    const source = original.scene.objects[0] as GeneratedPartObject;
    useStore.setState({ project: original });
    const prepared = requirePart(
      useStore
        .getState()
        .preparePartGenerator({ ...source.partGenerator.definition, widthMm: 75 }, source.id),
    );
    expect(useStore.getState().acceptPartGenerator({ ...prepared }).kind).toBe('invalid');
    useStore.setState({ projectDocumentEpoch: 1 });
    expect(useStore.getState().acceptPartGenerator(prepared).kind).toBe('invalid');
    useStore.setState({ projectDocumentEpoch: 0 });
    const changed = { ...original, notes: 'operator edit' };
    useStore.setState({ project: changed });
    expect(useStore.getState().acceptPartGenerator(prepared).kind).toBe('invalid');
    expect(useStore.getState().project).toBe(changed);
    expect(
      useStore
        .getState()
        .preparePartGenerator({ ...source.partGenerator.definition, widthMm: 0 }, source.id).kind,
    ).toBe('invalid');
    for (const object of [
      { ...source, locked: true },
      { ...source, constrainedSketch: defaultConstrainedSketch() },
    ]) {
      const project = { ...original, scene: { ...original.scene, objects: [object] } };
      useStore.setState({ project });
      expect(
        useStore.getState().preparePartGenerator(source.partGenerator.definition, source.id).kind,
      ).toBe('invalid');
      expect(useStore.getState().project).toBe(project);
    }
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
  it('retains deleted-boundary artwork/output on reopen and discloses unsafe regeneration before Bake', () => {
    const original = machiningProject();
    const source = original.scene.objects[0] as GeneratedPartObject;
    const edited = { ...source, paths: source.paths.slice(1) };
    const project = { ...original, scene: { ...original.scene, objects: [edited] } };
    const reopened = deserializeProject(serializeProject(project));
    if (reopened.kind !== 'ok') throw new Error(JSON.stringify(reopened));
    const current = reopened.project;
    useStore.setState({ project: current });
    expect(
      useStore.getState().preparePartGenerator(source.partGenerator.definition, source.id),
    ).toMatchObject({
      kind: 'invalid',
      reason: /machining bindings.*[Bb]ake/,
    });
    expect(useStore.getState().project).toBe(current);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(prepareOutput(current).ok).toBe(true);
    const currentPaths = (current.scene.objects[0] as ImportedSvg).paths;
    expect(currentPaths).toHaveLength(edited.paths.length);
    requirePart(useStore.getState().bakePartGenerator(source.id));
    const baked = useStore.getState().project.scene.objects[0] as ImportedSvg;
    expect(baked.partGenerator).toBeUndefined();
    expect(baked.paths).toBe(currentPaths);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(current);
    expect(
      useStore.getState().preparePartGenerator(source.partGenerator.definition, source.id).kind,
    ).toBe('invalid');
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('reviews reordered paths before restoring semantic machining, emitted boundary and atomic Undo', () => {
    const original = machiningProject();
    const source = original.scene.objects[0] as GeneratedPartObject;
    const edited = { ...source, paths: source.paths.toReversed() };
    const project = {
      ...original,
      scene: { ...original.scene, objects: [edited, ...original.scene.objects.slice(1)] },
    };
    const reopened = deserializeProject(serializeProject(project));
    if (reopened.kind !== 'ok') throw new Error(JSON.stringify(reopened));
    const current = reopened.project;
    useStore.setState({ project: current });
    const prepared = requirePart(
      useStore
        .getState()
        .preparePartGenerator({ ...source.partGenerator.definition, widthMm: 75 }, source.id),
    );
    expect(prepared.geometryMismatch).toBe(true);
    expect(prepared.object.paths.map((path) => path.operationIds)).toEqual(
      source.paths.map((path) => path.operationIds),
    );
    expect(prepared.object.paths[0]?.operationIds).toEqual(['boundary']);
    expect(boundaryMaximum(prepared.nextProject) - boundaryMaximum(original)).toBeCloseTo(15, 5);
    expect(useStore.getState().project).toBe(current);
    expect(useStore.getState().undoStack).toHaveLength(0);
    requirePart(useStore.getState().acceptPartGenerator(prepared));
    const reapplied = useStore.getState().project;
    expect(partGeneratorGeometryMatches(reapplied.scene.objects[0] as ImportedSvg)).toBe(true);
    expect(reapplied.scene.objects[1]).toBe(current.scene.objects[1]);
    const saved = deserializeProject(serializeProject(reapplied));
    if (saved.kind !== 'ok') throw new Error(JSON.stringify(saved));
    expect(
      (saved.project.scene.objects[0] as ImportedSvg).paths.map((path) => path.operationIds),
    ).toEqual(source.paths.map((path) => path.operationIds));
    const unchanged = requirePart(
      useStore.getState().preparePartGenerator(prepared.object.partGenerator.definition, source.id),
    );
    requirePart(useStore.getState().acceptPartGenerator(unchanged));
    expect(useStore.getState().project).toBe(reapplied);
    expect(useStore.getState().undoStack).toEqual([current]);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(current);
  });
});
