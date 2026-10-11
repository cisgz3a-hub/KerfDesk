/** Lossless, editable photo source retained beside the applied raster composite. */
export type PhotoEditorDocument = {
  readonly version: 1;
  readonly width: number;
  readonly height: number;
  readonly activeLayerId: string;
  /** Layers are ordered from bottom to top. All buffers cover the full document. */
  readonly layers: ReadonlyArray<PhotoEditorLayer>;
};

export const PHOTO_EDITOR_BLENDS = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'difference',
] as const;
export type PhotoEditorBlend = (typeof PHOTO_EDITOR_BLENDS)[number];

export type PhotoEditorLayer = {
  readonly id: string;
  readonly name: string;
  readonly isVisible: boolean;
  /** Inclusive 0..1. */
  readonly opacity: number;
  readonly blend: PhotoEditorBlend;
  /** Canonical padded base64 containing exactly width * height * 4 RGBA bytes. */
  readonly rgbaBase64: string;
};

/** Bound allocations before restoring a persisted stack into editor buffers. */
export const MAX_PHOTO_EDITOR_DOCUMENT_BYTES = 128 * 1024 * 1024;
export const MAX_PHOTO_EDITOR_LAYERS = 128;
