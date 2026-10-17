import { describe, expect, it } from 'vitest';
import { createLayer, createLayerSubLayer, createProject } from '../../core/scene';
import { migrateToCurrent } from './migrations';
import { migrateV17FocusIntent } from './migrate-v17-focus-intent';
import { deserializeProject } from './deserialize-project';
const focus = { offsetMm: 1, travelFeedMmPerMin: 300 };
const layer = createLayer({ id: 'legacy', color: '#000000' });
const sub = createLayerSubLayer(layer, { id: 'pass', label: 'Pass' });
function legacy(version: number) {
  const project = createProject();
  return {
    ...project,
    schemaVersion: version,
    scene: {
      ...project.scene,
      layers: [
        {
          ...layer,
          focusTest: focus,
          subLayers: [{ ...sub, settings: { ...sub.settings, focusTest: focus } }],
          materialBinding: {
            libraryId: 'lib',
            presetId: 'preset',
            lastResolved: { ...sub.settings, focusTest: focus },
          },
        },
      ],
    },
  };
}
function freeze(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
}
describe('Legacy Focus schema boundary', () => {
  it.each([16, 17])(
    'strips unknown intent through schema %s without mutating the source',
    (version) => {
      const raw = legacy(version);
      const before = structuredClone(raw);
      freeze(raw);
      const migrated = migrateToCurrent(raw, version);
      expect(migrated.kind).toBe('ok');
      expect(raw).toEqual(before);
      const loaded = deserializeProject(JSON.stringify(raw));
      expect(loaded.kind).toBe('ok');
      if (loaded.kind !== 'ok') throw new Error('Expected migrated artwork');
      const restored = loaded.project.scene.layers[0];
      expect(restored).not.toHaveProperty('focusTest');
      expect(restored?.subLayers[0]?.settings).not.toHaveProperty('focusTest');
      expect(restored?.materialBinding?.lastResolved).not.toHaveProperty('focusTest');
      expect(restored?.subLayers[0]?.settings.speed).toBe(sub.settings.speed);
    },
  );
  it.each([null, 5, [], 'invalid'])(
    'preserves malformed layer/settings shapes %j for validation',
    (value) => {
      const raw = {
        schemaVersion: 17,
        scene: {
          layers: [value, { subLayers: [value, { settings: value }], materialBinding: value }],
        },
      };
      const migrated = migrateV17FocusIntent(raw);
      expect(migrated.scene).toEqual(raw.scene);
      const project = createProject();
      expect(deserializeProject(JSON.stringify({ ...project, ...migrated })).kind).toBe('invalid');
    },
  );
  it.each([null, [], 5])('does not fabricate malformed scene or layers %j', (value) => {
    expect(migrateV17FocusIntent({ schemaVersion: 17, scene: value }).scene).toBe(value);
    expect(migrateV17FocusIntent({ schemaVersion: 17, scene: { layers: value } }).scene).toEqual({
      layers: value,
    });
  });
  it('leaves current schema root intent intact and rejects current nested intent', () => {
    const project = createProject();
    const current = {
      ...project,
      scene: { ...project.scene, layers: [{ ...layer, focusTest: focus }] },
    };
    const loaded = deserializeProject(JSON.stringify(current));
    expect(loaded.kind).toBe('ok');
    if (loaded.kind === 'ok') expect(loaded.project.scene.layers[0]?.focusTest).toEqual(focus);
    expect(deserializeProject(JSON.stringify(legacy(18))).kind).toBe('invalid');
  });
});
