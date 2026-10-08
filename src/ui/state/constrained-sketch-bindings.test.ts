import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  captureLayerOperationSettings,
  IDENTITY_TRANSFORM,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import type { ConstrainedSketch2d } from '../../core/sketch-constraints/constrained-sketch';
import { defaultConstrainedSketch } from '../../core/sketch-constraints/default-constrained-sketch';
import { materializeConstrainedSketch } from '../../core/sketch-constraints/materialize-constrained-sketch';
import type { ProcessRecipeApplication } from '../../core/material-library/process-recipe-application';
import { cncTabAnchorPosition } from '../../core/cnc/cnc-tab-anchors';
import { deserializeProject, serializeProject } from '../../io/project';
import { parseProcessRecipe } from '../../io/material-library/process-recipe-io';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(resetStore);
function fixture(): { readonly project: Project; readonly object: ImportedSvg } {
  const geometry = materializeConstrainedSketch(defaultConstrainedSketch(), '#000000');
  if (
    geometry.paths === undefined ||
    geometry.bounds === undefined ||
    geometry.result.kind !== 'solved'
  )
    throw new Error('Expected analytic sketch');
  const operations = ['outline', 'first-hole', 'second-hole'];
  const anchors = operations.map((_, pathIndex) => ({
    layerColor: '#000000',
    pathIndex,
    polylineIndex: 0,
    pathT: 0.25,
  }));
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'sketch',
    source: 'sketch',
    transform: IDENTITY_TRANSFORM,
    constrainedSketch: geometry.result.sketch,
    paths: geometry.paths.map((path, index) => ({
      ...path,
      operationIds: [operations[index] ?? 'unassigned'],
    })),
    bounds: geometry.bounds,
    operationIds: operations,
    cncTabAnchors: anchors,
    laserTabAnchors: anchors,
    operationOverride: { byOperation: { outline: { power: 77 } } },
  };
  const layers = operations.map((id, index) =>
    createLayer({ id, color: ['#000000', '#ff0000', '#0000ff'][index] ?? '#000000' }),
  );
  const draftRecipe = {
    id: 'template',
    name: 'Sketch template',
    description: '',
    revision: '1',
    machineKind: 'cnc' as const,
    tools: DEFAULT_CNC_MACHINE_CONFIG.tools,
    steps: layers.map((layer) => ({
      name: layer.name,
      color: layer.color,
      output: layer.output,
      visible: layer.visible,
      settings: captureLayerOperationSettings(layer),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, toolId: DEFAULT_CNC_MACHINE_CONFIG.toolId },
    })),
    roles: [
      {
        id: 'artwork',
        name: 'Artwork',
        required: true,
        stepIndices: [0, 1, 2],
        selector: { geometry: 'any' as const },
      },
    ],
  };
  const parsedRecipe = parseProcessRecipe(draftRecipe);
  if (parsedRecipe.kind !== 'ok') throw new Error(parsedRecipe.reason);
  const recipe = parsedRecipe.value;
  const application: ProcessRecipeApplication = {
    id: 'application',
    recipe,
    objectIds: ['sketch'],
    operations: recipe.steps.map((baseline, stepIndex) => ({
      stepIndex,
      operationId: operations[stepIndex] ?? 'missing',
      baseline,
    })),
    bindings: [
      {
        objectId: 'sketch',
        operationIds: ['outline'],
        pathOperationIds: [['outline'], ['first-hole'], ['second-hole']],
      },
    ],
  };
  const unrelated = {
    ...application,
    id: 'other-application',
    objectIds: ['unrelated'],
    bindings: [
      { objectId: 'unrelated', operationIds: ['outline'], pathOperationIds: [['outline']] },
    ],
  };
  return {
    object,
    project: {
      ...createProject(),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: { objects: [object], layers },
      processRecipeApplications: [application, unrelated],
    },
  };
}
function retainedSketch(object: ImportedSvg): ConstrainedSketch2d {
  if (object.constrainedSketch === undefined) throw new Error('Missing sketch source');
  return object.constrainedSketch;
}
function review(sketch: ConstrainedSketch2d, object: ImportedSvg) {
  const result = useStore.getState().reviewConstrainedSketch(sketch, object.id);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.review;
}
function currentObject(): ImportedSvg {
  const object = useStore.getState().project.scene.objects[0];
  if (object?.kind !== 'imported-svg') throw new Error('Missing regenerated sketch');
  return object;
}

function expectUnmovedTabs(before: ImportedSvg, after: ImportedSvg): void {
  for (const [index, anchor] of (after.cncTabAnchors ?? []).entries()) {
    const previous = before.cncTabAnchors?.[index];
    if (previous === undefined) throw new Error('Missing previous tab');
    expect(cncTabAnchorPosition(after, anchor)).toEqual(cncTabAnchorPosition(before, previous));
  }
}

describe('semantic sketch path bindings', () => {
  it('reorders retained tabs and recipe baselines with their named circles in one undo step', () => {
    const { project, object } = fixture();
    useStore.setState({ project, undoStack: [] });
    const sketch = retainedSketch(object);
    const prepared = review({ ...sketch, circles: [...sketch.circles].reverse() }, object);
    expect(useStore.getState().project).toBe(project);
    expect(prepared.object.cncTabAnchors?.map((anchor) => anchor.pathIndex)).toEqual([0, 2, 1]);
    expect(prepared.object.laserTabAnchors?.map((anchor) => anchor.pathIndex)).toEqual([0, 2, 1]);
    expect(
      prepared.nextProject.processRecipeApplications?.[0]?.bindings[0]?.pathOperationIds,
    ).toEqual([['outline'], ['second-hole'], ['first-hole']]);
    expect(prepared.nextProject.processRecipeApplications?.[1]).toBe(
      project.processRecipeApplications?.[1],
    );
    expect(useStore.getState().applyConstrainedSketch(prepared)).toBe(true);
    const accepted = useStore.getState().project;
    expect(currentObject().id).toBe(object.id);
    expect(currentObject().operationOverride).toBe(object.operationOverride);
    expect(currentObject().paths.map((path) => path.operationIds)).toEqual([
      ['outline'],
      ['second-hole'],
      ['first-hole'],
    ]);
    expectUnmovedTabs(object, currentObject());
    const reopened = deserializeProject(serializeProject(accepted));
    if (reopened.kind !== 'ok') throw new Error(JSON.stringify(reopened));
    expect((reopened.project.scene.objects[0] as ImportedSvg).cncTabAnchors).toEqual(
      currentObject().cncTabAnchors,
    );
    expect(reopened.project.processRecipeApplications).toEqual(accepted.processRecipeApplications);
    expect(useStore.getState().undoStack).toEqual([project]);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(project);
    useStore.getState().redo();
    expect(useStore.getState().project).toBe(accepted);
  });
  it('drops removed-circle anchors and baseline entries instead of pointing them at the remaining circle', () => {
    const { project, object } = fixture();
    useStore.setState({ project });
    const sketch = retainedSketch(object);
    const prepared = review(
      {
        ...sketch,
        circles: sketch.circles.filter((circle) => circle.id !== 'mount1'),
        constraints: sketch.constraints.filter(
          (constraint) => constraint.kind !== 'diameter' || constraint.circleId !== 'mount1',
        ),
      },
      object,
    );
    expect(prepared.object.cncTabAnchors).toEqual([
      object.cncTabAnchors?.[0],
      { ...object.cncTabAnchors?.[2], pathIndex: 1 },
    ]);
    expect(prepared.object.laserTabAnchors).toEqual(prepared.object.cncTabAnchors);
    expect(
      prepared.nextProject.processRecipeApplications?.[0]?.bindings[0]?.pathOperationIds,
    ).toEqual([['outline'], ['second-hole']]);
    expect(useStore.getState().applyConstrainedSketch(prepared)).toBe(true);
    expect(currentObject().paths.map((path) => path.operationIds)).toEqual([
      ['outline'],
      ['second-hole'],
    ]);
  });
  it('gives a new circle its object binding baseline without borrowing a removed circle identity', () => {
    const { project, object } = fixture();
    useStore.setState({ project });
    const sketch = retainedSketch(object);
    const prepared = review(
      { ...sketch, circles: [{ id: 'new-hole', centre: 'hole1', radiusMm: 3 }, ...sketch.circles] },
      object,
    );
    expect(prepared.object.cncTabAnchors?.map((anchor) => anchor.pathIndex)).toEqual([0, 2, 3]);
    expect(
      prepared.nextProject.processRecipeApplications?.[0]?.bindings[0]?.pathOperationIds,
    ).toEqual([['outline'], ['outline'], ['first-hole'], ['second-hole']]);
    expect(prepared.object.paths[1]?.operationIds).toEqual(object.operationIds);
  });
  it('preserves manual path bindings through preview and bake, and rejects a stale reviewed reorder', () => {
    const fixtureValue = fixture();
    const object = {
      ...fixtureValue.object,
      paths: fixtureValue.object.paths.map((path, index) =>
        index === 1 ? { ...path, operationIds: ['second-hole'] } : path,
      ),
    };
    const project = {
      ...fixtureValue.project,
      scene: { ...fixtureValue.project.scene, objects: [object] },
    };
    useStore.setState({ project });
    const sketch = retainedSketch(object);
    const prepared = review({ ...sketch, circles: [...sketch.circles].reverse() }, object);
    expect(prepared.object.paths[2]?.operationIds).toEqual(['second-hole']);
    expect(
      prepared.nextProject.processRecipeApplications?.[0]?.bindings[0]?.pathOperationIds,
    ).toEqual([['outline'], ['second-hole'], ['first-hole']]);
    expect(useStore.getState().bakeConstrainedSketch(object, 0)).toBe(true);
    expect(currentObject().paths).toBe(object.paths);
    expect(currentObject().cncTabAnchors).toBe(object.cncTabAnchors);
    expect(currentObject().constrainedSketch).toBeUndefined();
    expect(useStore.getState().applyConstrainedSketch(prepared)).toBe(false);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(project);
  });
});

function currentTopologyObject(
  kind: 'deleted profile' | 'changed preview geometry' | 'duplicated hole',
  object: ImportedSvg,
): ImportedSvg {
  if (kind === 'deleted profile') return { ...object, paths: object.paths.slice(1) };
  if (kind === 'duplicated hole') {
    const hole = object.paths[1];
    const curves = hole?.curves;
    if (hole === undefined || curves === undefined) throw new Error('Missing hole curve geometry');
    return {
      ...object,
      paths: object.paths.map((path, index) =>
        index === 2 ? { ...path, polylines: hole.polylines, curves } : path,
      ),
    };
  }
  return {
    ...object,
    paths: object.paths.map((path, index) =>
      index === 1
        ? {
            ...path,
            polylines: path.polylines.map((polyline) => ({
              ...polyline,
              points: polyline.points.map((point, pointIndex) =>
                pointIndex === 0 ? { ...point, x: point.x + 1 } : point,
              ),
            })),
          }
        : path,
    ),
  };
}

describe('manual materialized sketch topology', () => {
  it('recovers reordered current paths and tab ownership without reordering recipe baselines', () => {
    const initial = fixture();
    const source = initial.object;
    const remappedTabs = (source.cncTabAnchors ?? []).map((anchor) => ({
      ...anchor,
      pathIndex: source.paths.length - 1 - anchor.pathIndex,
    }));
    const object: ImportedSvg = {
      ...source,
      paths: [...source.paths]
        .reverse()
        .map((path, index) => (index === 1 ? { ...path, operationIds: ['outline'] } : path)),
      cncTabAnchors: remappedTabs,
      laserTabAnchors: remappedTabs,
    };
    const project = { ...initial.project, scene: { ...initial.project.scene, objects: [object] } };
    useStore.setState({ project });
    const sketch = retainedSketch(object);
    const prepared = review(
      {
        ...sketch,
        parameters: sketch.parameters.map((parameter) =>
          parameter.name === 'width' ? { ...parameter, value: 75 } : parameter,
        ),
      },
      object,
    );
    expect(prepared.replacesManualGeometry).toBe(true);
    expect(prepared.object.paths.map((path) => path.operationIds)).toEqual([
      ['outline'],
      ['outline'],
      ['second-hole'],
    ]);
    expect(prepared.object.cncTabAnchors?.map((anchor) => anchor.pathIndex)).toEqual([0, 1, 2]);
    expect(prepared.object.laserTabAnchors).toEqual(prepared.object.cncTabAnchors);
    expect(
      prepared.nextProject.processRecipeApplications?.[0]?.bindings[0]?.pathOperationIds,
    ).toEqual([['outline'], ['first-hole'], ['second-hole']]);
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().applyConstrainedSketch(prepared)).toBe(true);
    expect(currentObject().bounds.maxX).toBeCloseTo(75, 5);
    expect(currentObject().id).toBe(source.id);
    expect(currentObject().operationOverride).toBe(source.operationOverride);
    expect(useStore.getState().undoStack).toEqual([project]);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(project);
    expect(currentObject().paths).toBe(object.paths);
  });
  it.each(['deleted profile', 'changed preview geometry', 'duplicated hole'] as const)(
    'keeps %s as ordinary artwork and requires Undo or Bake before regeneration',
    (kind) => {
      const initial = fixture();
      const object = currentTopologyObject(kind, initial.object);
      const project = {
        ...initial.project,
        scene: { ...initial.project.scene, objects: [object] },
      };
      useStore.setState({ project });
      const prepared = useStore
        .getState()
        .reviewConstrainedSketch(retainedSketch(object), object.id);
      expect(prepared).toMatchObject({
        kind: 'invalid',
        reason: expect.stringMatching(/Undo.*bake/i),
      });
      expect(useStore.getState().project).toBe(project);
      expect(useStore.getState().undoStack).toEqual([]);
      expect(prepareOutput(project).ok).toBe(true);
      const reopened = deserializeProject(serializeProject(project));
      if (reopened.kind !== 'ok') throw new Error(JSON.stringify(reopened));
      expect((reopened.project.scene.objects[0] as ImportedSvg).paths).toEqual(object.paths);
      expect(useStore.getState().bakeConstrainedSketch(object, 0)).toBe(true);
      expect(currentObject().paths).toBe(object.paths);
      expect(currentObject().cncTabAnchors).toBe(object.cncTabAnchors);
      expect(currentObject().constrainedSketch).toBeUndefined();
      useStore.getState().undo();
      expect(useStore.getState().project).toBe(project);
    },
  );
});
