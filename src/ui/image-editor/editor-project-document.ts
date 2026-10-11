import { cloneRgbaBuffer } from '../../core/image-edit';
import type { EditorLayer } from '../../core/image-layers';
import { decodePhotoPixels, encodePhotoPixels } from './photo-document-base64';
import {
  MAX_PHOTO_EDITOR_DOCUMENT_BYTES,
  MAX_PHOTO_EDITOR_LAYERS,
  type PhotoEditorDocument,
} from '../../core/scene/photo-editor-document';
import type { RasterImage } from '../../core/scene';
import { validatePhotoEditorDocument } from '../../io/project/project-photo-document-validator';
import { createSession, type EditorSession } from './editor-session';
import { compositeSession } from './editor-session-layers';
import { bakeBufferToBitmapFields, decodeRasterToBuffer } from './image-editor-decode';

export async function bakeProjectPhoto(session: EditorSession) {
  const document = captureProjectDocument(session);
  const bitmap = bakeBufferToBitmapFields(compositeSession(session));
  const [editorDocument, fields] = await Promise.all([document, bitmap]);
  return { ...fields, editorDocument };
}

/** Own the pixels synchronously; encode them in bounded, yielding slices. */
export async function captureProjectDocument(session: EditorSession): Promise<PhotoEditorDocument> {
  const { width, height } = session.doc;
  if (
    session.layers.length > MAX_PHOTO_EDITOR_LAYERS ||
    width * height * 4 * session.layers.length > MAX_PHOTO_EDITOR_DOCUMENT_BYTES
  )
    throw new Error(
      'Photo layers exceed the 128 MiB editable document limit. Reduce image size or merge layers.',
    );
  const frozen = session.layers.map((layer) => ({
    ...layer,
    buffer: cloneRgbaBuffer(layer.buffer),
  }));
  const layers: PhotoEditorDocument['layers'][number][] = [];
  for (const { buffer, ...layer } of frozen) {
    layers.push({
      ...layer,
      rgbaBase64: await encodePhotoPixels(new Uint8Array(buffer.data.buffer)),
    });
  }
  return {
    version: 1,
    width,
    height,
    activeLayerId: session.activeLayerId,
    layers,
  };
}

/** Old projects still open their bitmap; new projects restore lossless layer pixels. */
export async function openProjectPhoto(image: RasterImage): Promise<EditorSession> {
  const document = image.editorDocument;
  if (document === undefined)
    return createSession(image.id, image.source, await decodeRasterToBuffer(image), image.bounds);
  const error = validatePhotoEditorDocument(
    document,
    'photo layers',
    image.pixelWidth,
    image.pixelHeight,
    false,
  );
  if (error !== null) throw new Error(error);
  const layers = await decodeLayers(document);
  const active = layers.find((layer) => layer.id === document.activeLayerId);
  if (active === undefined) throw new Error('The saved photo has no active layer.');
  const session = {
    ...createSession(image.id, image.source, active.buffer, image.bounds),
    layers,
    activeLayerId: active.id,
  };
  return {
    ...session,
    base: cloneRgbaBuffer(compositeSession(session)),
    baseLayers: layers.map((layer) => ({ ...layer, buffer: cloneRgbaBuffer(layer.buffer) })),
    baseActiveLayerId: active.id,
  };
}

async function decodeLayers(document: PhotoEditorDocument): Promise<readonly EditorLayer[]> {
  const bytes = document.width * document.height * 4;
  if (
    !Number.isSafeInteger(bytes) ||
    bytes <= 0 ||
    bytes * document.layers.length > MAX_PHOTO_EDITOR_DOCUMENT_BYTES
  )
    throw new Error('The saved photo layers exceed the editable document limit.');
  const layers: EditorLayer[] = [];
  for (const { rgbaBase64, ...layer } of document.layers) {
    const decoded = await decodePhotoPixels(rgbaBase64, bytes);
    layers.push({
      ...layer,
      buffer: {
        width: document.width,
        height: document.height,
        data: new Uint8ClampedArray(decoded.buffer),
      },
    });
  }
  return layers;
}
