import type { ColoredPath } from '../scene';
import { coloredPathsToSvg } from './paths-to-svg';
import { traceImageToColoredPaths } from './trace-to-paths';
import { DEFAULT_TRACE_OPTIONS, type RawImageData, type TraceOptions } from './trace-image';

export type BatchTraceImageJob = {
  readonly sourceName: string;
  readonly image: RawImageData;
  readonly options?: TraceOptions;
};

export type BatchTraceSvgFile = {
  readonly filename: string;
  readonly svg: string;
  readonly pathCount: number;
};

export type BatchTraceDependencies = {
  readonly trace?: (
    image: RawImageData,
    options: TraceOptions,
  ) => Promise<ReadonlyArray<ColoredPath>>;
};

const FORBIDDEN_FILENAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

export async function traceImagesToSvgFiles(
  jobs: ReadonlyArray<BatchTraceImageJob>,
  deps: BatchTraceDependencies = {},
): Promise<ReadonlyArray<BatchTraceSvgFile>> {
  const trace = deps.trace ?? traceImageToColoredPaths;
  const seenNames = new Map<string, number>();
  const files: BatchTraceSvgFile[] = [];
  for (const job of jobs) {
    const options = job.options ?? DEFAULT_TRACE_OPTIONS;
    const paths = await trace(job.image, options);
    const stem = uniqueStem(safeSourceStem(job.sourceName), seenNames);
    files.push({
      filename: `${stem}-trace.svg`,
      svg: coloredPathsToSvg(paths, job.image.width, job.image.height),
      pathCount: paths.length,
    });
  }
  return files;
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
