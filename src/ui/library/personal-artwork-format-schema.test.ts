import { afterEach, expect, it, vi } from 'vitest';
import { ownedClipImage, ownedClipProject } from '../../__fixtures__/owned-image-clip';
import type * as ProjectModule from '../../core/scene/project';
import { serializeProject } from '../../io/project/serialize-project';
import {
  parsePersonalArtworkLibrary,
  serializePersonalArtworkLibrary,
} from './personal-artwork-format';
import { personalArtworkProject, type PersonalArtwork } from './personal-artwork-model';

afterEach(() => {
  vi.doUnmock('../../core/scene/project');
  vi.resetModules();
});

function entry(projectJson: string): PersonalArtwork {
  return {
    id: 'clip-library-entry',
    name: 'Clipped image',
    category: 'SVG',
    projectJson,
    selectedObjectIds: ['owned-image'],
  };
}

function legacyEntry(): PersonalArtwork {
  const { imageClip: _clip, svgImport: _source, ...image } = ownedClipImage();
  return entry(JSON.stringify({ ...ownedClipProject(image), schemaVersion: 8 }));
}

it('keeps the v1 library envelope while carrying schema 9 clip geometry in its validated project', () => {
  const project = ownedClipProject();
  const current = entry(serializeProject(project));
  const bytes = serializePersonalArtworkLibrary([current]);
  expect(JSON.parse(bytes).version).toBe(1);
  const imported = parsePersonalArtworkLibrary(bytes);
  expect(imported).toEqual([current]);
  const restored = personalArtworkProject(imported[0]!);
  expect(restored.schemaVersion).toBe(10);
  expect(restored.scene.objects).toEqual(project.scene.objects);
});

it('migrates a legacy v1 library project without inventing owned clip geometry', () => {
  const legacy = legacyEntry();
  const imported = parsePersonalArtworkLibrary(serializePersonalArtworkLibrary([legacy]));
  const restored = personalArtworkProject(imported[0]!);
  expect(imported).toEqual([legacy]);
  expect(restored.schemaVersion).toBe(10);
  expect(restored.scene.objects).toHaveLength(1);
  expect(restored.scene.objects[0]).not.toHaveProperty('imageClip');
});

it('makes a schema-8 library reader reject clip artwork at the contained project version boundary', async () => {
  const clipped = serializePersonalArtworkLibrary([entry(serializeProject(ownedClipProject()))]);
  const legacy = serializePersonalArtworkLibrary([legacyEntry()]);
  // Library v1 has always validated each contained project before accepting an
  // entry. Re-run that unchanged reader with the previous supported schema cap.
  vi.resetModules();
  vi.doMock('../../core/scene/project', async (importOriginal) => ({
    ...(await importOriginal<typeof ProjectModule>()),
    PROJECT_SCHEMA_VERSION: 8,
  }));
  const oldReader = await import('./personal-artwork-format');
  expect(() => oldReader.parsePersonalArtworkLibrary(clipped)).toThrow('schema-too-new');
  expect(oldReader.parsePersonalArtworkLibrary(legacy)).toHaveLength(1);
});
