import { describe, expect, it } from 'vitest';
import { compileJob } from '../job/compile-job';
import { compileCncJob } from '../cnc/compile-cnc-job';
import { grblStrategy } from '../output/grbl-strategy';
import { type Project, type ImportedSvg } from '../scene';
import { applyProcessRecipe } from './apply-process-recipe';
import { captureProcessRecipe } from './capture-process-recipe';
import {
  capturedRecipe,
  freshRecipeProject,
  imageRecipeProject,
  recipeProject,
} from './process-recipe.test-fixture';

function program(project: Project): string {
  const job =
    project.machine?.kind === 'cnc'
      ? compileCncJob(project.scene, project.device, project.machine)
      : compileJob(project.scene, project.device);
  return grblStrategy
    .emit(job, project.device, { compactMotionWords: false, finishPosition: null })
    .split('\n')
    .map((line) => line.split(';')[0]?.trim())
    .filter(Boolean)
    .join('\n');
}

describe('reusable ordered process recipes', () => {
  it.each([false, true])('recreates raster output with pass-through=%s', (passThrough) => {
    const source = imageRecipeProject(passThrough);
    const recipe = capturedRecipe(source);
    const target = freshRecipeProject(source);
    const applied = applyProcessRecipe(target, ['fresh'], recipe);
    if (applied.kind !== 'ok') throw new Error(applied.reason);
    expect(program(source)).toContain('G1');
    expect(program(applied.value)).toBe(program(source));
    expect(recipe.steps[0]?.settings).toMatchObject({
      mode: 'image',
      passThrough,
      power: 30,
      minPower: 5,
      imageBidirectional: false,
      negativeImage: true,
      dotWidthCorrectionMm: 0.05,
    });
    expect(applied.value.scene.objects[0]).toMatchObject({
      brightness: 5,
      contrast: 10,
      gamma: 1.2,
    });
  });

  it.each([false, true])(
    'recreates the compiled and emitted process on fresh artwork (CNC=%s)',
    (cnc) => {
      const source = recipeProject(cnc);
      const recipe = capturedRecipe(source);
      expect(recipe.steps.map((step) => [step.name, step.output])).toEqual([
        ['Engrave', true],
        ['Optional score', false],
        ['Cut', true],
      ]);
      const applied = applyProcessRecipe(freshRecipeProject(source), ['fresh'], recipe);
      if (applied.kind !== 'ok') throw new Error(applied.reason);
      expect(program(applied.value)).toBe(program(source));
      expect(applied.value.scene.layers).toHaveLength(3);
      expect(applied.value.scene.layers.map((layer) => layer.id)).not.toContain('fill');
      expect(applied.value.scene.layers.map((layer) => layer.passes)).toEqual([1, 3, 2]);
      if (!cnc) expect(recipe.steps.map((step) => step.settings.power)).toEqual([15, 15, 40]);
    },
  );

  it('keeps unselected shared operations unchanged and copies independently to each target', () => {
    const project = recipeProject();
    const object = project.scene.objects[0] as ImportedSvg;
    const before = {
      ...project,
      scene: {
        ...project.scene,
        objects: [object, { ...object, id: 'second' }, { ...object, id: 'third' }],
      },
    };
    const result = applyProcessRecipe(before, ['second', 'third'], capturedRecipe());
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result.value.scene.objects[0]).toBe(object);
    expect(result.value.scene.layers.slice(0, 3)).toEqual(before.scene.layers);
    const second = result.value.scene.objects[1];
    const third = result.value.scene.objects[2];
    expect(second?.operationIds).toHaveLength(3);
    expect(third?.operationIds?.some((id) => second?.operationIds?.includes(id))).toBe(false);
  });

  it('preserves independently assigned paths and refuses a mismatched path count atomically', () => {
    const project = recipeProject();
    const source = project.scene.objects[0] as ImportedSvg;
    const path = source.paths[0]!;
    const object = {
      ...source,
      paths: [
        { ...path, operationIds: ['fill'] },
        { ...path, operationIds: ['cut', 'disabled'] },
      ],
    };
    const scoped = { ...project, scene: { ...project.scene, objects: [object] } };
    const recipe = capturedRecipe(scoped);
    expect(recipe.pathSteps).toEqual([[0], [1, 2]]);
    const fresh = freshRecipeProject(scoped);
    const applied = applyProcessRecipe(fresh, ['fresh'], recipe);
    if (applied.kind !== 'ok') throw new Error(applied.reason);
    expect(program(applied.value)).toBe(program(scoped));
    expect(applyProcessRecipe(freshRecipeProject(), ['fresh'], recipe)).toMatchObject({
      kind: 'invalid',
      reason: expect.stringContaining('2 paths'),
    });
  });

  it('snapshots active CNC cutters and avoids conflicting destination cutter IDs', () => {
    const source = recipeProject(true);
    const recipe = capturedRecipe(source);
    const fresh = freshRecipeProject(source);
    if (fresh.machine?.kind !== 'cnc') throw new Error('cnc fixture');
    const collision = {
      ...fresh,
      machine: {
        ...fresh.machine,
        tools: fresh.machine.tools.map((tool) => ({ ...tool, diameterMm: 9 })),
      },
    };
    const result = applyProcessRecipe(collision, ['fresh'], recipe);
    if (result.kind !== 'ok' || result.value.machine?.kind !== 'cnc')
      throw new Error('missing result');
    expect(result.value.machine.toolId).toBe(collision.machine.toolId);
    expect(result.value.machine.tools.slice(0, collision.machine.tools.length)).toEqual(
      collision.machine.tools,
    );
    const bit = result.value.machine.tools.find(
      (tool) => tool.id === result.value.scene.layers[0]?.cnc?.toolId,
    );
    expect(bit?.diameterMm).toBe(recipe.tools?.[0]?.diameterMm);
    expect(result.value.machine.stock).toBe(collision.machine.stock);
    expect(result.value.machine.params).toBe(collision.machine.params);
  });

  it('reports missing cutter definitions and incompatible machine kinds', () => {
    const project = recipeProject(true);
    const broken = {
      ...project,
      scene: {
        ...project.scene,
        layers: project.scene.layers.map((layer) =>
          layer.id !== 'fill'
            ? layer
            : { ...layer, cnc: { ...layer.cnc!, vClearToolId: 'missing' } },
        ),
      },
    };
    expect(
      captureProcessRecipe(broken, 'source', {
        id: 'bad',
        name: 'Bad',
        description: '',
        revision: '1',
      }),
    ).toMatchObject({ kind: 'invalid', reason: expect.stringContaining('missing cutter') });
    expect(
      applyProcessRecipe(freshRecipeProject(), ['fresh'], capturedRecipe(project)),
    ).toMatchObject({ kind: 'invalid', reason: expect.stringContaining('CNC') });
  });
});
