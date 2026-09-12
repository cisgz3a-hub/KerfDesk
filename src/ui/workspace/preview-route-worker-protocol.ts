import type { PreparedPreviewFrame } from './preview-route-frame';
import type { ViewTransform } from './view-transform';

export type PreviewRouteWorkerRequest = {
  readonly kind: 'render';
  readonly id: number;
  readonly frameId: number;
  readonly width: number;
  readonly height: number;
  readonly view: ViewTransform;
  /** Exact pixels below the route; transferred ownership ends after this paint. */
  readonly background: ImageBitmap;
  /** Required when frameId changes; viewport-only requests reuse the worker's one frame. */
  readonly frame?: PreparedPreviewFrame;
};

export type PreviewRouteWorkerResponse =
  | {
      readonly kind: 'painted';
      readonly id: number;
      readonly frameId: number;
      readonly bitmap: ImageBitmap;
    }
  | {
      readonly kind: 'error';
      readonly id: number;
      readonly frameId: number;
      readonly message: string;
    };
