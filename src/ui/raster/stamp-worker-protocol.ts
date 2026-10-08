import type {
  StampHeightDraft,
  StampRequest,
  StampSourcePixels,
} from '../../core/raster/stamp-height';
import type { BitmapFields } from './luma-bitmap';
export type StampWorkerRequest = {
  readonly source: StampSourcePixels;
  readonly request: StampRequest;
};
export type StampEncodedDraft = Omit<StampHeightDraft, 'face' | 'luma'> &
  BitmapFields & {
    readonly sourceDataUrl: string;
    readonly faceDataUrl: string;
  };
export type StampWorkerResponse =
  | { readonly kind: 'ok'; readonly draft: StampEncodedDraft }
  | { readonly kind: 'error'; readonly message: string };
