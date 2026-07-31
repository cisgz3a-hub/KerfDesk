import { describe, expect, it } from 'vitest';
import {
  addObject,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

const PROVENANCE: NonNullable<ImportedSvg['libraryProvenance']> = {
  schemaVersion: 1,
  assetId: 'laser-kerf-comb',
  title: 'Laser kerf comb',
  sourceName: 'CurveDesk',
  licenseId: 'MIT',
  creator: 'CurveDesk contributors',
  licenseUrl: 'https://opensource.org/license/mit',
  assetHash: 'sha256:abc123',
};

function projectWithLibraryAsset(): Project {
  const base = createProject();
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'library-object',
    source: 'Library: Laser kerf comb',
    libraryProvenance: PROVENANCE,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
  };
  return { ...base, scene: addObject(base.scene, object) };
}

describe('project Library provenance IO', () => {
  it('round-trips the immutable provenance snapshot', () => {
    const result = deserializeProject(serializeProject(projectWithLibraryAsset()));

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      const object = result.project.scene.objects[0];
      expect(object?.kind).toBe('imported-svg');
      if (object?.kind === 'imported-svg') {
        expect(object.libraryProvenance).toEqual(PROVENANCE);
      }
    }
  });

  it('loads geometry and drops an unsupported provenance schema version', () => {
    const raw = JSON.parse(serializeProject(projectWithLibraryAsset())) as {
      scene: { objects: Array<Record<string, unknown>> };
    };
    const object = raw.scene.objects[0];
    if (object === undefined) throw new Error('expected Library object');
    object['libraryProvenance'] = { ...PROVENANCE, schemaVersion: 2 };

    const result = deserializeProject(JSON.stringify(raw));

    expectLoadedWithoutLibraryProvenance(result);
  });

  it('loads geometry and drops malformed required provenance fields', () => {
    const raw = JSON.parse(serializeProject(projectWithLibraryAsset())) as {
      scene: { objects: Array<Record<string, unknown>> };
    };
    const object = raw.scene.objects[0];
    if (object === undefined) throw new Error('expected Library object');
    object['libraryProvenance'] = { ...PROVENANCE, licenseId: 123 };

    const result = deserializeProject(JSON.stringify(raw));

    expectLoadedWithoutLibraryProvenance(result);
  });

  it.each(['assetId', 'title', 'sourceName', 'licenseId'] as const)(
    'loads geometry and drops provenance with a blank required %s field',
    (field) => {
      const raw = JSON.parse(serializeProject(projectWithLibraryAsset())) as {
        scene: { objects: Array<Record<string, unknown>> };
      };
      const object = raw.scene.objects[0];
      if (object === undefined) throw new Error('expected Library object');
      object['libraryProvenance'] = { ...PROVENANCE, [field]: ' \t ' };

      const result = deserializeProject(JSON.stringify(raw));

      expectLoadedWithoutLibraryProvenance(result);
    },
  );

  it.each([null, 'unknown', { ...PROVENANCE, creator: 123 }, { ...PROVENANCE, sourceUrl: false }])(
    'loads geometry and drops unavailable or malformed optional metadata %#',
    (provenance) => {
      const raw = JSON.parse(serializeProject(projectWithLibraryAsset())) as {
        scene: { objects: Array<Record<string, unknown>> };
      };
      const object = raw.scene.objects[0];
      if (object === undefined) throw new Error('expected Library object');
      object['libraryProvenance'] = provenance;

      const result = deserializeProject(JSON.stringify(raw));

      expectLoadedWithoutLibraryProvenance(result);
    },
  );

  it('rebuilds valid provenance without trusting unknown extra fields', () => {
    const raw = JSON.parse(serializeProject(projectWithLibraryAsset())) as {
      scene: { objects: Array<Record<string, unknown>> };
    };
    const object = raw.scene.objects[0];
    if (object === undefined) throw new Error('expected Library object');
    object['libraryProvenance'] = { ...PROVENANCE, futureDisplayHint: 'untrusted' };

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      const loaded = result.project.scene.objects[0];
      expect(loaded?.kind).toBe('imported-svg');
      if (loaded?.kind === 'imported-svg') {
        expect(loaded.libraryProvenance).toEqual(PROVENANCE);
        expect(loaded.libraryProvenance).not.toHaveProperty('futureDisplayHint');
      }
    }
  });
});

function expectLoadedWithoutLibraryProvenance(result: ReturnType<typeof deserializeProject>): void {
  expect(result.kind).toBe('ok');
  if (result.kind !== 'ok') return;
  const object = result.project.scene.objects[0];
  expect(object?.kind).toBe('imported-svg');
  if (object?.kind !== 'imported-svg') return;
  expect(object.id).toBe('library-object');
  expect(object.bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  expect(object.libraryProvenance).toBeUndefined();
}
