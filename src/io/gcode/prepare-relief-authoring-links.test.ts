import { describe, expect, it } from 'vitest';
import { DEFAULT_CNC_LAYER_SETTINGS } from '../../core/scene';
import type { HeightfieldReliefObject } from '../../core/scene/scene-object';
import type { Project } from '../../core/scene/project';
import { filterSceneForOutputScope } from '../../core/scene/output-scope';
import {
  reliefProjectionProject as project,
  reliefProjectionSelection as selection,
} from '../../__fixtures__/relief-projection';
import { prepareReliefAuthoringLinks } from './prepare-relief-authoring-links';
import { prepareOutput } from './prepare-output';

function target(document: Project): HeightfieldReliefObject {
  return document.scene.objects.find((o) => o.id === 'relief') as HeightfieldReliefObject;
}

describe('retained relief links during scoped output preparation', () => {
  it('materializes an off-output projection dependency using links outside the selected artwork', () => {
    const original = project(),
      before = target(original);
    const scoped = filterSceneForOutputScope(original.scene, selection);
    expect(scoped.objects.map((o) => o.id)).toEqual(['vector']);
    const result = prepareReliefAuthoringLinks(original, scoped);
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result.scene.objects.map((o) => o.id)).toEqual(['vector']);
    expect(result.scene.outputDependencies).toHaveLength(1);
    const prepared = result.scene.outputDependencies?.[0] as HeightfieldReliefObject;
    expect(prepared.id).toBe('relief');
    expect(prepared.reliefSource.revision).toBe(before.reliefSource.revision + 1);
    expect(prepared.reliefAuthoring?.revision).toBe(prepared.reliefSource.revision);
    expect(prepared.reliefSource.samplesBase64).not.toBe(before.reliefSource.samplesBase64);
    expect(target(original)).toBe(before);
    expect(before.reliefAuthoring?.revision).toBe(1);
  });
  it('compiles only the selected vector and records the refreshed target revision and vertical depth', () => {
    const original = project();
    const prepared = prepareOutput(original, { outputScope: selection });
    if (!prepared.ok) throw new Error(JSON.stringify(prepared.preflight));
    expect(prepared.project.scene.objects.map((o) => o.id)).toEqual(['vector']);
    expect(prepared.job.groups).toHaveLength(1);
    expect(prepared.job.cncCompilation?.reliefPlans).toEqual([
      expect.objectContaining({ stage: 'projection', targetRevision: 2, verticalDepthMm: 0.2 }),
    ]);
    const group = prepared.job.groups[0];
    if (group?.kind !== 'cnc') throw new Error('Missing projected CNC group.');
    const pass = group.passes[0];
    if (pass?.kind !== 'path3d') throw new Error('Missing projected vector.');
    expect(pass.points[0]?.z).toBeCloseTo(-5 * (1 - 10000 / 65535) - 0.2, 4);
    expect(target(original).reliefSource.revision).toBe(1);
  });
  it('returns a factual source failure for a missing live mask on the off-output target', () => {
    const original = project();
    const broken = {
      ...original,
      scene: { ...original.scene, objects: original.scene.objects.filter((o) => o.id !== 'mask') },
    };
    expect(prepareOutput(broken, { outputScope: selection })).toMatchObject({
      ok: false,
      preflight: {
        issues: [
          {
            code: 'relief-materialization-failed',
            message: expect.stringMatching(/retained.png.*mask.*missing/s),
          },
        ],
      },
    });
    expect(target(broken).reliefSource.revision).toBe(1);
  });
  it('refreshes a selected relief against unselected vectors without adding executable boundaries', () => {
    const original = project();
    const enabled = {
      ...original,
      scene: {
        ...original.scene,
        layers: original.scene.layers.map((layer) => ({ ...layer, output: layer.id === 'target' })),
      },
    };
    const scoped = filterSceneForOutputScope(enabled.scene, {
      ...selection,
      selectedObjectIds: ['relief'],
    });
    const result = prepareReliefAuthoringLinks(enabled, scoped);
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result.scene.objects).toHaveLength(1);
    expect(result.scene.outputDependencies ?? []).toEqual([]);
    expect((result.scene.objects[0] as HeightfieldReliefObject).reliefSource.revision).toBe(2);
  });
  it('does not resolve an unused broken relief for an ordinary selected vector operation', () => {
    const original = project();
    const ordinary = {
      ...original,
      scene: {
        ...original.scene,
        layers: original.scene.layers.map((layer) => ({
          ...layer,
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'engrave' as const },
        })),
        objects: original.scene.objects.filter((o) => o.id !== 'mask'),
      },
    };
    const scoped = filterSceneForOutputScope(ordinary.scene, selection);
    const result = prepareReliefAuthoringLinks(ordinary, scoped);
    expect(result).toEqual({ kind: 'ok', scene: scoped });
    expect(prepareOutput(ordinary, { outputScope: selection }).ok).toBe(true);
  });
});
