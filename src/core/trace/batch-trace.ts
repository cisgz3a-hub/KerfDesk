import type { ColoredPath } from '../scene';
import {
  tracedLayers,
  tracedLayersToSvg,
  type TracedLayer,
  type TracedSvgPage,
  type TracedVectorOptions,
} from './batch-trace-svg';
import { placeTracedLayers, type TracedPageLayout } from './traced-page-box';
import { traceImageToColoredPaths } from './trace-to-paths';
import { DEFAULT_TRACE_OPTIONS, type RawImageData, type TraceOptions } from './trace-image';
import { isLineTraceMode } from './trace-paint';

export type BatchTracePhysicalSize = {
  readonly widthMm: number;
  readonly heightMm: number;
};

// A decoded image, or a loader called on the job's turn so a batch of large
// images holds one decoded image at a time (ADR-409).
export type BatchTraceImageSource = RawImageData | (() => Promise<RawImageData>);

export type BatchTraceImageJob = {
  readonly sourceName: string;
  readonly image: BatchTraceImageSource;
  readonly physicalSizeMm?: BatchTracePhysicalSize;
  readonly options?: TraceOptions;
  // A cheaper attempt, tried when this job's decode or trace fails and the
  // caller's canFallBack accepts the error (ADR-409).
  readonly fallback?: BatchTraceAttempt;
};

export type BatchTraceAttempt = {
  readonly image: BatchTraceImageSource;
  readonly options?: TraceOptions;
};

export type BatchTraceFormat = 'svg' | 'dxf' | 'pdf' | 'eps' | 'geojson';

/** Formats written by the io-layer vector writer (ADR-468). */
export type BatchTraceDrawingFormat = 'pdf' | 'eps' | 'geojson';

/** Human label for a batch format ("GeoJSON", "PDF"). */
export function batchTraceFormatLabel(format: BatchTraceFormat): string {
  return format === 'geojson' ? 'GeoJSON' : format.toUpperCase();
}

export type BatchTraceFile = {
  readonly filename: string;
  readonly format: BatchTraceFormat;
  readonly text: string;
  /** Visible colour groups written to the file. */
  readonly pathCount: number;
  /** Position of the source job in the batch. */
  readonly sourceIndex: number;
};

// Why a file wrote nothing: its trace had no visible geometry, or it could
// not be decoded or traced and the caller chose to skip it (canSkip) rather
// than fail the batch.
export type BatchTraceSkipReason = 'no-visible-paths' | 'decode-failed' | 'trace-failed';

export type BatchTraceSkip = {
  readonly sourceName: string;
  readonly reason: BatchTraceSkipReason;
  /** The failure's message, for decode-failed and trace-failed skips. */
  readonly message?: string;
};

// A job whose size and decode plan are only known once its file is read. The
// batch prepares it on its turn; a prepare failure is a decode failure.
export type BatchTracePreparedJob = {
  readonly sourceName: string;
  readonly prepare: () => Promise<BatchTraceImageJob>;
};

export type BatchTraceJob = BatchTraceImageJob | BatchTracePreparedJob;

export type BatchTraceResult = {
  readonly files: ReadonlyArray<BatchTraceFile>;
  readonly skipped: ReadonlyArray<BatchTraceSkip>;
};

export type BatchTraceOutput = TracedVectorOptions & {
  readonly format?: BatchTraceFormat;
  /** Page: the source image (default) or the artwork plus a margin (ADR-451). */
  readonly page?: TracedPageLayout;
};

export type BatchTraceDependencies = {
  readonly trace?: (
    image: RawImageData,
    options: TraceOptions,
    signal?: AbortSignal,
  ) => Promise<ReadonlyArray<ColoredPath>>;
  // Cancels the batch: checked before each file and passed to every trace.
  readonly signal?: AbortSignal;
  // Receives each file as soon as it is serialized. The batch then keeps no
  // file text itself, so at most one export is held at a time; the result's
  // files list is empty.
  readonly onFile?: (file: BatchTraceFile) => Promise<void>;
  // Whether a failed attempt may use the job's fallback; omitted, every error.
  readonly canFallBack?: (error: unknown) => boolean;
  // Called with the job's index before its fallback runs.
  readonly onFallback?: (jobIndex: number, error: unknown) => void;
  // Whether a job whose decode or trace failed (after its fallback) becomes a
  // skip instead of failing the batch; omitted, every failure is rethrown.
  readonly canSkip?: (error: unknown) => boolean;
  /**
   * DXF serializer (io layer). Receives visible layers in page units
   * (millimetres when the physical size is known; Y down) and the page
   * height in the same units. Required only when `format` is 'dxf'.
   */
  readonly writeDxf?: (
    layers: ReadonlyArray<TracedLayer>,
    options: TracedVectorOptions & { readonly pageHeight: number },
  ) => string;
  /**
   * PDF / EPS / GeoJSON serializer (io layer, ADR-468). Receives visible
   * layers in page units (Y down), the page size, and whether every contour
   * is a stroke (Centerline or Edge). Per-path Hybrid roles remain on the
   * layers. Required only for those formats.
   */
  readonly writeDrawing?: (
    format: BatchTraceDrawingFormat,
    layers: ReadonlyArray<TracedLayer>,
    options: TracedVectorOptions & {
      readonly pageWidth: number;
      readonly pageHeight: number;
      readonly strokeOnly: boolean;
    },
  ) => string;
};

type TracedAttempt = {
  readonly image: RawImageData;
  readonly options: TraceOptions;
  readonly paths: ReadonlyArray<ColoredPath>;
};

type JobStage = { current: 'decode' | 'trace' };

type JobOutcome =
  | { readonly kind: 'traced'; readonly job: BatchTraceImageJob; readonly attempt: TracedAttempt }
  | { readonly kind: 'failed'; readonly skip: BatchTraceSkip };

const FORBIDDEN_FILENAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

/**
 * Trace each image to its own vector file. An image whose trace has no
 * visible geometry is reported in `skipped` and writes nothing; the rest of
 * the batch still completes.
 */
export async function traceImagesToVectorFiles(
  jobs: ReadonlyArray<BatchTraceJob>,
  deps: BatchTraceDependencies = {},
  output: BatchTraceOutput = {},
): Promise<BatchTraceResult> {
  const trace = deps.trace ?? ((image, options) => traceImageToColoredPaths(image, options));
  const format = output.format ?? 'svg';
  const seenNames = new Map<string, number>();
  const files: BatchTraceFile[] = [];
  const skipped: BatchTraceSkip[] = [];
  for (const [sourceIndex, source] of jobs.entries()) {
    deps.signal?.throwIfAborted();
    const outcome = await runJob(source, sourceIndex, trace, deps);
    if (outcome.kind === 'failed') {
      skipped.push(outcome.skip);
      continue;
    }
    const { job } = outcome;
    const { image, options, paths } = outcome.attempt;
    const imagePage = tracedPage(image, job.physicalSizeMm);
    const traced = tracedLayers(paths, imagePage, options.traceMode);
    if (traced.length === 0) {
      skipped.push({ sourceName: job.sourceName, reason: 'no-visible-paths' });
      continue;
    }
    const { layers, page } = placeTracedLayers(
      traced,
      imagePage,
      options.traceMode,
      output.page,
      output.precisionMm,
    );
    const stem = uniqueStem(safeSourceStem(job.sourceName), seenNames);
    const file: BatchTraceFile = {
      filename: `${stem}-trace.${format}`,
      format,
      text: tracedFileText(format, layers, page, options.traceMode, deps, output),
      pathCount: layers.length,
      sourceIndex,
    };
    if (deps.onFile === undefined) files.push(file);
    else await deps.onFile(file);
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
  return page.size?.height ?? page.physicalSizeMm?.heightMm ?? page.pixelHeight;
}

function tracedFileText(
  format: BatchTraceFormat,
  layers: ReadonlyArray<TracedLayer>,
  page: TracedSvgPage,
  traceMode: TraceOptions['traceMode'],
  deps: BatchTraceDependencies,
  output: BatchTraceOutput,
): string {
  if (format === 'svg') return tracedLayersToSvg(layers, page, traceMode, output);
  if (format === 'dxf')
    return requireDxfWriter(deps)(layers, { ...output, pageHeight: pageHeight(page) });
  if (deps.writeDrawing === undefined) {
    throw new Error(batchTraceFormatLabel(format) + ' output is not available here.');
  }
  return deps.writeDrawing(format, layers, {
    ...output,
    pageWidth: page.size?.width ?? page.physicalSizeMm?.widthMm ?? page.pixelWidth,
    pageHeight: pageHeight(page),
    strokeOnly: isLineTraceMode(traceMode),
  });
}

function requireDxfWriter(
  deps: BatchTraceDependencies,
): NonNullable<BatchTraceDependencies['writeDxf']> {
  if (deps.writeDxf === undefined) throw new Error('DXF output is not available here.');
  return deps.writeDxf;
}

// One file's turn: prepare, decode and trace it. A failure the caller may
// skip (canSkip) is reported as that file's skip; anything else — a
// cancellation, a superseded request — still fails the whole batch.
async function runJob(
  source: BatchTraceJob,
  index: number,
  trace: NonNullable<BatchTraceDependencies['trace']>,
  deps: BatchTraceDependencies,
): Promise<JobOutcome> {
  const stage: JobStage = { current: 'decode' };
  try {
    const job = 'prepare' in source ? await source.prepare() : source;
    return { kind: 'traced', job, attempt: await traceJob(job, index, trace, deps, stage) };
  } catch (error) {
    if (deps.canSkip?.(error) !== true) throw error;
    const reason = stage.current === 'decode' ? 'decode-failed' : 'trace-failed';
    return {
      kind: 'failed',
      skip: { sourceName: source.sourceName, reason, message: errorText(error) },
    };
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function traceJob(
  job: BatchTraceImageJob,
  index: number,
  trace: NonNullable<BatchTraceDependencies['trace']>,
  deps: BatchTraceDependencies,
  stage: JobStage,
): Promise<TracedAttempt> {
  try {
    return await traceAttempt(job, trace, stage, deps.signal);
  } catch (error) {
    const fallback = job.fallback;
    if (fallback === undefined || deps.canFallBack?.(error) === false) throw error;
    deps.onFallback?.(index, error);
    return traceAttempt(fallback, trace, stage, deps.signal);
  }
}

async function traceAttempt(
  attempt: BatchTraceAttempt,
  trace: NonNullable<BatchTraceDependencies['trace']>,
  stage: JobStage,
  signal: AbortSignal | undefined,
): Promise<TracedAttempt> {
  const options = attempt.options ?? DEFAULT_TRACE_OPTIONS;
  stage.current = 'decode';
  const image = typeof attempt.image === 'function' ? await attempt.image() : attempt.image;
  stage.current = 'trace';
  const paths = await (signal === undefined
    ? trace(image, options)
    : trace(image, options, signal));
  return { image, options, paths };
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
