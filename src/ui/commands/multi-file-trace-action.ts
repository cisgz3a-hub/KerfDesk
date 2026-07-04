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
import { confirmOversizeImport as defaultConfirmOversizeImport } from '../app/import-size-guard';
import { rasterImportGeometry } from '../common/image-import';
import type { ToastVariant } from '../state/toast-store';
import { loadImageAsRawData, readImageNaturalSize } from '../trace/image-loader';
import { traceImageWithFallback } from '../trace/use-trace-worker-client';

export type MultiFileTraceFile = File;

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
  readonly confirmOversizeImport?: (name: string, sizeBytes: number) => boolean;
};

type PushToast = (message: string, variant?: ToastVariant) => void;

const DEFAULT_MULTI_FILE_TRACE_OPTIONS: TraceOptions =
  TRACE_PRESETS['Line Art'] ?? DEFAULT_TRACE_OPTIONS;

export async function buildMultiFileTraceExports(
  files: ReadonlyArray<MultiFileTraceFile>,
  deps: MultiFileTraceDeps = {},
): Promise<ReadonlyArray<BatchTraceSvgFile>> {
  const loadImage = deps.loadImage ?? loadImageAsRawData;
  const readNatural =
    deps.readNaturalSize ?? (deps.loadImage === undefined ? readImageNaturalSize : null);
  const options = deps.options ?? DEFAULT_MULTI_FILE_TRACE_OPTIONS;
  const confirmOversizeImport = deps.confirmOversizeImport ?? defaultConfirmOversizeImport;
  const jobs = [];
  for (const file of files) {
    if (!confirmOversizeImport(file.name, file.size)) {
      continue;
    }
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
  return traceImagesToSvgFiles(jobs, { trace: deps.trace ?? traceWithWorkerFallback });
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
    let written = 0;
    for (const file of svgFiles) {
      if (await write(file)) written += 1;
    }
    if (written === 0) return;
    pushToast(`Traced ${written} ${written === 1 ? 'image' : 'images'} to SVG.`, 'success');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pushToast(`Could not trace images: ${message}`, 'error');
  }
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

async function traceWithWorkerFallback(
  image: RawImageData,
  options: TraceOptions,
): Promise<ReadonlyArray<ColoredPath>> {
  const result = await traceImageWithFallback(image, options);
  return result.paths;
}
