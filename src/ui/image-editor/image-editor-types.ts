// Shared Image Studio UI types (ADR-242).

export type BitmapFields = {
  readonly dataUrl: string;
  readonly lumaBase64: string;
};

/** Editor viewport: document px → canvas px is scale, then pan offset. */
export type EditorView = {
  readonly scale: number;
  readonly panX: number;
  readonly panY: number;
};
