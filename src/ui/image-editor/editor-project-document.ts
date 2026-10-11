import { cloneRgbaBuffer } from '../../core/image-edit';
import type { EditorLayer } from '../../core/image-layers';
import { decodeCanonicalBase64, encodeCanonicalBase64 } from '../../core/relief/depth-map-base64';
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
  const editorDocument = captureProjectDocument(session);
  const fields = await bakeBufferToBitmapFields(compositeSession(session));
  return { ...fields, editorDocument };
}

/** Capture synchronously, before the asynchronous composite PNG encode can yield. */
export function captureProjectDocument(session: EditorSession): PhotoEditorDocument {
  const { width, height } = session.doc;
  if (
    session.layers.length > MAX_PHOTO_EDITOR_LAYERS ||
    width * height * 4 * session.layers.length > MAX_PHOTO_EDITOR_DOCUMENT_BYTES
  )
    throw new Error(
      'Photo layers exceed the 128 MiB editable document limit. Reduce image size or merge layers.',
    );
  return {
    version: 1,
    width,
    height,
    activeLayerId: session.activeLayerId,
    layers: session.layers.map(({ buffer, ...layer }) => ({
      ...layer,
      rgbaBase64: encodeCanonicalBase64(
        new Uint8Array(buffer.data.buffer, buffer.data.byteOffset, buffer.data.byteLength),
      ),
    })),
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
  );
  if (error !== null) throw new Error(error);
  const layers = decodeLayers(document);
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

function decodeLayers(document: PhotoEditorDocument): readonly EditorLayer[] {
  const bytes = document.width * document.height * 4;
  if (
    !Number.isSafeInteger(bytes) ||
    bytes <= 0 ||
    bytes * document.layers.length > MAX_PHOTO_EDITOR_DOCUMENT_BYTES
  )
    throw new Error('The saved photo layers exceed the editable document limit.');
  return document.layers.map(({ rgbaBase64, ...layer }) => {
    const decoded = decodeCanonicalBase64(rgbaBase64);
    if (decoded.kind !== 'ok' || decoded.bytes.length !== bytes)
      throw new Error('The saved photo layer pixels are invalid.');
    return {
      ...layer,
      buffer: {
        width: document.width,
        height: document.height,
        data: new Uint8ClampedArray(decoded.bytes.buffer),
      },
    };
  });
}
