import type { ColoredPath } from '../../core/scene';
import {
  DEFAULT_TRACE_OPTIONS,
  traceImagesToSvgFiles,
  type BatchTraceSvgFile,
  type RawImageData,
  type TraceOptions,
} from '../../core/trace';
import type { ToastVariant } from '../state/toast-store';
import { loadImageAsRawData } from '../trace/image-loader';
import { traceImageWithFallback } from '../trace/use-trace-worker-client';

export type MultiFileTraceFile = File;

export type MultiFileTraceDeps = {
  readonly loadImage?: (file: MultiFileTraceFile) => Promise<RawImageData>;
  readonly trace?: (
    image: RawImageData,
    options: TraceOptions,
  ) => Promise<ReadonlyArray<ColoredPath>>;
  readonly download?: (file: BatchTraceSvgFile) => void;
  readonly options?: TraceOptions;
};

type PushToast = (message: string, variant?: ToastVariant) => void;

export async function buildMultiFileTraceExports(
  files: ReadonlyArray<MultiFileTraceFile>,
  deps: MultiFileTraceDeps = {},
): Promise<ReadonlyArray<BatchTraceSvgFile>> {
  const loadImage = deps.loadImage ?? loadImageAsRawData;
  const options = deps.options ?? DEFAULT_TRACE_OPTIONS;
  const jobs = [];
  for (const file of files) {
    jobs.push({
      sourceName: file.name,
      image: await loadImage(file),
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
    const download = deps.download ?? downloadTraceSvgFile;
    for (const file of svgFiles) {
      download(file);
    }
    pushToast(`Traced ${svgFiles.length} ${svgFiles.length === 1 ? 'image' : 'images'} to SVG.`, 'success');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pushToast(`Could not trace images: ${message}`, 'error');
  }
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
