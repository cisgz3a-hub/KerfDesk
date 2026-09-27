import { describe, expect, it } from 'vitest';
import { createLayer, createProject, DEFAULT_CNC_LAYER_SETTINGS } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { prepareProjectForPersistence } from './prepare-project-persistence';

const recipe = {
  toolId: 'finish-bit',
  feedMmPerMin: 321,
  plungeMmPerMin: 123,
  spindleRpm: 9000,
  depthPerPassMm: 0.2,
};
function project() {
  const base = createProject();
  return {
    ...base,
    scene: {
      ...base.scene,
      layers: [
        {
          ...createLayer({ id: 'L', color: '#000000' }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, stageRecipes: { 'relief-finish': recipe } },
        },
      ],
    },
  };
}
describe('CNC stage recipe persistence', () => {
  it('roundtrips physical values intact under schema 11', () => {
    const prepared = prepareProjectForPersistence(project());
    if (prepared.kind !== 'ok') throw new Error(prepared.reason);
    expect(JSON.parse(prepared.json).schemaVersion).toBe(11);
    const loaded = deserializeProject(prepared.json);
    if (loaded.kind !== 'ok') throw new Error('Load failed');
    expect(loaded.project.scene.layers[0]?.cnc?.stageRecipes?.['relief-finish']).toEqual(recipe);
  });
  it.each([0, -1, '321', null, Number.POSITIVE_INFINITY])(
    'rejects a malformed physical feed instead of changing cutting values: %s',
    (feedMmPerMin) => {
      const raw = project();
      const damaged = {
        ...raw,
        scene: {
          ...raw.scene,
          layers: raw.scene.layers.map((layer) => ({
            ...layer,
            cnc: { ...layer.cnc, stageRecipes: { 'relief-finish': { ...recipe, feedMmPerMin } } },
          })),
        },
      };
      const result = deserializeProject(JSON.stringify(damaged));
      expect(result.kind).toBe('invalid');
      if (result.kind === 'invalid')
        expect(result.reason).toContain('stageRecipes.relief-finish.feedMmPerMin');
    },
  );
  it('migrates schema 10 without inventing stage recipes', () => {
    const raw = createProject();
    const result = deserializeProject(
      JSON.stringify({
        ...raw,
        schemaVersion: 10,
        scene: {
          ...raw.scene,
          layers: [
            { ...createLayer({ id: 'L', color: '#000000' }), cnc: DEFAULT_CNC_LAYER_SETTINGS },
          ],
        },
      }),
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok')
      expect(result.project.scene.layers[0]?.cnc?.stageRecipes).toBeUndefined();
  });
});
