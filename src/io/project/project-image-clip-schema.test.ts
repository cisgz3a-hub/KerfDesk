import { describe, expect, it } from 'vitest';
import {
  clipRectangle,
  ownedClipImage,
  ownedClipProject,
} from '../../__fixtures__/owned-image-clip';
import { compileJob } from '../../core/job';
import type { ImportedSvg } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { migrateToCurrent } from './migrations';
import { prepareProjectForPersistence } from './prepare-project-persistence';

describe('schema 9 owned image clip persistence', () => {
  it('writes the clip and its native geometry under the current schema and reads it without migration', () => {
    const original = ownedClipProject();
    const prepared = prepareProjectForPersistence(original);
    if (prepared.kind !== 'ok') throw Error(prepared.reason);
    expect(JSON.parse(prepared.json).schemaVersion).toBe(10);
    const loaded = deserializeProject(prepared.json);
    if (loaded.kind !== 'ok') throw Error('Expected schema 9 artwork.');
    expect(loaded.migratedFrom).toBeUndefined();
    expect(loaded.project.scene.objects).toEqual(original.scene.objects);
    expect(loaded.project.scene.objects).toHaveLength(1);
    expect(compileJob(loaded.project.scene, loaded.project.device)).toEqual(
      compileJob(original.scene, original.device),
    );
  });

  it('promotes schema 8 without adding clips or changing its pixels, external mask or output', () => {
    const { imageClip: _clip, svgImport: _source, ...image } = ownedClipImage();
    const mask: ImportedSvg = {
      kind: 'imported-svg',
      id: 'legacy-mask',
      source: 'mask.svg',
      bounds: image.bounds,
      transform: image.transform,
      paths: [clipRectangle(11, 20, 13, 24)],
    };
    const current = ownedClipProject({ ...image, imageMaskId: mask.id });
    const legacy = {
      ...current,
      schemaVersion: 8,
      scene: { ...current.scene, objects: [...current.scene.objects, mask] },
    };
    const before = JSON.stringify(legacy);
    const migrated = migrateToCurrent(legacy, 8);
    expect(migrated).toEqual({ kind: 'ok', raw: { ...legacy, schemaVersion: 10 }, steps: [8, 9] });
    if (migrated.kind === 'ok') expect(migrated.raw['scene']).toBe(legacy.scene);
    expect(JSON.stringify(legacy)).toBe(before);
    const loaded = deserializeProject(before);
    if (loaded.kind !== 'ok') throw Error('Expected legacy artwork to migrate.');
    expect(loaded.migratedFrom).toBe(8);
    expect(loaded.project.schemaVersion).toBe(10);
    expect(loaded.project.scene.objects).toEqual(legacy.scene.objects);
    expect(loaded.project.scene.objects[0]).not.toHaveProperty('imageClip');
    expect(compileJob(loaded.project.scene, loaded.project.device)).toEqual(
      compileJob(legacy.scene, legacy.device),
    );
  });
});
