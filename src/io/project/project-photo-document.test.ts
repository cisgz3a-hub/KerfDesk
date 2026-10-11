import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import {
  MAX_PHOTO_EDITOR_DOCUMENT_BYTES,
  MAX_PHOTO_EDITOR_LAYERS,
  PHOTO_EDITOR_BLENDS,
  type PhotoEditorDocument,
} from '../../core/scene/photo-editor-document';
import { deserializeProject } from './deserialize-project';
import { prepareProjectForAutosave } from './prepare-project-autosave';
import { prepareProjectForPersistence } from './prepare-project-persistence';
import { serializeProject } from './serialize-project';
import { validatePhotoEditorDocument } from './project-photo-document-validator';

const pixels = Uint8Array.from([255, 0, 27, 0, 13, 99, 128, 127]);

function document(): PhotoEditorDocument {
  return {
    version: 1,
    width: 2,
    height: 1,
    activeLayerId: 'paint',
    layers: [
      {
        id: 'base',
        name: 'Original',
        isVisible: true,
        opacity: 1,
        blend: 'normal',
        rgbaBase64: btoa('\xff'.repeat(8)),
      },
      {
        id: 'paint',
        name: 'Retouch',
        isVisible: false,
        opacity: 0.375,
        blend: 'multiply',
        rgbaBase64: btoa(String.fromCharCode(...pixels)),
      },
    ],
  };
}

function project(editorDocument: unknown = document()): Project {
  const base = createProject();
  const photo: RasterImage = {
    kind: 'raster-image',
    id: 'photo',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,source',
    pixelWidth: 2,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
    ...(editorDocument === undefined
      ? {}
      : { editorDocument: editorDocument as PhotoEditorDocument }),
  };
  return {
    ...base,
    scene: {
      ...base.scene,
      objects: [photo],
      layers: [createLayer({ id: 'image', color: '#808080', mode: 'image' })],
    },
  };
}

describe('persistent editable photo documents', () => {
  it('saves and reopens exact layer order, visibility, blend, active layer and transparent RGBA', () => {
    const original = project();
    const saved = prepareProjectForPersistence(original);
    expect(saved.kind).toBe('ok');
    if (saved.kind !== 'ok') throw Error(saved.reason);
    const reopened = deserializeProject(saved.json);
    expect(reopened.kind).toBe('ok');
    if (reopened.kind !== 'ok') throw Error('Expected project to reopen');
    const photo = reopened.project.scene.objects[0] as RasterImage;
    expect(photo.editorDocument).toEqual(document());
    const encoded = photo.editorDocument?.layers[1]?.rgbaBase64 ?? '';
    expect(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))).toEqual(pixels);
    expect(serializeProject(reopened.project)).toBe(saved.json);
    const autosave = prepareProjectForAutosave(original);
    expect(autosave.kind).toBe('ok');
    if (autosave.kind === 'ok')
      expect(JSON.parse(autosave.json).scene.objects[0].editorDocument).toEqual(document());
  });

  it('keeps old flattened images valid without a migration or fabricated photo document', () => {
    const original = project();
    const raw = JSON.parse(serializeProject(original));
    delete raw.scene.objects[0].editorDocument;
    const reopened = deserializeProject(JSON.stringify(raw));
    expect(reopened.kind).toBe('ok');
    if (reopened.kind === 'ok') {
      expect(reopened.project.schemaVersion).toBe(original.schemaVersion);
      expect(reopened.project.scene.objects[0]).not.toHaveProperty('editorDocument');
    }
  });

  it.each(PHOTO_EDITOR_BLENDS)('retains the supported %s blend', (blend) => {
    const doc = document();
    expect(
      prepareProjectForPersistence(
        project({ ...doc, layers: doc.layers.map((layer) => ({ ...layer, blend })) }),
      ).kind,
    ).toBe('ok');
  });

  it.each([
    null,
    [],
    { ...document(), version: 2 },
    { ...document(), width: 3 },
    { ...document(), height: 0 },
    { ...document(), activeLayerId: 'absent' },
    { ...document(), layers: [] },
    { ...document(), layers: [null] },
    { ...document(), layers: [document().layers[0], document().layers[0]] },
    {
      ...document(),
      layers: Array.from({ length: MAX_PHOTO_EDITOR_LAYERS + 1 }, (_, index) => ({
        ...document().layers[0],
        id: String(index),
      })),
    },
  ])('rejects malformed document structure: %j', (doc) => {
    const result = deserializeProject(serializeProject(project(doc)));
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toContain('editorDocument');
  });

  it.each([
    { id: '' },
    { id: '   ' },
    { id: 42 },
    { name: null },
    { isVisible: 'yes' },
    { opacity: -0.01 },
    { opacity: 1.01 },
    { opacity: null },
    { blend: 'unknown' },
    { rgbaBase64: '' },
    { rgbaBase64: '///////////=' }, // Noncanonical unused tail bits.
    { rgbaBase64: '//////////8' }, // Missing padding.
    { rgbaBase64: '//////////8==' },
    { rgbaBase64: '//////////8=\n' },
    { rgbaBase64: '////=/////8=' },
    { rgbaBase64: '__________8=' },
    { rgbaBase64: 'AAAAAAAAAAAA' }, // Valid base64, wrong decoded length.
  ])('rejects unsafe layer fields: %j', (patch) => {
    const doc = document();
    const result = deserializeProject(
      serializeProject(
        project({ ...doc, layers: [{ ...doc.layers[0], ...patch }, doc.layers[1]] }),
      ),
    );
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toContain('editorDocument.layers[0]');
  });

  it('rejects oversized restoration before decoding or scanning supplied pixel strings', () => {
    const doc = document();
    const width = MAX_PHOTO_EDITOR_DOCUMENT_BYTES / 4;
    expect(
      validatePhotoEditorDocument({ ...doc, width, height: 1 }, 'photo.editorDocument', width, 1),
    ).toContain('decoded layers exceed');
  });

  it('accepts exact byte boundaries for one- and zero-padding RGBA lengths', () => {
    const layer = document().layers[0];
    for (const width of [1, 2, 3]) {
      const doc = {
        ...document(),
        width,
        activeLayerId: 'base',
        layers: [{ ...layer, rgbaBase64: btoa('\x00'.repeat(width * 4)) }],
      };
      expect(validatePhotoEditorDocument(doc, 'doc', width, 1)).toBeNull();
    }
  });
});
