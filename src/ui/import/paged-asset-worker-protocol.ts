import type {
  PagedAssetManifest,
  PagedAssetProgress,
  StageAssetPagesOptions,
} from './paged-asset-stager';

export type PagedAssetStageRequest = {
  readonly id: number;
  readonly kind: 'stage';
  readonly blob: Blob;
  readonly options: Omit<StageAssetPagesOptions, 'signal' | 'onProgress'>;
};

export type PagedAssetWorkerRequest =
  | PagedAssetStageRequest
  | { readonly id: number; readonly kind: 'cancel' };

export type PagedAssetWorkerResponse =
  | {
      readonly id: number;
      readonly kind: 'progress';
      readonly progress: PagedAssetProgress;
    }
  | {
      readonly id: number;
      readonly kind: 'complete';
      readonly manifest: PagedAssetManifest;
    }
  | { readonly id: number; readonly kind: 'cancelled' }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };
