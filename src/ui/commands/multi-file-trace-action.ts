import type { ColoredPath } from '../../core/scene';
import {
  DEFAULT_TRACE_OPTIONS,
  TRACE_PRESETS,
  traceImagesToSvgFiles,
  type BatchTraceImageJob,
  type BatchTraceSvgFile,
  type RawImageData,
  type TraceOptions,
} from '../../core/trace';
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
export type MultiFileTraceExport = BatchTraceSvgFile & {
  readonly notices?: ReadonlyArray<TraceNotice>;
};

export type MultiFileTraceDeps = {
  // maxEdge is the planned working grid (ADR-409); omitted, the preview cap.
  readonly loadImage?: (file: MultiFileTraceFile, maxEdge?: number) => Promise<RawImageData>;
  readonly readNaturalSize?: (
    file: MultiFileTraceFile,
  ) => Promise<{ readonly width: number; readonly height: number }>;
  readonly trace?: (
    image: RawImageData,
    options: TraceOptions,
  ) => Promise<ReadonlyArray<ColoredPath>>;
  readonly write?: (file: BatchTraceSvgFile) => Promise<boolean> | boolean;
  readonly options?: TraceOptions;
  // The project's machine density; omitted, the default spot's (ADR-409).
  readonly targetPxPerMm?: number;
  readonly deviceMemoryGb?: number;
};

type PushToast = (message: string, variant?: ToastVariant) => void;

const DEFAULT_MULTI_FILE_TRACE_OPTIONS: TraceOptions =
  TRACE_PRESETS['Line Art'] ?? DEFAULT_TRACE_OPTIONS;

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
): Promise<ReadonlyArray<MultiFileTraceExport>> {
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
  const exports = await traceImagesToSvgFiles(jobs, {
    trace: deps.trace ?? traceWithWorkerFallback(notices),
    // As at a dialog commit, the finer grid is an improvement, not a
    // requirement: a file whose finer decode or trace fails is traced on the
    // preview grid instead of aborting the batch. Cancellation still aborts.
    canFallBack: (error) => !isTraceAbort(error) && !isTraceRequestSuperseded(error),
    onFallback: (index) => previewResolution.add(index),
  });
  return exports.map((file, index) => {
    const fileNotices = [
      ...(notices[index] ?? []),
      ...(previewResolution.has(index) ? (['preview-resolution'] as const) : []),
    ];
    return fileNotices.length === 0 ? file : { ...file, notices: fileNotices };
  });
}

// One batch job on the same working-grid policy as a dialog commit (ADR-409):
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
    const svgFiles = await buildMultiFileTraceExports(files, deps);
    if (svgFiles.length === 0) return;
    assertTraceProducedVisiblePaths(svgFiles);
    const write = deps.write ?? missingTraceExportWriter;
    const { written, notices } = await writeTraceExports(svgFiles, write);
    if (written === 0) return;
    const summary = `Traced ${written} ${written === 1 ? 'image' : 'images'} to SVG.`;
    pushToast([summary, ...notices.map(traceNoticeMessage)].join(' '), 'success');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pushToast(`Could not trace images: ${message}`, 'error');
  }
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

export async function writeTraceSvgFileWithPlatform(
  platform: PlatformAdapter,
  file: BatchTraceSvgFile,
): Promise<boolean> {
  const target = await platform.pickFileForSave({
    suggestedName: file.filename,
    extensions: ['.svg'],
  });
  if (target === null) return false;
  await target.write(file.svg);
  return true;
}

function assertTraceProducedVisiblePaths(files: ReadonlyArray<BatchTraceSvgFile>): void {
  const emptyFiles = files.filter((file) => file.pathCount === 0);
  if (emptyFiles.length === 0) return;
  const filenames = emptyFiles.map((file) => file.filename).join(', ');
  throw new Error(
    `Trace produced no visible paths for ${filenames}. Try Trace Image with adjusted threshold or import as Image instead.`,
  );
}

function missingTraceExportWriter(): never {
  throw new Error('Trace export writer is not configured.');
}

function traceWithWorkerFallback(
  notices: ReadonlyArray<TraceNotice>[],
): NonNullable<MultiFileTraceDeps['trace']> {
  // The batch core traces in source order. Keep each result's notices beside
  // its SVG so cancelled saves cannot attach a warning to a different file.
  return async (image, options) => {
    const result = await traceImageWithFallback(image, options);
    notices.push(result.notices ?? []);
    return result.paths;
  };
}
