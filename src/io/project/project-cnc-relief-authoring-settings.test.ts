import { describe, expect, it } from 'vitest';
import {
  normalizeCncReliefAuthoringSettings,
  validateCncReliefAuthoringSettings,
} from './project-cnc-relief-authoring-settings';
import { deserializeProject } from './deserialize-project';
import { createLayer, createProject, DEFAULT_CNC_LAYER_SETTINGS } from '../../core/scene';

describe('advanced scalar relief settings persistence', () => {
  const settings = {
    reliefRestFinishToolId: 'fine',
    reliefRestResidualMm: 0,
    reliefRestScallopMm: 0.02,
    reliefProjection: {
      reliefObjectId: 'retained-target',
      depthMm: 0.25,
      depthConvention: 'vertical',
      sampleSpacingMm: 0.1,
    },
  };
  it('round trips complete physical settings and keeps missing target references for repair', () => {
    expect(validateCncReliefAuthoringSettings(settings, 'cnc')).toBeNull();
    expect(normalizeCncReliefAuthoringSettings(settings)).toEqual(settings);
    const base = createLayer({ id: 'L1', color: '#000000' }),
      project = createProject();
    const reopened = deserializeProject(
      JSON.stringify({
        ...project,
        scene: {
          ...project.scene,
          layers: [{ ...base, cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...settings } }],
        },
      }),
    );
    if (reopened.kind !== 'ok') throw new Error('Project did not reopen.');
    expect(reopened.project.scene.layers[0]?.cnc?.reliefProjection).toEqual(
      settings.reliefProjection,
    );
    expect(reopened.project.scene.layers[0]?.cnc?.reliefRestResidualMm).toBe(0);
  });
  it('rejects malformed physical recipes and leaves legacy absence intact', () => {
    expect(normalizeCncReliefAuthoringSettings({})).toEqual({});
    for (const projection of [
      null,
      { ...settings.reliefProjection, depthConvention: 'normal' },
      { ...settings.reliefProjection, sampleSpacingMm: 0 },
      { ...settings.reliefProjection, depthMm: Number.NaN },
    ])
      expect(validateCncReliefAuthoringSettings({ reliefProjection: projection }, 'cnc')).toContain(
        'vertical',
      );
    expect(validateCncReliefAuthoringSettings({ reliefRestResidualMm: -1 }, 'cnc')).toContain(
      'non-negative',
    );
    expect(
      normalizeCncReliefAuthoringSettings({
        reliefProjection: { ...settings.reliefProjection, depthConvention: 'normal' },
      }),
    ).toEqual({});
  });
});
