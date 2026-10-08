import { describe, expect, it } from 'vitest';
import { createLayer, type ImportedSvg, type Project } from '../scene';
import { namedProject, target, template } from './process-recipe-template.test-fixture';
import { captureProcessRecipeTemplate } from './capture-process-recipe-template';
import { applyProcessRecipeTemplate } from './apply-process-recipe-template';
import { parseProcessRecipes } from '../../io/material-library/process-recipe-io';

describe('machining template stage and unmatched-path retention', () => {
  it('captures secondary stage cutters and remaps colliding IDs while retaining dependency order', () => {
    const { source, tool } = stagedSource();
    const captured = captureProcessRecipeTemplate(source, ['source', 'cutout'], {
      id: 'stages',
      name: 'Stages',
      description: '',
      revision: '1',
    });
    if (captured.kind !== 'ok') throw new Error(captured.reason);
    expect(captured.value.tools?.some((candidate) => candidate.id === tool.id)).toBe(true);
    const recipe = {
      ...captured.value,
      steps: captured.value.steps.map((step, index) => ({
        ...step,
        dependsOn: index === 0 ? [1] : [],
      })),
    };
    expect(parseProcessRecipes([recipe]).kind).toBe('ok');
    const before = target();
    if (before.machine?.kind !== 'cnc') throw new Error('Missing target machine');
    const destination = {
      ...before,
      machine: { ...before.machine, tools: [...before.machine.tools, { ...tool, diameterMm: 9 }] },
    };
    const applied = applyProcessRecipeTemplate(destination, ['source', 'cutout'], recipe);
    if (applied.kind !== 'ok') throw new Error(applied.reason);
    const stage = roughingStage(applied.value);
    expect(stage?.toolId).toBe('rough-tool-recipe-2');
    expect(stage?.feedMmPerMin).toBe(550);
    const application = applied.value.processRecipeApplications![0]!;
    expect(application.recipe.steps[0]!.dependsOn).toEqual([1]);
    expect(application.operations.map((operation) => operation.stepIndex)).toEqual([1, 0, 2]);
  });
  it('preserves effective legacy colour bindings on unmatched paths through apply and reapply', () => {
    const before = target();
    const source = before.scene.objects[0] as ImportedSvg;
    const { operationIds: _ids, ...legacy } = source;
    const red = {
      color: '#ff0000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 8, y: 0 },
          ],
        },
      ],
    };
    const project = {
      ...before,
      scene: {
        ...before.scene,
        layers: [...before.scene.layers, createLayer({ id: 'legacy-red', color: red.color })],
        objects: [{ ...legacy, paths: [...source.paths, red] }, before.scene.objects[1]!],
      },
    };
    const applied = applyProcessRecipeTemplate(project, ['source', 'cutout'], template());
    if (applied.kind !== 'ok') throw new Error(applied.reason);
    const object = applied.value.scene.objects[0] as ImportedSvg;
    expect(object.paths[1]?.operationIds).toEqual(['legacy-red']);
    expect(object.operationIds).toContain('legacy-red');
    const reapplied = applyProcessRecipeTemplate(applied.value, ['source', 'cutout'], template());
    if (reapplied.kind !== 'ok') throw new Error(reapplied.reason);
    expect((reapplied.value.scene.objects[0] as ImportedSvg).paths[1]?.operationIds).toEqual([
      'legacy-red',
    ]);
    expect(reapplied.value).toBe(applied.value);
  });
});

function stagedSource() {
  const source = namedProject();
  if (source.machine?.kind !== 'cnc') throw new Error('Missing CNC fixture');
  const base = source.machine.tools[0]!;
  const tool = { ...base, id: 'rough-tool', name: 'Rough bit', diameterMm: 5 };
  const sourceWithStage = {
    ...source,
    machine: { ...source.machine, tools: [...source.machine.tools, tool] },
    scene: {
      ...source.scene,
      layers: source.scene.layers.map((layer) =>
        layer.id === 'cut' && layer.cnc !== undefined
          ? {
              ...layer,
              cnc: {
                ...layer.cnc,
                stageRecipes: {
                  'pocket-rough': {
                    toolId: tool.id,
                    feedMmPerMin: 550,
                    plungeMmPerMin: 120,
                    spindleRpm: 12000,
                    depthPerPassMm: 0.5,
                  },
                },
              },
            }
          : layer,
      ),
    },
  };

  return { source: sourceWithStage, tool };
}

function roughingStage(project: Project) {
  return project.scene.layers.find(
    (layer) => layer.cnc?.stageRecipes?.['pocket-rough'] !== undefined,
  )?.cnc?.stageRecipes?.['pocket-rough'];
}
