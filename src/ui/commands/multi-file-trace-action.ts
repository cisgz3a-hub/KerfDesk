import type { ColoredPath } from '../../core/scene';
import {
  DEFAULT_TRACE_OPTIONS,
  TRACE_PRESETS,
  traceImagesToSvgFiles,
  type BatchTraceSvgFile,
  type RawImageData,
  type TraceOptions,
} from '../../core/trace';
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
  readonly download?: (file: BatchTraceSvgFile) => void;
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
    const download = deps.download ?? downloadTraceSvgFile;
    for (const file of svgFiles) {
      download(file);
    }
    pushToast(
      `Traced ${svgFiles.length} ${svgFiles.length === 1 ? 'image' : 'images'} to SVG.`,
      'success',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pushToast(`Could not trace images: ${message}`, 'error');
  }
}

function assertTraceProducedVisiblePaths(files: ReadonlyArray<BatchTraceSvgFile>): void {
  const emptyFiles = files.filter((file) => file.pathCount === 0);
  if (emptyFiles.length === 0) return;
  const filenames = emptyFiles.map((file) => file.filename).join(', ');
  throw new Error(
    `Trace produced no visible paths for ${filenames}. Try Trace Image with adjusted threshold or import as Image instead.`,
  );
}

export function downloadTraceSvgFile(file: BatchTraceSvgFile): void {
  const blob = new Blob([file.svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = file.filename;
    link.style.display = 'none';
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function traceWithWorkerFallback(
  image: RawImageData,
  options: TraceOptions,
): Promise<ReadonlyArray<ColoredPath>> {
  const result = await traceImageWithFallback(image, options);
  return result.paths;
}
