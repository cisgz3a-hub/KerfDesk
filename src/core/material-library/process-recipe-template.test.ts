import { describe, expect, it } from 'vitest';
import { createLayer, type ImportedSvg } from '../scene';
import { applyProcessRecipeTemplate, findRecipeApplication } from './apply-process-recipe-template';
import { previewProcessRecipe, recipeSelectorPaths } from './process-recipe-selectors';
import { recipePathGeometry } from './process-recipe-geometry';
import { parseProcessRecipes } from '../../io/material-library/process-recipe-io';
import { serializeProject, deserializeProject } from '../../io/project';
import { template, target, applied } from './process-recipe-template.test-fixture';

describe('semantic machining templates', () => {
  it('captures named hierarchy roles using the existing process recipe model', () => {
    const recipe = template();
    expect(recipe.roles?.every((role) => role.selector.groupPath?.[0] === 'Panel')).toBe(true);
    expect(recipe.roles?.some((role) => role.selector.objectName === 'Outer boundary')).toBe(true);
    expect(recipe.pathSteps).toBeUndefined();
    expect(parseProcessRecipes([recipe]).kind).toBe('ok');
  });
  it('previews exact selected matches and missing roles after a rename', () => {
    const project = target();
    const renamed = {
      ...project,
      scene: {
        ...project.scene,
        objects: project.scene.objects.map((object) =>
          object.id === 'cutout' ? { ...object, name: 'Renamed' } : object,
        ),
      },
    };
    const preview = previewProcessRecipe(renamed, ['source', 'cutout'], template());
    expect(preview.unmatchedObjectIds).toEqual(['cutout']);
    expect(preview.roles.filter((role) => role.status === 'missing')).toHaveLength(1);
    expect(preview.warnings.join(' ')).toContain('required role');
    expect(previewProcessRecipe(project, ['cutout'], template()).matchedObjectIds).toEqual([
      'cutout',
    ]);
  });
  it('applies twice without duplicating operations and keeps the unselected artwork', () => {
    const project = target();
    const other = { ...project.scene.objects[0]!, id: 'unselected' };
    const before = {
      ...project,
      scene: { ...project.scene, objects: [...project.scene.objects, other] },
    };
    const first = applied(before);
    const second = applied(first);
    expect(second.scene.layers).toEqual(first.scene.layers);
    expect(second.processRecipeApplications).toEqual(first.processRecipeApplications);
    expect(second.scene.objects[2]).toBe(other);
    expect(second.scene.layers[0]).toBe(before.scene.layers[0]);
  });
  it('preserves operator layer settings, per-object overrides and binding edits across repeated reapply', () => {
    const first = applied();
    const layer = first.scene.layers[0]!;
    const source = first.scene.objects[0] as ImportedSvg;
    const extra = createLayer({ id: 'manual', color: '#33aabb' });
    const edited = {
      ...first,
      scene: {
        ...first.scene,
        layers: [
          ...first.scene.layers.map((item) =>
            item.id === layer.id ? { ...item, cnc: { ...item.cnc!, feedMmPerMin: 123 } } : item,
          ),
          extra,
        ],
        objects: first.scene.objects.map((object) =>
          object.id === source.id
            ? {
                ...source,
                operationOverride: { speed: 777 },
                paths: source.paths.map((path) => ({ ...path, operationIds: [extra.id] })),
              }
            : object,
        ),
      },
    };
    const revised = {
      ...template(),
      revision: '2',
      steps: template().steps.map((step) => ({
        ...step,
        cnc: { ...step.cnc!, feedMmPerMin: 900, depthMm: 2 },
      })),
    };
    const second = applied(edited, revised);
    const third = applied(second, revised);
    expect(third.scene.layers.find((item) => item.id === layer.id)?.cnc).toMatchObject({
      feedMmPerMin: 123,
      depthMm: 2,
    });
    expect((third.scene.objects[0] as ImportedSvg).paths[0]?.operationIds).toEqual(['manual']);
    expect(third.scene.objects[0]?.operationOverride).toEqual({ speed: 777 });
    expect(
      previewProcessRecipe(
        edited,
        ['source', 'cutout'],
        revised,
        findRecipeApplication(edited, ['source', 'cutout'], revised.id),
      ).warnings.join(' '),
    ).toContain('operator edits');
  });
  it('keeps nested pocket holes and reselects a changed lettering path count', () => {
    const first = applied();
    const source = first.scene.objects[0] as ImportedSvg;
    const path = source.paths[0]!;
    const hole = {
      ...path.polylines[0]!,
      points: [
        { x: 2, y: 2 },
        { x: 2, y: 4 },
        { x: 4, y: 4 },
        { x: 4, y: 2 },
        { x: 2, y: 2 },
      ],
    };
    const changed = {
      ...first,
      scene: {
        ...first.scene,
        objects: first.scene.objects.map((object) =>
          object.id === source.id
            ? {
                ...source,
                paths: [
                  { ...path, polylines: [...path.polylines, hole] },
                  { ...path, polylines: path.polylines },
                ],
              }
            : object,
        ),
      },
    };
    const result = applied(changed);
    const rebound = result.scene.objects[0] as ImportedSvg;
    expect(rebound.paths).toHaveLength(2);
    expect(rebound.paths[0]?.polylines).toEqual([...path.polylines, hole]);
    expect(rebound.paths[1]?.operationIds).toEqual(path.operationIds);
    expect(result.scene.layers).toHaveLength(first.scene.layers.length);
  });
  it('invalidates a reviewed preview when cutter or artwork state changes', () => {
    const project = target();
    const recipe = template();
    const preview = previewProcessRecipe(project, ['source', 'cutout'], recipe);
    const changed = {
      ...project,
      scene: {
        ...project.scene,
        layers: project.scene.layers.map((layer) => ({ ...layer, speed: 123 })),
      },
    };
    expect(
      applyProcessRecipeTemplate(changed, ['source', 'cutout'], recipe, {
        reviewedSignature: preview.signature,
      }),
    ).toMatchObject({ kind: 'invalid', reason: expect.stringContaining('Review') });
  });
  it('roundtrips retained applications and remains reapplyable after the library is gone', () => {
    const first = applied();
    const loaded = deserializeProject(serializeProject(first));
    if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
    const application = loaded.project.processRecipeApplications![0]!;
    expect(application.recipe).toEqual(template());
    const result = applyProcessRecipeTemplate(
      loaded.project,
      application.objectIds,
      application.recipe,
      { applicationId: application.id },
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok')
      expect(result.value.scene.layers).toHaveLength(first.scene.layers.length);
  });
  it('selects open/closed/circular path groups without accepting a square or transformed ellipse', () => {
    const project = target();
    const source = project.scene.objects[0] as ImportedSvg;
    const points = Array.from({ length: 32 }, (_, index) => ({
      x: Math.cos((index * Math.PI) / 16) * 3,
      y: Math.sin((index * Math.PI) / 16) * 3,
    }));
    const circle = { color: '#000000', polylines: [{ closed: true, points }] };
    const square = source.paths[0]!;
    const open = { ...square, polylines: [{ ...square.polylines[0]!, closed: false }] };
    const object = { ...source, paths: [circle, square, open] };
    expect(recipeSelectorPaths(project.scene, object, { geometry: 'circular' })).toEqual([0]);
    expect(recipeSelectorPaths(project.scene, object, { geometry: 'closed' })).toEqual([0, 1]);
    expect(recipeSelectorPaths(project.scene, object, { geometry: 'open' })).toEqual([2]);
    expect(
      recipeSelectorPaths(
        project.scene,
        { ...object, transform: { ...object.transform, scaleX: 2 } },
        { geometry: 'circular' },
      ),
    ).toEqual([]);
    expect(
      recipePathGeometry({ ...square, polylines: [...square.polylines, ...open.polylines] }),
    ).toBeNull();
  });
  it('rejects unknown selectors, duplicate roles, cyclic dependencies and out-of-range steps', () => {
    const recipe = template();
    for (const invalid of [
      {
        ...recipe,
        roles: [{ ...recipe.roles![0], selector: { geometry: 'closed', unknown: true } }],
      },
      { ...recipe, roles: [recipe.roles![0], recipe.roles![0]] },
      { ...recipe, roles: [{ ...recipe.roles![0], stepIndices: [999] }] },
      {
        ...recipe,
        steps: recipe.steps.map((step, index) => ({
          ...step,
          dependsOn: index === 0 ? [1] : index === 1 ? [0] : [],
        })),
      },
    ])
      expect(parseProcessRecipes([invalid]).kind).toBe('invalid');
  });
});
