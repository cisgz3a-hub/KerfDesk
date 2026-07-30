import type { DeserializeResult as DeserializeProjectResult } from '../../io/project';
import type { ParseSvgResult } from '../../io/svg';
import type { LbrnImportResult, ClbImportResult } from '../../io/lightburn';
import type { DeserializeMaterialLibraryResult } from '../../io/material-library';

export type DocumentImportWorkerRequest =
  | { readonly id: number; readonly kind: 'project'; readonly blob: Blob }
  | {
      readonly id: number;
      readonly kind: 'svg';
      readonly blob: Blob;
      readonly objectId: string;
      readonly source: string;
    }
  | {
      readonly id: number;
      readonly kind: 'lightburn-project';
      readonly blob: Blob;
      readonly source: string;
    }
  | { readonly id: number; readonly kind: 'material-library'; readonly blob: Blob }
  | {
      readonly id: number;
      readonly kind: 'lightburn-clb';
      readonly blob: Blob;
      readonly source: string;
    };

export type DocumentImportWorkerResponse =
  | {
      readonly id: number;
      readonly kind: 'progress';
      readonly phase: 'reading' | 'parsing';
    }
  | { readonly id: number; readonly kind: 'project'; readonly result: DeserializeProjectResult }
  | { readonly id: number; readonly kind: 'svg'; readonly result: ParseSvgResult }
  | {
      readonly id: number;
      readonly kind: 'lightburn-project';
      readonly result: LbrnImportResult;
    }
  | {
      readonly id: number;
      readonly kind: 'material-library';
      readonly result: DeserializeMaterialLibraryResult;
    }
  | { readonly id: number; readonly kind: 'lightburn-clb'; readonly result: ClbImportResult }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };
