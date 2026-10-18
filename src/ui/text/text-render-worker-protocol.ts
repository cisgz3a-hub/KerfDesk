import type { TextGeometryRequest } from './text-geometry-compute';
import type { TextRenderResultMessage } from './text-render-result-transfer';

/** Work the text worker does for canvas text editing (ADR-616). */
export type TextWorkerTask =
  /** renderTextGeometry; `fontToken` names the outline font file, absent for stroke fonts. */
  | { readonly kind: 'render'; readonly input: TextGeometryRequest; readonly fontToken?: number }
  /** The characters of `content` the outline font has no glyph for. */
  | { readonly kind: 'missing-characters'; readonly content: string; readonly fontToken: number };

export type TextWorkerRequest = {
  readonly id: number;
  /** Present only when this worker does not hold the task's font file yet. */
  readonly font?: { readonly token: number; readonly buffer: ArrayBuffer };
  readonly task: TextWorkerTask;
};

export type TextWorkerResponse =
  | { readonly id: number; readonly kind: 'rendered'; readonly result: TextRenderResultMessage }
  | { readonly id: number; readonly kind: 'missing'; readonly characters: ReadonlyArray<string> }
  | { readonly id: number; readonly kind: 'fatal'; readonly message: string };
