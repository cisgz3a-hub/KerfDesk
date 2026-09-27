import type { ColoredPath } from '../../core/scene';
import {
  DEFAULT_TRACE_OPTIONS,
  TRACE_PRESETS,
  traceImagesToVectorFiles,
  type BatchTraceFile,
  type BatchTraceImageJob,
  type BatchTraceJob,
  type RawImageData,
  type TraceOptions,
} from '../../core/trace';
import {
  batchTraceFormatLabel,
  type BatchTraceOutput,
  type BatchTraceSkip,
} from '../../core/trace/batch-trace';
import { tracedLayersToDxf } from '../../io/dxf/export-dxf';
import { writeTracedDrawing } from '../../io/vector-formats/traced-drawing';
import type { PlatformAdapter } from '../../platform/types';
import { readImageHeaderDensity, type ImageDensity } from '../common/image-density';
import {
  DEFAULT_DPI,
  rasterImportGeometry,
  type RasterImportGeometry,
} from '../common/image-import';
import type { ToastVariant } from '../state/toast-store';
import {
  batchRasterAtMaxEdge,
  decodeBatchRasterFile,
  type DecodedBatchRaster,
} from './batch-raster-decode';
import { loadImageAsRawData, readImageNaturalSize } from '../trace/image-loader';
import { browserDeviceMemoryGb } from '../trace/trace-commit-at-grid';
import {
  commitGridExceedsPreview,
  planTraceCommitGridFor,
  traceOptionsForCommitGrid,
  traceTargetPxPerMm,
} from '../trace/trace-commit-grid';
import { isTraceAbort } from '../trace/trace-cancellation';
import { isTraceRequestSuperseded, traceImageWithFallback } from '../trace/use-trace-worker-client';
import { traceNoticeMessage, type TraceNotice } from '../trace/trace-notices';

export type MultiFileTraceFile = File;
export type MultiFileTraceExport = BatchTraceFile & {
  readonly notices?: ReadonlyArray<TraceNotice>;
  // Whether the file's mm size came from the file's embedded density or the
  // default bitmap DPI, so the batch toast can say which files fell back.
  readonly densitySource?: RasterImportGeometry['densitySource'];
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
  ) => Promise<ReadonlyArray<ColoredPath>>;
  readonly write?: (file: BatchTraceFile) => Promise<boolean> | boolean;
  /** Trace settings for every image (default: the Line Art preset). */
  readonly options?: TraceOptions;
  // The project's machine density; omitted, the default spot's (ADR-409).
  readonly targetPxPerMm?: number;
  readonly deviceMemoryGb?: number;
  /** File format, precision and contour grouping. */
  readonly output?: BatchTraceOutput;
};

type PushToast = (message: string, variant?: ToastVariant) => void;

export const DEFAULT_MULTI_FILE_TRACE_PRESET = 'Line Art';
const DEFAULT_MULTI_FILE_TRACE_OPTIONS: TraceOptions =
  TRACE_PRESETS[DEFAULT_MULTI_FILE_TRACE_PRESET] ?? DEFAULT_TRACE_OPTIONS;

type MultiFileJobContext = {
  readonly loadImage: NonNullable<MultiFileTraceDeps['loadImage']>;
  readonly readNatural: NonNullable<MultiFileTraceDeps['readNaturalSize']> | null;
  readonly readDensity: NonNullable<MultiFileTraceDeps['readDensity']>;
  readonly decodeRaster: NonNullable<MultiFileTraceDeps['decodeRaster']>;
  readonly options: TraceOptions;
  readonly targetPxPerMm: number;
  readonly deviceMemoryGb: number | undefined;
};

export async function buildMultiFileTraceExports(
  files: ReadonlyArray<MultiFileTraceFile>,
  deps: MultiFileTraceDeps = {},
): Promise<MultiFileTraceBatch> {
  const context: MultiFileJobContext = {
    loadImage: deps.loadImage ?? loadImageAsRawData,
    readNatural:
      deps.readNaturalSize ?? (deps.loadImage === undefined ? readImageNaturalSize : null),
    readDensity: deps.readDensity ?? readImageHeaderDensity,
    decodeRaster: deps.decodeRaster ?? decodeBatchRasterFile,
    options: deps.options ?? DEFAULT_MULTI_FILE_TRACE_OPTIONS,
    targetPxPerMm: deps.targetPxPerMm ?? traceTargetPxPerMm(undefined, undefined),
    deviceMemoryGb: deps.deviceMemoryGb ?? browserDeviceMemoryGb(),
  };
  const densitySources: RasterImportGeometry['densitySource'][] = [];
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
      const { job, densitySource } = await multiFileTraceJob(file, context);
      densitySources[index] = densitySource;
      return job;
    },
  }));
  const previewResolution = new Set<number>();
  // Cancellation and a superseded request stop the batch; any other failure
  // is spent on the file's own fallback, then on the file itself.
  const recoverable = (error: unknown): boolean =>
    !isTraceAbort(error) && !isTraceRequestSuperseded(error);
  const result = await traceImagesToVectorFiles(
    jobs,
    {
      trace: deps.trace ?? traceWithWorkerFallback(notices, turn),
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
  return {
    skipped: result.skipped,
    files: result.files.map((file) => {
      // Notices are recorded per traced job, including skipped ones.
      const fileNotices = [
        ...(notices[file.sourceIndex] ?? []),
        ...(previewResolution.has(file.sourceIndex) ? (['preview-resolution'] as const) : []),
      ];
      const sized = { ...file, densitySource: densitySources[file.sourceIndex] ?? 'default' };
      return fileNotices.length === 0 ? sized : { ...sized, notices: fileNotices };
    }),
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
  readonly densitySource: RasterImportGeometry['densitySource'];
}> {
  const raster = await context.decodeRaster(file);
  if (raster !== null) {
    const natural = { width: raster.width, height: raster.height };
    const { densitySource, ...size } =
      raster.sizeMm === null
        ? physicalSizeMm(natural, null)
        : { ...raster.sizeMm, densitySource: 'embedded' as const };
    const load: GridLoader = async (maxEdge) => batchRasterAtMaxEdge(raster, maxEdge);
    return { job: planMultiFileTraceJob(file.name, natural, size, load, context), densitySource };
  }
  const density = await context.readDensity(file);
  if (context.readNatural === null) {
    const image = await context.loadImage(file);
    const { densitySource, ...physicalSize } = physicalSizeMm(image, density);
    const job = {
      sourceName: file.name,
      image,
      physicalSizeMm: physicalSize,
      options: context.options,
    };
    return { job, densitySource };
  }
  const natural = await context.readNatural(file);
  const { densitySource, ...size } = physicalSizeMm(natural, density);
  const load: GridLoader = (maxEdge) =>
    maxEdge === undefined ? context.loadImage(file) : context.loadImage(file, maxEdge);
  return { job: planMultiFileTraceJob(file.name, natural, size, load, context), densitySource };
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

function physicalSizeMm(
  natural: { readonly width: number; readonly height: number },
  density: ImageDensity | null,
): {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly densitySource: RasterImportGeometry['densitySource'];
} {
  const geometry = rasterImportGeometry({
    naturalWidth: natural.width,
    naturalHeight: natural.height,
    sampledWidth: natural.width,
    sampledHeight: natural.height,
    density,
  });
  return {
    widthMm: geometry.bounds.maxX - geometry.bounds.minX,
    heightMm: geometry.bounds.maxY - geometry.bounds.minY,
    densitySource: geometry.densitySource,
  };
}

export async function runMultiFileTrace(
  files: ReadonlyArray<MultiFileTraceFile>,
  pushToast: PushToast,
  deps: MultiFileTraceDeps = {},
): Promise<void> {
  if (files.length === 0) return;
  try {
    const batch = await buildMultiFileTraceExports(files, deps);
    const write = deps.write ?? missingTraceExportWriter;
    reportTraceBatch(batch, await writeTraceExports(batch.files, write), pushToast);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pushToast(`Could not trace images: ${message}`, 'error');
  }
}

function reportTraceBatch(
  batch: MultiFileTraceBatch,
  written: Awaited<ReturnType<typeof writeTraceExports>>,
  pushToast: PushToast,
): void {
  const skippedText = skippedMessage(batch.skipped);
  if (written.written === 0) {
    if (skippedText !== '')
      pushToast(skippedText, onlyFailures(batch.skipped) ? 'error' : 'warning');
    return;
  }
  const count = written.written;
  const format = batchTraceFormatLabel(batch.files[0]?.format ?? 'svg');
  const summary = `Traced ${count} ${count === 1 ? 'image' : 'images'} to ${format}.`;
  const density = defaultDensityNotice(written.defaultDensity, count);
  pushToast(
    joinToastParts([summary, density, skippedText, ...written.notices.map(traceNoticeMessage)]),
    skippedText === '' ? 'success' : 'warning',
  );
}

function joinToastParts(parts: ReadonlyArray<string | null>): string {
  return parts.filter((part): part is string => part !== null && part !== '').join(' ');
}

function skippedMessage(skipped: ReadonlyArray<BatchTraceSkip>): string {
  const blank = skipped.filter((skip) => skip.reason === 'no-visible-paths');
  const parts = [
    blank.length === 0
      ? ''
      : `Skipped ${imageCount(blank.length)} with no visible paths` +
        ` (${blank.map((skip) => skip.sourceName).join(', ')}); try Trace Image with an adjusted threshold or import as Image instead.`,
    failedMessage('Could not read', skipped, 'decode-failed'),
    failedMessage('Could not trace', skipped, 'trace-failed'),
  ];
  return joinToastParts(parts);
}

// One unreadable or untraceable file is skipped with its own reason, so the
// rest of the batch is still written (rank 19).
function failedMessage(
  verb: string,
  skipped: ReadonlyArray<BatchTraceSkip>,
  reason: BatchTraceSkip['reason'],
): string {
  const failed = skipped.filter((skip) => skip.reason === reason);
  if (failed.length === 0) return '';
  const detail = failed
    .map((skip) =>
      skip.message === undefined ? skip.sourceName : `${skip.sourceName}: ${skip.message}`,
    )
    .join('; ');
  return `${verb} ${imageCount(failed.length)} (${detail}); ${failed.length === 1 ? 'it was' : 'they were'} skipped.`;
}

function onlyFailures(skipped: ReadonlyArray<BatchTraceSkip>): boolean {
  return skipped.length > 0 && skipped.every((skip) => skip.reason !== 'no-visible-paths');
}

function imageCount(count: number): string {
  return `${count} ${count === 1 ? 'image' : 'images'}`;
}

async function writeTraceExports(
  files: ReadonlyArray<MultiFileTraceExport>,
  write: NonNullable<MultiFileTraceDeps['write']>,
): Promise<{
  readonly written: number;
  readonly defaultDensity: number;
  readonly notices: ReadonlyArray<TraceNotice>;
}> {
  let written = 0;
  let defaultDensity = 0;
  const notices = new Set<TraceNotice>();
  for (const file of files) {
    if (!(await write(file))) continue;
    written += 1;
    if (file.densitySource === 'default') defaultDensity += 1;
    for (const notice of file.notices ?? []) notices.add(notice);
  }
  return { written, defaultDensity, notices: [...notices] };
}

// As Import Image's toast says "default 254 DPI — no usable embedded density",
// the batch says which written files were sized at the default, so a file
// that fell back cannot pass for one sized by its own DPI.
function defaultDensityNotice(defaultDensity: number, written: number): string | null {
  if (defaultDensity === 0) return null;
  if (written === 1) return `It had no embedded DPI, so it was sized at ${DEFAULT_DPI} DPI.`;
  const was = defaultDensity === 1 ? 'was' : 'were';
  return `${defaultDensity} of ${written} images had no embedded DPI and ${was} sized at ${DEFAULT_DPI} DPI.`;
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
  return async (image, options) => {
    const result = await traceImageWithFallback(image, options);
    notices[turn.index] = result.notices ?? [];
    return result.paths;
  };
}
