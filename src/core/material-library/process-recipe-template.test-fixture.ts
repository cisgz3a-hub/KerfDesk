import { createLayer, type ImportedSvg, type Project } from '../scene';
import { recipeProject } from './process-recipe.test-fixture';
import { captureProcessRecipeTemplate } from './capture-process-recipe-template';
import { applyProcessRecipeTemplate } from './apply-process-recipe-template';
import type { ProcessRecipe } from './process-recipe';

export function namedProject(): Project {
  const project = recipeProject(true);
  const { operationOverride: _sourceOverride, ...original } = project.scene
    .objects[0] as ImportedSvg;
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: [
        { ...original, name: 'Lettering' },
        {
          ...original,
          id: 'cutout',
          name: 'Outer boundary',
          operationIds: ['cut'],
        },
      ],
      groups: [{ id: 'panel', name: 'Panel', objectIds: ['source', 'cutout'] }],
    },
  };
}
export function template(): ProcessRecipe {
  const result = captureProcessRecipeTemplate(namedProject(), ['source', 'cutout'], {
    id: 'sign',
    name: 'Sign',
    description: '',
    revision: '1',
  });
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.value;
}
export function target(): Project {
  const source = namedProject();
  return {
    ...source,
    scene: {
      ...source.scene,
      layers: [createLayer({ id: 'plain', color: '#000000' })],
      objects: source.scene.objects.map((object) => {
        const { operationOverride: _override, ...plain } = object;
        return { ...plain, operationIds: ['plain'] };
      }),
    },
  };
}
export function applied(project = target(), recipe = template()): Project {
  const result = applyProcessRecipeTemplate(project, ['source', 'cutout'], recipe);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.value;
}
