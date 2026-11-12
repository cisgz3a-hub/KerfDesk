// Message types for the import worker (Phase 3 of the large-file import plan).
//
// The request carries the Blob ITSELF rather than already-read text or bytes.
// Blob is structured-cloneable, so the worker performs BOTH the read and the
// parse. Whether a browser shares or copies the Blob's backing storage is an
// implementation detail; the design guarantee is that KerfDesk does not first
// materialize the file as a main-thread string or byte array.
//
// SVG is deliberately absent. Its pipeline runs DOMPurify and `new DOMParser()`
// (io/svg/parse-svg.ts), and the WHATWG HTML spec defines DOMParser as
// [Exposed=Window] — there is no DOM in a worker, so SVG cannot be moved here
// without replacing the sanitizer, which is a security surface (ADR-017).

import type { PackedDxfResult } from './packed-dxf-result';
import type { PackedGcodeResult } from './packed-gcode-result';
import type { GcodeInspectionContext } from '../gcode-inspector/gcode-inspection-source';
import type { PackedHpglResult } from './packed-hpgl-result';
import type { PreparedPsdImport } from './psd-import-preparation';
import type {
  PreparedStlImportResult,
  StlImportPreparationOptions,
} from './stl-import-preparation';
import type {
  PreparedDepthMapImportResult,
  PreparedReliefHeightfieldImportResult,
} from './depth-map-import-preparation';
import type { BatchRasterFormat, DecodedBatchRaster } from './batch-raster-pixels';
import type { PostscriptConversion } from '../../io/postscript';

/** RGBA pixels with their own transferable buffer. */
export type ImportWorkerRgba = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray<ArrayBuffer>;
};

export type ImportWorkerRequest =
  // Multi-File Trace's TIFF and Netpbm decode, and its resample to a working
  // grid, run here so a large scan does not freeze the window (ADR-357 Amendment 2).
  | {
      readonly id: number;
      readonly kind: 'batch-raster';
      readonly blob: Blob;
      readonly format: BatchRasterFormat;
    }
  | {
      readonly id: number;
      readonly kind: 'resample-rgba';
      readonly image: ImportWorkerRgba;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly id: number;
      readonly kind: 'dxf';
      readonly blob: Blob;
      readonly objectId: string;
      readonly source: string;
    }
  | {
      readonly id: number;
      readonly kind: 'hpgl';
      readonly blob: Blob;
      readonly objectId: string;
      readonly source: string;
    }
  // EPS, PostScript and Illustrator 3–8 to SVG text (ADR-700 Amendment 3).
  | { readonly id: number; readonly kind: 'postscript'; readonly blob: Blob }
  | {
      readonly id: number;
      readonly kind: 'gcode';
      readonly blob: Blob;
      readonly timingContext?: GcodeInspectionContext;
    }
  | { readonly id: number; readonly kind: 'depth-map-png'; readonly blob: Blob }
  | { readonly id: number; readonly kind: 'psd'; readonly blob: Blob }
  | {
      readonly id: number;
      readonly kind: 'relief-heightfield-png';
      readonly blob: Blob;
      readonly sourceName: string;
      readonly physicalWidthMm: number;
      readonly maxDepthMm: number;
    }
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
  | { readonly id: number; readonly kind: 'batch-raster'; readonly result: DecodedBatchRaster }
  | { readonly id: number; readonly kind: 'resample-rgba'; readonly result: ImportWorkerRgba }
  | { readonly id: number; readonly kind: 'dxf'; readonly result: PackedDxfResult }
  | { readonly id: number; readonly kind: 'hpgl'; readonly result: PackedHpglResult }
  | { readonly id: number; readonly kind: 'postscript'; readonly result: PostscriptConversion }
  | { readonly id: number; readonly kind: 'gcode'; readonly result: PackedGcodeResult }
  | { readonly id: number; readonly kind: 'stl'; readonly result: PreparedStlImportResult }
  | { readonly id: number; readonly kind: 'psd'; readonly result: PreparedPsdImport }
  | {
      readonly id: number;
      readonly kind: 'depth-map-png';
      readonly result: PreparedDepthMapImportResult;
    }
  | {
      readonly id: number;
      readonly kind: 'relief-heightfield-png';
      readonly result: PreparedReliefHeightfieldImportResult;
    }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };
