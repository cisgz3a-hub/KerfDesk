import type { ColoredPath } from '../../core/scene';
import {
  DEFAULT_TRACE_OPTIONS,
  TRACE_PRESETS,
  traceImagesToVectorFiles,
  type BatchTraceFile,
  type BatchTraceImageJob,
  type RawImageData,
  type TraceOptions,
} from '../../core/trace';
import type { BatchTraceJob, BatchTraceOutput, BatchTraceSkip } from '../../core/trace/batch-trace';
import { tracedLayersToDxf } from '../../io/dxf/export-dxf';
import { writeTracedDrawing } from '../../io/vector-formats/traced-drawing';
import type { PlatformAdapter, SaveDirectoryTarget } from '../../platform/types';
import { readImageHeaderDensity, type ImageDensity } from '../common/image-density';
import {
  overriddenSizeMm,
  physicalSizeMm,
  type MultiFileDensitySource,
  type MultiFileTraceSize,
  type SizedFile,
} from './multi-file-trace-size';
import {
  emptyWriteTally,
  reportTraceBatch,
  writtenSoFar,
  type PushToast,
  type WriteTally,
} from './multi-file-trace-report';
import {
  batchRasterAtMaxEdge,
  decodeBatchRasterFile,
  type DecodedBatchRaster,
} from './batch-raster-decode';
import {
  loadImageAsRawData,
  PREVIEW_MAX_EDGE_PX,
  readImageNaturalSize,
  scaleToCap,
} from '../trace/image-loader';
import { withHybridMaxStrokeWidth } from '../trace/hybrid-stroke-width';
import { browserDeviceMemoryGb } from '../trace/trace-commit-at-grid';
import {
  commitGridExceedsPreview,
  planTraceCommitGridFor,
  traceOptionsForCommitGrid,
  traceTargetPxPerMm,
} from '../trace/trace-commit-grid';
import { isTraceAbort } from '../trace/trace-cancellation';
import { isTraceRequestSuperseded, traceImageWithFallback } from '../trace/use-trace-worker-client';
import type { TraceNotice } from '../trace/trace-notices';
import { retrySupersededTrace } from './multi-file-trace-retry';

export type MultiFileTraceFile = File;
export type MultiFileTraceExport = BatchTraceFile & {
  readonly notices?: ReadonlyArray<TraceNotice>;
  // Whether the file's mm size came from the file's embedded density or the
  // default bitmap DPI, so the batch toast can say which files fell back.
  readonly densitySource?: MultiFileDensitySource;
  readonly sourceName?: string;
  /** A multi-page TIFF's page count: only page 1 was traced. */
  readonly pageCount?: number;
};
export type MultiFileTraceBatch = {
  readonly files: ReadonlyArray<MultiFileTraceExport>;
  readonly skipped: ReadonlyArray<BatchTraceSkip>;
};

export type MultiFileTraceDeps = {
  // maxEdge is the planned working grid (ADR-409); omitted, the preview cap.
  readonly loadImage?: (file: MultiFileTraceFile, maxEdge?: number) => Promise<RawImageData>;
  readonly readNaturalSize?: (
    file: MultiFileTraceFile,
  ) => Promise<{ readonly width: number; readonly height: number }>;
  // The file's embedded density (PNG pHYs, JFIF, EXIF, BMP); omitted, parsed
  // as a single-image import parses it, from a bounded header prefix only.
  readonly readDensity?: (file: MultiFileTraceFile) => Promise<ImageDensity | null>;
  // TIFF (page 1) and Netpbm files, decoded here rather than by the browser;
  // null for any other file.
  readonly decodeRaster?: (file: MultiFileTraceFile) => Promise<DecodedBatchRaster | null>;
  readonly trace?: (
    image: RawImageData,
    options: TraceOptions,
    signal?: AbortSignal,
  ) => Promise<ReadonlyArray<ColoredPath>>;
  // Cancels the batch (rank 21): no file is decoded, traced or written after.
  readonly signal?: AbortSignal;
  // Called as each file's turn starts, with its 1-based position.
  readonly onProgress?: (current: number, total: number) => void;
  readonly write?: (file: BatchTraceFile) => Promise<boolean> | boolean;
  /** Trace settings for every image (default: the Line Art preset). */
  readonly options?: TraceOptions;
  // Line + fill's Max stroke width in millimetres, converted to each file's
  // preview grid as the Trace dialog converts it (ADR-454); omitted, the
  // options' own pixel width.
  readonly hybridMaxStrokeWidthMm?: number;
  /** Which settings the batch used ("the Line Art preset"), for its notice. */
  readonly settingsLabel?: string;
  // The project's machine density; omitted, the default spot's (ADR-409).
  readonly targetPxPerMm?: number;
  readonly deviceMemoryGb?: number;
  /** File format, precision and contour grouping. */
  readonly output?: BatchTraceOutput;
  // One DPI or width for every file (the Size row); omitted, each file's
  // import size.
  readonly size?: MultiFileTraceSize;
};

export const DEFAULT_MULTI_FILE_TRACE_PRESET = 'Line Art';
const DEFAULT_MULTI_FILE_TRACE_OPTIONS: TraceOptions =
  TRACE_PRESETS[DEFAULT_MULTI_FILE_TRACE_PRESET] ?? DEFAULT_TRACE_OPTIONS;

type MultiFileJobContext = {
  readonly loadImage: NonNullable<MultiFileTraceDeps['loadImage']>;
  readonly readNatural: NonNullable<MultiFileTraceDeps['readNaturalSize']> | null;
  readonly readDensity: NonNullable<MultiFileTraceDeps['readDensity']>;
  readonly decodeRaster: NonNullable<MultiFileTraceDeps['decodeRaster']>;
  readonly options: TraceOptions;
  readonly hybridMaxStrokeWidthMm: number | undefined;
  readonly targetPxPerMm: number;
  readonly deviceMemoryGb: number | undefined;
  readonly size: MultiFileTraceSize | undefined;
};

// With onExport, each file is handed over as soon as it is traced and the
// batch keeps none of them (the result's files are empty), so a long batch
// holds one export at a time.
export async function buildMultiFileTraceExports(
  files: ReadonlyArray<MultiFileTraceFile>,
  deps: MultiFileTraceDeps = {},
  onExport?: (file: MultiFileTraceExport) => Promise<void>,
): Promise<MultiFileTraceBatch> {
  const signal = deps.signal;
  const context = multiFileJobContext(deps);
  const densitySources: MultiFileDensitySource[] = [];
  const pageCounts: Array<number | undefined> = [];
  const notices: ReadonlyArray<TraceNotice>[] = [];
  const turn = { index: 0 };
  // Rule 7 / ADR-228: this batch used to SILENTLY skip any file over 25 MB
  // (no toast channel here to say so). A size cap is a policy judgement, so
  // every selected file is now traced regardless of size. Each file is read
  // on its turn, so one unreadable file is that file's skip, not the batch's.
  const jobs: BatchTraceJob[] = files.map((file, index) => ({
    sourceName: file.name,
    prepare: async () => {
      turn.index = index;
      deps.onProgress?.(index + 1, files.length);
      const { job, densitySource, pageCount } = await multiFileTraceJob(file, context);
      densitySources[index] = densitySource;
      pageCounts[index] = pageCount;
      return job;
    },
  }));
  const previewResolution = new Set<number>();
  // Cancellation stops the batch; any other failure is spent on the file's
  // own fallback, then on the file itself. A trace superseded by another
  // caller (a Trace Image preview) is retried first, then skipped.
  const recoverable = (error: unknown): boolean =>
    signal?.aborted !== true && !isTraceAbort(error) && !isTraceRequestSuperseded(error);
  const result = await traceImagesToVectorFiles(
    jobs,
    {
      trace: retrySupersededTrace(deps.trace ?? traceWithWorkerFallback(notices, turn), signal),
      ...(signal === undefined ? {} : { signal }),
      ...(onExport === undefined ? {} : { onFile: (file) => onExport(decorate(file)) }),
      writeDxf: tracedLayersToDxf,
      // As at a dialog commit, the finer grid is an improvement, not a
      // requirement: a file whose finer decode or trace fails is traced on the
      // preview grid instead of aborting the batch. Cancellation still aborts.
      canFallBack: recoverable,
      canSkip: recoverable,
      onFallback: (index) => previewResolution.add(index),
      writeDrawing: writeTracedDrawing,
    },
    deps.output ?? {},
  );
  return { skipped: result.skipped, files: result.files.map(decorate) };

  function decorate(file: BatchTraceFile): MultiFileTraceExport {
    // Notices are recorded per traced job, including skipped ones.
    const fileNotices = [
      ...(notices[file.sourceIndex] ?? []),
      ...(previewResolution.has(file.sourceIndex) ? (['preview-resolution'] as const) : []),
    ];
    const pageCount = pageCounts[file.sourceIndex];
    const sized = {
      ...file,
      densitySource: densitySources[file.sourceIndex] ?? 'default',
      sourceName: files[file.sourceIndex]?.name ?? file.filename,
      ...(pageCount === undefined ? {} : { pageCount }),
    };
    return fileNotices.length === 0 ? sized : { ...sized, notices: fileNotices };
  }
}

function multiFileJobContext(deps: MultiFileTraceDeps): MultiFileJobContext {
  const signal = deps.signal;
  return {
    loadImage:
      deps.loadImage ??
      ((file, maxEdge) => loadImageAsRawData(file, maxEdge ?? PREVIEW_MAX_EDGE_PX, signal)),
    readNatural:
      deps.readNaturalSize ?? (deps.loadImage === undefined ? readImageNaturalSize : null),
    readDensity: deps.readDensity ?? readImageHeaderDensity,
    decodeRaster: deps.decodeRaster ?? decodeBatchRasterFile,
    options: deps.options ?? DEFAULT_MULTI_FILE_TRACE_OPTIONS,
    hybridMaxStrokeWidthMm: deps.hybridMaxStrokeWidthMm,
    targetPxPerMm: deps.targetPxPerMm ?? traceTargetPxPerMm(undefined, undefined),
    deviceMemoryGb: deps.deviceMemoryGb ?? browserDeviceMemoryGb(),
    size: deps.size,
  };
}

// One batch job on the same working-grid policy as a dialog commit (ADR-409):
// the placed size is the import size — the file's embedded density when it has
// one, the default bitmap DPI otherwise, exactly as Import Image sizes it — and
// the image is decoded on its turn so the batch holds one large decode at a time.
async function multiFileTraceJob(
  file: MultiFileTraceFile,
  context: MultiFileJobContext,
): Promise<{
  readonly job: BatchTraceImageJob;
  readonly densitySource: MultiFileDensitySource;
  readonly pageCount?: number;
}> {
  const raster = await context.decodeRaster(file);
  if (raster !== null) {
    const natural = { width: raster.width, height: raster.height };
    const { densitySource, ...size } =
      overriddenSizeMm(natural, context.size) ??
      (raster.sizeMm === null
        ? physicalSizeMm(natural, null)
        : { ...raster.sizeMm, densitySource: 'embedded' as const });
    const load: GridLoader = async (maxEdge) => batchRasterAtMaxEdge(raster, maxEdge);
    const jobContext = withFileHybridWidth(context, natural, size.widthMm);
    return {
      job: planMultiFileTraceJob(file.name, natural, size, load, jobContext),
      densitySource,
      ...(raster.pageCount === undefined ? {} : { pageCount: raster.pageCount }),
    };
  }
  const density = await context.readDensity(file);
  if (context.readNatural === null) {
    const image = await context.loadImage(file);
    const { densitySource, ...physicalSize } = fileSizeMm(image, density, context);
    const job = {
      sourceName: file.name,
      image,
      physicalSizeMm: physicalSize,
      options: withFileHybridWidth(context, image, physicalSize.widthMm).options,
    };
    return { job, densitySource };
  }
  const natural = await context.readNatural(file);
  const { densitySource, ...size } = fileSizeMm(natural, density, context);
  const load: GridLoader = (maxEdge) =>
    maxEdge === undefined ? context.loadImage(file) : context.loadImage(file, maxEdge);
  const jobContext = withFileHybridWidth(context, natural, size.widthMm);
  return { job: planMultiFileTraceJob(file.name, natural, size, load, jobContext), densitySource };
}

// The Trace dialog sizes Line + fill's Max stroke width on the preview grid
// of the placed image; each file gets the same conversion for its own size.
function withFileHybridWidth(
  context: MultiFileJobContext,
  natural: { readonly width: number; readonly height: number },
  widthMm: number,
): MultiFileJobContext {
  const width = context.hybridMaxStrokeWidthMm;
  if (width === undefined || !(widthMm > 0)) return context;
  const preview = scaleToCap(natural.width, natural.height, PREVIEW_MAX_EDGE_PX);
  const options = withHybridMaxStrokeWidth(context.options, width, preview.width / widthMm);
  return { ...context, options };
}

// Decodes the file capped to maxEdge; omitted, the preview cap.
type GridLoader = (maxEdge?: number) => Promise<RawImageData>;

function planMultiFileTraceJob(
  sourceName: string,
  natural: { readonly width: number; readonly height: number },
  size: { readonly widthMm: number; readonly heightMm: number },
  load: GridLoader,
  context: MultiFileJobContext,
): BatchTraceImageJob {
  const plan = planTraceCommitGridFor(
    natural,
    {
      outputMm: { width: size.widthMm, height: size.heightMm },
      targetPxPerMm: context.targetPxPerMm,
      deviceMemoryGb: context.deviceMemoryGb,
    },
    context.options,
  );
  const finer = plan !== null && commitGridExceedsPreview(plan) ? plan : null;
  const previewGrid = { image: () => load(), options: context.options };
  if (finer === null) return { sourceName, physicalSizeMm: size, ...previewGrid };
  return {
    sourceName,
    image: () => load(finer.maxEdge),
    physicalSizeMm: size,
    options: traceOptionsForCommitGrid(context.options, finer),
    fallback: previewGrid,
  };
}

function fileSizeMm(
  natural: { readonly width: number; readonly height: number },
  density: ImageDensity | null,
  context: MultiFileJobContext,
): SizedFile {
  return overriddenSizeMm(natural, context.size) ?? physicalSizeMm(natural, density);
}

export async function runMultiFileTrace(
  files: ReadonlyArray<MultiFileTraceFile>,
  pushToast: PushToast,
  deps: MultiFileTraceDeps = {},
): Promise<void> {
  if (files.length === 0) return;
  const write = deps.write ?? missingTraceExportWriter;
  const tally = emptyWriteTally();
  try {
    // Each file is written as soon as it is traced (rank 21).
    const batch = await buildMultiFileTraceExports(files, deps, (file) =>
      writeTraceExport(file, write, tally, deps.signal),
    );
    reportTraceBatch(batch.skipped, tally, pushToast, deps.settingsLabel);
  } catch (err) {
    // The worker answers Cancel with a superseded rejection, not an AbortError.
    if (isTraceAbort(err) || deps.signal?.aborted === true) {
      pushToast(`Multi-File Trace cancelled. ${writtenSoFar(tally.written, files.length)}`, 'info');
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    const kept = tally.written === 0 ? '' : ` ${writtenSoFar(tally.written, files.length)}`;
    pushToast(`Could not trace images: ${message}${kept}`, 'error');
  }
}

async function writeTraceExport(
  file: MultiFileTraceExport,
  write: NonNullable<MultiFileTraceDeps['write']>,
  tally: WriteTally,
  signal: AbortSignal | undefined,
): Promise<void> {
  // After Cancel nothing more is written, even a file already traced.
  signal?.throwIfAborted();
  if (!(await write(file))) return;
  tally.written += 1;
  tally.format = file.format;
  if (file.densitySource === 'default') tally.defaultDensity += 1;
  const name = file.sourceName ?? file.filename;
  if (file.runsPastPage === true) tally.pastPage.push(name);
  if (file.pageCount !== undefined) tally.firstPageOnly.push(`${name} (${file.pageCount} pages)`);
  for (const notice of file.notices ?? []) tally.notices.add(notice);
}

export async function writeTraceFileWithPlatform(
  platform: PlatformAdapter,
  file: BatchTraceFile,
): Promise<boolean> {
  const target = await platform.pickFileForSave({
    suggestedName: file.filename,
    extensions: ['.' + file.format],
  });
  if (target === null) return false;
  await target.write(file.text);
  return true;
}

/** Writes each export into one reserved folder, named <stem>-trace.<ext>.
 * An existing file is never replaced: the export takes the next free
 * <stem>-trace-2.<ext>, -3 and so on. */
export function traceFileWriterForDirectory(
  directory: SaveDirectoryTarget,
): NonNullable<MultiFileTraceDeps['write']> {
  return async (file) => {
    await directory.file(await freeDirectoryName(directory, file.filename)).write(file.text);
    return true;
  };
}

async function freeDirectoryName(
  directory: SaveDirectoryTarget,
  filename: string,
): Promise<string> {
  const exists = directory.exists;
  if (exists === undefined || !(await exists(filename))) return filename;
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : '';
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}-${n}${extension}`;
    if (!(await exists(candidate))) return candidate;
  }
}

function missingTraceExportWriter(): never {
  throw new Error('Trace export writer is not configured.');
}

function traceWithWorkerFallback(
  notices: ReadonlyArray<TraceNotice>[],
  turn: { readonly index: number },
): NonNullable<MultiFileTraceDeps['trace']> {
  // The batch core traces in source order. Keep each result's notices beside
  // its job's index so a cancelled save or a skipped file cannot attach a
  // warning to a different file.
  return async (image, options, signal) => {
    const result = await traceImageWithFallback(image, options, signal);
    notices[turn.index] = result.notices ?? [];
    return result.paths;
  };
}
