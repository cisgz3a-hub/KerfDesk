// Messages between the Image Studio dialog and its neighbourhood-filter
// preview worker (ADR-245 Amendment 2).

import type { PixelRect, RgbaBuffer } from '../../core/image-edit';
import type { SelectionMask } from '../../core/image-select';
import type { AdjustRequest, PreviewWindow } from './adjust-preview-window';

/** The active layer the filter starts from, with the selection that clamps it. */
export type FilterPreviewSource = {
  /** A copy the worker owns (its buffer is transferred). */
  readonly doc: RgbaBuffer;
  readonly clip: PixelRect | null;
  readonly mask: SelectionMask | null;
};

export type FilterPreviewRequest = {
  readonly id: number;
  readonly adjustment: AdjustRequest;
  readonly win: PreviewWindow;
  /**
   * Null asks the worker to resample the document it filtered last (same
   * source, same settings, another window: a pan or zoom).
   */
  readonly source: FilterPreviewSource | null;
};

export type FilterPreviewResponse =
  | { readonly kind: 'progress'; readonly id: number; readonly fraction: number }
  /** The filtered active layer over `win`, window-sized, ready to composite. */
  | { readonly kind: 'done'; readonly id: number; readonly window: RgbaBuffer }
  | { readonly kind: 'error'; readonly id: number; readonly message: string };
