import { beforeEach, expect, it } from 'vitest';
import { applyProcessRecipeTemplate } from '../../core/material-library/apply-process-recipe-template';
import { captureProcessRecipeTemplate } from '../../core/material-library/capture-process-recipe-template';
import { previewProcessRecipe } from '../../core/material-library/process-recipe-selectors';
import { recipeProject } from '../../core/material-library/process-recipe.test-fixture';
import { productionFixture } from '../../core/nesting/production-nest.test-fixture';
import { type Project, type TracedImage } from '../../core/scene';
import { serializeProject, deserializeProject } from '../../io/project';
import { emitGcode } from '../../io/gcode';
import { validateProcessRecipeApplications } from '../../io/project/project-process-recipe-validator';
import { validateProductionNestDefinition } from '../../io/project/project-production-nest-validator';
import { validateCncTwoSidedSetup } from '../../io/project/project-cnc-two-sided-validator';
import { defaultCncMachiningSetup } from '../../core/scene/cnc-machining-setup';
import { prepareProductionNest } from './prepare-production-nest';
import { currentOutputScope, useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';
import { load, rings, square, trace } from './trace-part.test-support';

beforeEach(resetStore);

it('retains every contour in an ungrouped production part after splitting and reopening', () => {
  load(trace());
  const base = productionFixture().definition;
  useStore.setState((state) => ({
    project: {
      ...state.project,
      productionNest: { ...base, parts: [{ ...base.parts[0]!, objectIds: ['trace'] }] },
    },
  }));
  const before = useStore.getState().project;
  const id = useStore.getState().detachTracePart('trace', 0, 2)!;
  const after = useStore.getState().project;
  const reopened = deserializeProject(serializeProject(after));
  if (reopened.kind !== 'ok') throw new Error('Project round trip failed');
  const project = reopened.project;
  const prepared = prepareProductionNest(project, project.productionNest!);
  if (prepared.kind !== 'ok') throw new Error(prepared.reason);
  expect(prepared.value.units[0]?.objects.map((object) => object.id)).toEqual(['trace', id]);
  expect(
    prepared.value.units[0]?.objects.flatMap((object) =>
      'paths' in object ? object.paths.flatMap((path) => path.polylines) : [],
    ),
  ).toHaveLength(3);
  useStore.getState().undo();
  expect(useStore.getState().project).toBe(before);
  useStore.getState().redo();
  expect(useStore.getState().project).toBe(after);
});

function recipeTrace(includeEmptyPaths = false): Project {
  const project = recipeProject(true);
  const paths = [
    { ...rings(), operationIds: ['cut'] },
    { color: rings().color, polylines: [square(130)], operationIds: ['fill'] },
  ];
  const empty = { color: rings().color, polylines: [], operationIds: ['disabled'] };
  const object = {
    ...trace(includeEmptyPaths ? [...paths.flatMap((path) => [empty, path]), empty] : paths),
    name: 'Artwork',
  };
  const source = { ...project, scene: { ...project.scene, objects: [object] } };
  const captured = captureProcessRecipeTemplate(source, ['trace'], {
    id: 'template',
    name: 'Trace template',
    description: '',
    revision: '1',
  });
  if (captured.kind !== 'ok') throw new Error(captured.reason);
  const result = applyProcessRecipeTemplate(source, ['trace'], captured.value);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.value;
}

it.each([
  [0, false],
  [1, false],
  [0, true],
  [1, true],
] as const)(
  'retains recipe baselines splitting path %s with empty paths=%s and reapplies to both pieces',
  (pickedPath, includeEmptyPaths) => {
    const pathIndex = includeEmptyPaths ? pickedPath * 2 + 1 : pickedPath;
    useStore.setState({ project: recipeTrace(includeEmptyPaths) });
    const before = useStore.getState().project;
    expect(deserializeProject(serializeProject(before)).kind).toBe('ok');
    const original = before.processRecipeApplications![0]!;
    const id = useStore.getState().detachTracePart('trace', pathIndex, pickedPath === 0 ? 2 : 0)!;
    const split = useStore.getState().project;
    const application = split.processRecipeApplications![0]!;
    expect(application.objectIds).toEqual(['trace', id]);
    expect(
      application.bindings.find((binding) => binding.objectId === id)?.pathOperationIds,
    ).toEqual([original.bindings[0]!.pathOperationIds![pathIndex]]);
    const remainderPaths = application.bindings.find(
      (binding) => binding.objectId === 'trace',
    )?.pathOperationIds;
    const survivingPaths = (pickedPath === 0 ? [0, 1] : [0]).map((index) =>
      includeEmptyPaths ? index * 2 + 1 : index,
    );
    expect(remainderPaths).toEqual(
      survivingPaths.map((index) => original.bindings[0]!.pathOperationIds![index]),
    );
    const recipe = {
      ...application.recipe,
      revision: '2',
      steps: [
        ...application.recipe.steps,
        { ...application.recipe.steps[0]!, name: 'Finish detached geometry' },
      ],
      roles: application.recipe.roles!.map((role) => ({
        ...role,
        stepIndices: [...role.stepIndices, application.recipe.steps.length],
      })),
    };
    const preview = previewProcessRecipe(split, application.objectIds, recipe, application);
    const result = applyProcessRecipeTemplate(split, application.objectIds, recipe, {
      applicationId: application.id,
      reviewedSignature: preview.signature,
    });
    if (result.kind !== 'ok') throw new Error(result.reason);
    const finish = result.value.scene.layers.find(
      (layer) => layer.name === 'Finish detached geometry',
    )!;
    for (const object of result.value.scene.objects as readonly TracedImage[])
      expect(object.paths.every((path) => path.operationIds?.includes(finish.id))).toBe(true);
    expect(deserializeProject(serializeProject(result.value)).kind).toBe('ok');
  },
);

it.each([false, true])(
  'restores selected-output geometry after extraction and drag=%s Undo/Redo',
  (drag) => {
    load(trace());
    useStore.getState().setOutputScopeSettings({ cutSelectedGraphics: true });
    useStore.getState().beginInteraction();
    const id = useStore.getState().detachTracePart('trace', 0, 2)!;
    useStore.getState().selectTracePart(id);
    if (drag) {
      const object = useStore.getState().project.scene.objects.find((object) => object.id === id)!;
      useStore.getState().setObjectTransform(id, { ...object.transform, x: 50 });
    }
    useStore.getState().endInteraction();
    const state = useStore.getState();
    const output = emitGcode(state.project, { outputScope: currentOutputScope(state) }).gcode;
    expect(output).toContain('G1');
    useStore.getState().undo();
    expect(useStore.getState().selectedObjectId).toBeNull();
    useStore.getState().redo();
    const redone = useStore.getState();
    expect(redone.selectedObjectId).toBe(id);
    expect(currentOutputScope(redone)).toEqual(currentOutputScope(state));
    expect(emitGcode(redone.project, { outputScope: currentOutputScope(redone) }).gcode).toBe(
      output,
    );
  },
);

it('keeps operator-edited path bindings separate from the retained template baseline', () => {
  const project = recipeTrace();
  const object = project.scene.objects[0] as TracedImage;
  const operatorBinding = [object.paths[1]!.operationIds![0]!];
  const edited = {
    ...object,
    paths: object.paths.map((path, index) =>
      index === 1 ? { ...path, operationIds: operatorBinding } : path,
    ),
  };
  useStore.setState({ project: { ...project, scene: { ...project.scene, objects: [edited] } } });
  const baseline = project.processRecipeApplications![0]!.bindings[0]!.pathOperationIds![1];
  const id = useStore.getState().detachTracePart('trace', 1, 0)!;
  const split = useStore.getState().project;
  const application = split.processRecipeApplications![0]!;
  expect(application.bindings.find((binding) => binding.objectId === id)?.pathOperationIds).toEqual(
    [baseline],
  );
  const result = applyProcessRecipeTemplate(split, application.objectIds, application.recipe, {
    applicationId: application.id,
  });
  if (result.kind !== 'ok') throw new Error(result.reason);
  const detached = result.value.scene.objects.find((object) => object.id === id) as TracedImage;
  expect(detached.paths[0]?.operationIds).toEqual(operatorBinding);
});

it('keeps a filename-based retained recipe role matching an unnamed detached trace', () => {
  const source = recipeTrace();
  const project = {
    ...source,
    scene: {
      ...source.scene,
      objects: source.scene.objects.map((object) => {
        const { name: _name, ...unnamed } = object;
        return unnamed;
      }),
    },
    processRecipeApplications: source.processRecipeApplications!.map((application) => ({
      ...application,
      recipe: {
        ...application.recipe,
        roles: application.recipe.roles!.map((role) => ({
          ...role,
          selector: { ...role.selector, objectName: 'drawing.png' },
        })),
      },
    })),
  };
  const application = project.processRecipeApplications[0]!;
  expect(
    previewProcessRecipe(project, application.objectIds, application.recipe, application)
      .matchedObjectIds,
  ).toEqual(['trace']);
  useStore.setState({ project });
  const id = useStore.getState().detachTracePart('trace', 0, 2)!;
  const split = useStore.getState().project;
  const retained = split.processRecipeApplications![0]!;
  expect(
    previewProcessRecipe(split, retained.objectIds, retained.recipe, retained).matchedObjectIds,
  ).toEqual(['trace', id]);
});

it('preserves the whole project when expanding recipe bindings would exceed the existing file budget', () => {
  const source = recipeTrace();
  const application = source.processRecipeApplications![0]!;
  const project = {
    ...source,
    processRecipeApplications: [
      {
        ...application,
        objectIds: [...application.objectIds, 'missing'],
        bindings: [
          ...application.bindings,
          {
            objectId: 'missing',
            operationIds: [],
            pathOperationIds: Array.from({ length: 99_998 }, () => []),
          },
        ],
      },
    ],
  };
  expect(validateProcessRecipeApplications(project.processRecipeApplications)).toBeNull();
  useStore.setState({ project });
  const before = useStore.getState();
  expect(useStore.getState().detachTracePart('trace', 0, 2)).toBeNull();
  expect(useStore.getState()).toBe(before);
  expect(useToastStore.getState().toasts.at(-1)?.message).toContain('100000 path groups');
});

it('does not restore extraction selection for an unrelated branch after cancelling a split', () => {
  load(trace());
  useStore.getState().beginInteraction();
  const id = useStore.getState().detachTracePart('trace', 0, 2)!;
  useStore.getState().selectTracePart(id);
  useStore.getState().cancelInteraction();
  useStore.getState().applyObjectTransform('trace', { ...trace().transform, x: 60 });
  useStore.getState().selectObject('trace');
  useStore.getState().undo();
  expect(useStore.getState().selectedObjectId).toBe('trace');
  expect(useStore.getState().redoStack).toHaveLength(1);
});

it('does not restore extraction selection while undoing an unrelated later transform', () => {
  load(trace());
  const id = useStore.getState().detachTracePart('trace', 0, 2)!;
  useStore.getState().selectTracePart(id);
  useStore.getState().undo();
  useStore.getState().redo();
  useStore.getState().applyObjectTransform('trace', { ...trace().transform, x: 60 });
  useStore.getState().selectObject('trace');
  useStore.getState().undo();
  expect(useStore.getState().selectedObjectId).toBe('trace');
});

it('refuses a split atomically when production membership would exceed 10000 stored identities', () => {
  load(trace());
  const base = productionFixture().definition;
  const nest = {
    ...base,
    parts: [
      {
        ...base.parts[0]!,
        objectIds: ['trace', ...Array.from({ length: 9_999 }, (_, index) => `missing-${index}`)],
      },
    ],
  };
  expect(validateProductionNestDefinition(nest)).toBeNull();
  useStore.setState((state) => ({ project: { ...state.project, productionNest: nest } }));
  const before = useStore.getState();
  expect(useStore.getState().detachTracePart('trace', 0, 2)).toBeNull();
  expect(useStore.getState()).toBe(before);
  expect(useToastStore.getState().toasts.at(-1)?.message).toContain('quantity nesting');
});

it('refuses a split atomically when CNC side membership would exceed 100000 stored identities', () => {
  load(trace());
  const twoSided = {
    activeSide: 'A' as const,
    flipAxis: 'y' as const,
    sideBStockOriginMm: { x: 0, y: 0 },
    sideAObjectIds: ['trace', ...Array.from({ length: 99_999 }, (_, index) => `missing-${index}`)],
    sideBObjectIds: [],
    registration: [],
  };
  expect(validateCncTwoSidedSetup(twoSided)).toBeNull();
  useStore.setState((state) => ({
    project: {
      ...state.project,
      cncSetup: { ...defaultCncMachiningSetup(), twoSided },
    },
  }));
  const before = useStore.getState();
  expect(useStore.getState().detachTracePart('trace', 0, 2)).toBeNull();
  expect(useStore.getState()).toBe(before);
  expect(useToastStore.getState().toasts.at(-1)?.message).toContain('cncSetup.twoSided');
});
