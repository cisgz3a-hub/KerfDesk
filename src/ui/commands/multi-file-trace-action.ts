import type { ColoredPath } from '../../core/scene';
import {
  DEFAULT_TRACE_OPTIONS,
  TRACE_PRESETS,
  traceImagesToSvgFiles,
  type BatchTraceSvgFile,
  type RawImageData,
  type TraceOptions,
} from '../../core/trace';
import type { PlatformAdapter } from '../../platform/types';
import { rasterImportGeometry } from '../common/image-import';
import type { ToastVariant } from '../state/toast-store';
import { loadImageAsRawData, readImageNaturalSize } from '../trace/image-loader';
import { traceImageWithFallback } from '../trace/use-trace-worker-client';
import { traceNoticeMessage, type TraceNotice } from '../trace/trace-notices';

export type MultiFileTraceFile = File;
export type MultiFileTraceExport = BatchTraceSvgFile & {
  readonly notices?: ReadonlyArray<TraceNotice>;
};

export type MultiFileTraceDeps = {
  readonly loadImage?: (file: MultiFileTraceFile) => Promise<RawImageData>;
  readonly readNaturalSize?: (
    file: MultiFileTraceFile,
  ) => Promise<{ readonly width: number; readonly height: number }>;
  readonly trace?: (
    image: RawImageData,
    options: TraceOptions,
  ) => Promise<ReadonlyArray<ColoredPath>>;
  readonly write?: (file: BatchTraceSvgFile) => Promise<boolean> | boolean;
  readonly options?: TraceOptions;
};

type PushToast = (message: string, variant?: ToastVariant) => void;

const DEFAULT_MULTI_FILE_TRACE_OPTIONS: TraceOptions =
  TRACE_PRESETS['Line Art'] ?? DEFAULT_TRACE_OPTIONS;

export async function buildMultiFileTraceExports(
  files: ReadonlyArray<MultiFileTraceFile>,
  deps: MultiFileTraceDeps = {},
): Promise<ReadonlyArray<MultiFileTraceExport>> {
  const loadImage = deps.loadImage ?? loadImageAsRawData;
  const readNatural =
    deps.readNaturalSize ?? (deps.loadImage === undefined ? readImageNaturalSize : null);
  const options = deps.options ?? DEFAULT_MULTI_FILE_TRACE_OPTIONS;
  const jobs = [];
  for (const file of files) {
    // Rule 7 / ADR-228: this batch used to SILENTLY skip any file over 25 MB
    // (no toast channel here to say so). A size cap is a policy judgement, so
    // every selected file is now traced regardless of size.
    const image = await loadImage(file);
    const natural =
      readNatural === null ? { width: image.width, height: image.height } : await readNatural(file);
    const geometry = rasterImportGeometry({
      naturalWidth: natural.width,
      naturalHeight: natural.height,
      sampledWidth: image.width,
      sampledHeight: image.height,
    });
    jobs.push({
      sourceName: file.name,
      image,
      physicalSizeMm: {
        widthMm: geometry.bounds.maxX - geometry.bounds.minX,
        heightMm: geometry.bounds.maxY - geometry.bounds.minY,
      },
      options,
    });
  }
  const notices: ReadonlyArray<TraceNotice>[] = [];
  const exports = await traceImagesToSvgFiles(jobs, {
    trace: deps.trace ?? traceWithWorkerFallback(notices),
  });
  return exports.map((file, index) => {
    const fileNotices = notices[index];
    return fileNotices === undefined || fileNotices.length === 0
      ? file
      : { ...file, notices: fileNotices };
  });
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
