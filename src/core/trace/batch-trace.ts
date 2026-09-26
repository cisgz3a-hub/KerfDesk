import type { ColoredPath } from '../scene';
import { coloredPathsToSvg, countVisibleColoredPaths } from './paths-to-svg';
import { traceImageToColoredPaths } from './trace-to-paths';
import { DEFAULT_TRACE_OPTIONS, type RawImageData, type TraceOptions } from './trace-image';

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
  // Whether a failed attempt may use the job's fallback; omitted, every error.
  readonly canFallBack?: (error: unknown) => boolean;
  // Called with the job's index before its fallback runs.
  readonly onFallback?: (jobIndex: number, error: unknown) => void;
};

type TracedAttempt = {
  readonly image: RawImageData;
  readonly options: TraceOptions;
  readonly paths: ReadonlyArray<ColoredPath>;
};

const FORBIDDEN_FILENAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

export async function traceImagesToSvgFiles(
  jobs: ReadonlyArray<BatchTraceImageJob>,
  deps: BatchTraceDependencies = {},
): Promise<ReadonlyArray<BatchTraceSvgFile>> {
  const trace = deps.trace ?? traceImageToColoredPaths;
  const seenNames = new Map<string, number>();
  const files: BatchTraceSvgFile[] = [];
  for (const [index, job] of jobs.entries()) {
    const { image, options, paths } = await traceJob(job, index, trace, deps);
    const stem = uniqueStem(safeSourceStem(job.sourceName), seenNames);
    files.push({
      filename: `${stem}-trace.svg`,
      svg: coloredPathsToSvg(
        paths,
        image.width,
        image.height,
        job.physicalSizeMm,
        options.traceMode,
      ),
      pathCount: countVisibleColoredPaths(paths, options.traceMode),
    });
  }
  return files;
}

async function traceJob(
  job: BatchTraceImageJob,
  index: number,
  trace: NonNullable<BatchTraceDependencies['trace']>,
  deps: BatchTraceDependencies,
): Promise<TracedAttempt> {
  try {
    return await traceAttempt(job, trace);
  } catch (error) {
    const fallback = job.fallback;
    if (fallback === undefined || deps.canFallBack?.(error) === false) throw error;
    deps.onFallback?.(index, error);
    return traceAttempt(fallback, trace);
  }
}

async function traceAttempt(
  attempt: BatchTraceAttempt,
  trace: NonNullable<BatchTraceDependencies['trace']>,
): Promise<TracedAttempt> {
  const options = attempt.options ?? DEFAULT_TRACE_OPTIONS;
  const image = typeof attempt.image === 'function' ? await attempt.image() : attempt.image;
  return { image, options, paths: await trace(image, options) };
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
