import type { ColoredPath } from '../../core/scene';
import {
  DEFAULT_TRACE_OPTIONS,
  TRACE_PRESETS,
  traceImagesToVectorFiles,
  type BatchTraceFile,
  type BatchTraceImageJob,
  type BatchTraceOutput,
  type BatchTraceSkip,
  type RawImageData,
  type TraceOptions,
} from '../../core/trace';
import { tracedLayersToDxf } from '../../io/dxf/export-dxf';
import type { PlatformAdapter } from '../../platform/types';
import { rasterImportGeometry } from '../common/image-import';
import type { ToastVariant } from '../state/toast-store';
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
};
export type MultiFileTraceBatch = {
  readonly files: ReadonlyArray<MultiFileTraceExport>;
  readonly skipped: ReadonlyArray<BatchTraceSkip>;
};

export type MultiFileTraceDeps = {
  // maxEdge is the planned working grid (ADR-401); omitted, the preview cap.
  readonly loadImage?: (file: MultiFileTraceFile, maxEdge?: number) => Promise<RawImageData>;
  readonly readNaturalSize?: (
    file: MultiFileTraceFile,
  ) => Promise<{ readonly width: number; readonly height: number }>;
  readonly trace?: (
    image: RawImageData,
    options: TraceOptions,
  ) => Promise<ReadonlyArray<ColoredPath>>;
  readonly write?: (file: BatchTraceFile) => Promise<boolean> | boolean;
  /** Trace settings for every image (default: the Line Art preset). */
  readonly options?: TraceOptions;
  // The project's machine density; omitted, the default spot's (ADR-401).
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
    options: deps.options ?? DEFAULT_MULTI_FILE_TRACE_OPTIONS,
    targetPxPerMm: deps.targetPxPerMm ?? traceTargetPxPerMm(undefined, undefined),
    deviceMemoryGb: deps.deviceMemoryGb ?? browserDeviceMemoryGb(),
  };
  const jobs: BatchTraceImageJob[] = [];
  // Rule 7 / ADR-228: this batch used to SILENTLY skip any file over 25 MB
  // (no toast channel here to say so). A size cap is a policy judgement, so
  // every selected file is now traced regardless of size.
  for (const file of files) jobs.push(await multiFileTraceJob(file, context));
  const notices: ReadonlyArray<TraceNotice>[] = [];
  const previewResolution = new Set<number>();
  const result = await traceImagesToVectorFiles(
    jobs,
    {
      trace: deps.trace ?? traceWithWorkerFallback(notices),
      writeDxf: tracedLayersToDxf,
      // As at a dialog commit, the finer grid is an improvement, not a
      // requirement: a file whose finer decode or trace fails is traced on the
      // preview grid instead of aborting the batch. Cancellation still aborts.
      canFallBack: (error) => !isTraceAbort(error) && !isTraceRequestSuperseded(error),
      onFallback: (index) => previewResolution.add(index),
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
      return fileNotices.length === 0 ? file : { ...file, notices: fileNotices };
    }),
  };
}

// One batch job on the same working-grid policy as a dialog commit (ADR-401):
// the placed size is the import size, and the image is decoded on its turn so
// the batch holds one large decode at a time.
async function multiFileTraceJob(
  file: MultiFileTraceFile,
  context: MultiFileJobContext,
): Promise<BatchTraceImageJob> {
  if (context.readNatural === null) {
    const image = await context.loadImage(file);
    return {
      sourceName: file.name,
      image,
      physicalSizeMm: physicalSizeMm(image, image),
      options: context.options,
    };
  }
  const natural = await context.readNatural(file);
  const size = physicalSizeMm(natural, natural);
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
  const previewGrid = { image: () => context.loadImage(file), options: context.options };
  if (finer === null) return { sourceName: file.name, physicalSizeMm: size, ...previewGrid };
  return {
    sourceName: file.name,
    image: () => context.loadImage(file, finer.maxEdge),
    physicalSizeMm: size,
    options: traceOptionsForCommitGrid(context.options, finer),
    fallback: previewGrid,
  };
}

function physicalSizeMm(
  natural: { readonly width: number; readonly height: number },
  sampled: { readonly width: number; readonly height: number },
): { readonly widthMm: number; readonly heightMm: number } {
  const geometry = rasterImportGeometry({
    naturalWidth: natural.width,
    naturalHeight: natural.height,
    sampledWidth: sampled.width,
    sampledHeight: sampled.height,
  });
  return {
    widthMm: geometry.bounds.maxX - geometry.bounds.minX,
    heightMm: geometry.bounds.maxY - geometry.bounds.minY,
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
    const skippedText = skippedMessage(batch.skipped);
    const write = deps.write ?? missingTraceExportWriter;
    const { written, notices } = await writeTraceExports(batch.files, write);
    if (written === 0) {
      if (skippedText !== '') pushToast(skippedText, 'warning');
      return;
    }
    const format = (batch.files[0]?.format ?? 'svg').toUpperCase();
    const summary = `Traced ${written} ${written === 1 ? 'image' : 'images'} to ${format}.`;
    const message = [summary, skippedText, ...notices.map(traceNoticeMessage)]
      .filter((part) => part !== '')
      .join(' ');
    pushToast(message, skippedText === '' ? 'success' : 'warning');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pushToast(`Could not trace images: ${message}`, 'error');
  }
}

function skippedMessage(skipped: ReadonlyArray<BatchTraceSkip>): string {
  if (skipped.length === 0) return '';
  const names = skipped.map((skip) => skip.sourceName).join(', ');
  return (
    `Skipped ${skipped.length} ${skipped.length === 1 ? 'image' : 'images'} with no visible paths` +
    ` (${names}); try Trace Image with an adjusted threshold or import as Image instead.`
  );
}

async function writeTraceExports(
  files: ReadonlyArray<MultiFileTraceExport>,
  write: NonNullable<MultiFileTraceDeps['write']>,
): Promise<{ readonly written: number; readonly notices: ReadonlyArray<TraceNotice> }> {
  let written = 0;
  const notices = new Set<TraceNotice>();
  for (const file of files) {
    if (!(await write(file))) continue;
    written += 1;
    for (const notice of file.notices ?? []) notices.add(notice);
  }
  return { written, notices: [...notices] };
}

export async function writeTraceFileWithPlatform(
  platform: PlatformAdapter,
  file: BatchTraceFile,
): Promise<boolean> {
  const target = await platform.pickFileForSave({
    suggestedName: file.filename,
    extensions: [file.format === 'dxf' ? '.dxf' : '.svg'],
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
): NonNullable<MultiFileTraceDeps['trace']> {
  // The batch core traces in source order. Keep each result's notices beside
  // its job so cancelled saves cannot attach a warning to a different file.
  return async (image, options) => {
    const result = await traceImageWithFallback(image, options);
    notices.push(result.notices ?? []);
    return result.paths;
  };
}
