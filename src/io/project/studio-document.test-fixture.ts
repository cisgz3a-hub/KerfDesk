import type { StudioDocument } from '../../core/scene/studio-document';

export function studioDocument(patch: Partial<StudioDocument> = {}): StudioDocument {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    editor: 'vector',
    title: 'Layered artwork',
    editorVersion: '0.9.0',
    nativeFormat: 'vectorcraft',
    nativeBase64: 'YWJj',
    nativeSha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    revision: 'revision-one',
    ...patch,
  };
}
