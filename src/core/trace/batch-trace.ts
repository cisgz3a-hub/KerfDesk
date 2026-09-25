import type { ColoredPath } from '../scene';
import {
  tracedLayers,
  tracedLayersToSvg,
  type TracedLayer,
  type TracedSvgPage,
  type TracedVectorOptions,
} from './batch-trace-svg';
import { traceImageToColoredPaths } from './trace-to-paths';
import { DEFAULT_TRACE_OPTIONS, type RawImageData, type TraceOptions } from './trace-image';

export type BatchTracePhysicalSize = {
  readonly widthMm: number;
  readonly heightMm: number;
};

export type BatchTraceImageJob = {
  readonly sourceName: string;
  // A decoded image, or a loader called on this job's turn so a batch of large
  // images holds one decoded image at a time (ADR-403).
  readonly image: RawImageData | (() => Promise<RawImageData>);
  readonly physicalSizeMm?: BatchTracePhysicalSize;
  readonly options?: TraceOptions;
};

export type BatchTraceFormat = 'svg' | 'dxf';

export type BatchTraceFile = {
  readonly filename: string;
  readonly format: BatchTraceFormat;
  readonly text: string;
  /** Visible colour groups written to the file. */
  readonly pathCount: number;
  /** Position of the source job in the batch. */
  readonly sourceIndex: number;
};

export type BatchTraceSkip = {
  readonly sourceName: string;
  readonly reason: 'no-visible-paths';
};

export type BatchTraceResult = {
  readonly files: ReadonlyArray<BatchTraceFile>;
  readonly skipped: ReadonlyArray<BatchTraceSkip>;
};

export type BatchTraceOutput = TracedVectorOptions & {
  readonly format?: BatchTraceFormat;
};

export type BatchTraceDependencies = {
  readonly trace?: (
    image: RawImageData,
    options: TraceOptions,
  ) => Promise<ReadonlyArray<ColoredPath>>;
  /**
   * DXF serializer (io layer). Receives visible layers in page units
   * (millimetres when the physical size is known; Y down) and the page
   * height in the same units. Required only when `format` is 'dxf'.
   */
  readonly writeDxf?: (
    layers: ReadonlyArray<TracedLayer>,
    options: TracedVectorOptions & { readonly pageHeight: number },
  ) => string;
};

const FORBIDDEN_FILENAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

/**
 * Trace each image to its own vector file. An image whose trace has no
 * visible geometry is reported in `skipped` and writes nothing; the rest of
 * the batch still completes.
 */
export async function traceImagesToVectorFiles(
  jobs: ReadonlyArray<BatchTraceImageJob>,
  deps: BatchTraceDependencies = {},
  output: BatchTraceOutput = {},
): Promise<BatchTraceResult> {
  const trace = deps.trace ?? traceImageToColoredPaths;
  const format = output.format ?? 'svg';
  const seenNames = new Map<string, number>();
  const files: BatchTraceFile[] = [];
  const skipped: BatchTraceSkip[] = [];
  for (const [sourceIndex, job] of jobs.entries()) {
    const options = job.options ?? DEFAULT_TRACE_OPTIONS;
    const image = typeof job.image === 'function' ? await job.image() : job.image;
    const page = tracedPage(image, job.physicalSizeMm);
    const layers = tracedLayers(await trace(image, options), page, options.traceMode);
    if (layers.length === 0) {
      skipped.push({ sourceName: job.sourceName, reason: 'no-visible-paths' });
      continue;
    }
    const stem = uniqueStem(safeSourceStem(job.sourceName), seenNames);
    files.push({
      filename: `${stem}-trace.${format}`,
      format,
      text:
        format === 'dxf'
          ? requireDxfWriter(deps)(layers, { ...output, pageHeight: pageHeight(page) })
          : tracedLayersToSvg(layers, page, options.traceMode, output),
      pathCount: layers.length,
      sourceIndex,
    });
  }
  return { files, skipped };
}

function tracedPage(
  image: RawImageData,
  physicalSizeMm: BatchTracePhysicalSize | undefined,
): TracedSvgPage {
  return {
    pixelWidth: image.width,
    pixelHeight: image.height,
    ...(physicalSizeMm === undefined ? {} : { physicalSizeMm }),
  };
}

/** Page height in the layers' units: millimetres when known, else pixels. */
function pageHeight(page: TracedSvgPage): number {
  return page.physicalSizeMm?.heightMm ?? page.pixelHeight;
}

function requireDxfWriter(
  deps: BatchTraceDependencies,
): NonNullable<BatchTraceDependencies['writeDxf']> {
  if (deps.writeDxf === undefined) throw new Error('DXF output is not available here.');
  return deps.writeDxf;
}

function uniqueStem(stem: string, seen: Map<string, number>): string {
  const count = seen.get(stem) ?? 0;
  seen.set(stem, count + 1);
  return count === 0 ? stem : `${stem}-${count + 1}`;
}

function safeSourceStem(sourceName: string): string {
  const filename = sourceName.split(/[/\\]/).pop() ?? sourceName;
  const withoutExtension = filename.replace(/\.[^.]*$/, '');
  const sanitized = sanitizeFilenameStem(withoutExtension).trim();
  return sanitized === '' ? 'trace' : sanitized;
}

function sanitizeFilenameStem(stem: string): string {
  let out = '';
  for (const char of stem) {
    out += isSafeFilenameChar(char) ? char : '-';
  }
  return out;
}

function isSafeFilenameChar(char: string): boolean {
  if (char.charCodeAt(0) < 32) return false;
  return !FORBIDDEN_FILENAME_CHARS.has(char);
}
