// Message types for the import worker (Phase 3 of the large-file import plan).
//
// The request carries the Blob ITSELF rather than already-read text or bytes.
// Blob is structured-cloneable by reference — the underlying data is not copied
// into the message — so the worker performs BOTH the read and the parse. That is
// the point of the design: on a 100 MB import the main thread never materializes
// the string at all, where today it holds the whole file plus everything the
// parser derives from it.
//
// SVG is deliberately absent. Its pipeline runs DOMPurify and `new DOMParser()`
// (io/svg/parse-svg.ts), and the WHATWG HTML spec defines DOMParser as
// [Exposed=Window] — there is no DOM in a worker, so SVG cannot be moved here
// without replacing the sanitizer, which is a security surface (ADR-017).

import type { PackedDxfResult } from './packed-dxf-result';
import type { PackedGcodeResult } from './packed-gcode-result';
import type {
  PreparedStlImportResult,
  StlImportPreparationOptions,
} from './stl-import-preparation';

export type ImportWorkerRequest =
  | {
      readonly id: number;
      readonly kind: 'dxf';
      readonly blob: Blob;
      readonly objectId: string;
      readonly source: string;
    }
  | { readonly id: number; readonly kind: 'gcode'; readonly blob: Blob }
  | {
      readonly id: number;
      readonly kind: 'stl';
      readonly blob: Blob;
      readonly options: StlImportPreparationOptions;
    };

export type ImportWorkerResponse =
  | {
      readonly id: number;
      readonly kind: 'progress';
      readonly phase: 'reading' | 'parsing' | 'preparing';
      readonly bytesRead?: number;
      readonly totalBytes?: number;
    }
  | { readonly id: number; readonly kind: 'dxf'; readonly result: PackedDxfResult }
  | { readonly id: number; readonly kind: 'gcode'; readonly result: PackedGcodeResult }
  | { readonly id: number; readonly kind: 'stl'; readonly result: PreparedStlImportResult }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };
