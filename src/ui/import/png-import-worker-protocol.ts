import type {
  PngPagedImportOptions,
  PngPagedImportProgress,
  PngPagedImportResult,
} from './png-paged-import';

export type PngImportWorkerRequest =
  | {
      readonly id: number;
      readonly kind: 'import-png';
      readonly stream: ReadableStream<Uint8Array>;
      readonly source: {
        readonly byteLength: number;
        readonly mimeType: string;
      };
      readonly options: Omit<PngPagedImportOptions, 'signal' | 'onProgress'>;
    }
  | { readonly id: number; readonly kind: 'cancel' };

export type PngImportWorkerResponse =
  | {
      readonly id: number;
      readonly kind: 'progress';
      readonly progress: PngPagedImportProgress;
    }
  | {
      readonly id: number;
      readonly kind: 'complete';
      readonly result: PngPagedImportResult;
    }
  | { readonly id: number; readonly kind: 'cancelled' }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };
