import { IDENTITY_TRANSFORM, type Project, type TracedImage } from '../../../core/scene';
import type { TraceOptions } from '../../../core/trace';
import { readImageDensity, type ImageDensity } from '../../common/image-density';
import { rasterImportGeometry } from '../../common/image-import';
import { fairTracedPathsForCnc } from '../../trace/cnc-trace-fairing';
import { readFileAsDataUrl, readImageNaturalSize } from '../../trace/image-loader';
import { matchingPreparedTrace, type PreparedTrace } from '../../trace/prepared-trace';
import { resolveTraceCommitResult } from '../../trace/trace-commit-result';
import type { TracePreviewState } from '../../trace/use-trace-preview';

export type JigTraceSource = {
  readonly file: File;
  readonly dataUrl: string;
  readonly natural: { readonly width: number; readonly height: number };
  readonly density: ImageDensity | null;
};

export async function loadJigTraceSource(file: File): Promise<JigTraceSource> {
  const [dataUrl, natural, density] = await Promise.all([
    readFileAsDataUrl(file),
    readImageNaturalSize(file),
    readImageDensity(file),
  ]);
  return { file, dataUrl, natural, density };
}

export function currentJigTracePreview(
  source: JigTraceSource | null,
  options: TraceOptions,
  preview: TracePreviewState,
): TracePreviewState {
  if (source === null) return { kind: 'idle' };
  if (preview.kind !== 'ready') return preview;
  const matching = matchingPreparedTrace(preview.preparedTrace, {
    file: source.file,
    options,
    boundary: null,
    boundaryMode: 'crop',
  });
  return matching === undefined ? { kind: 'tracing' } : preview;
}

export async function buildJigTraceObject(args: {
  readonly source: JigTraceSource;
  readonly options: TraceOptions;
  readonly preparedTrace: PreparedTrace;
  readonly project: Project;
}): Promise<TracedImage> {
  const { source, options, project } = args;
  const result = await resolveTraceCommitResult({
    file: source.file,
    options,
    preparedTrace: args.preparedTrace,
  });
  if (result.paths.length === 0)
    throw new Error('No trace paths found. Adjust the trace settings or choose another image.');
  const geometry = rasterImportGeometry({
    naturalWidth: source.natural.width,
    naturalHeight: source.natural.height,
    sampledWidth: result.width,
    sampledHeight: result.height,
    ...(source.density === null ? {} : { density: source.density }),
  });
  const transform = {
    ...IDENTITY_TRANSFORM,
    scaleX: (geometry.bounds.maxX - geometry.bounds.minX) / result.width,
    scaleY: (geometry.bounds.maxY - geometry.bounds.minY) / result.height,
  };
  const traceMode =
    options.traceMode === 'edge' || options.traceMode === 'centerline'
      ? options.traceMode
      : 'filled-contours';
  return {
    kind: 'traced-image',
    id: crypto.randomUUID(),
    source: source.file.name,
    traceMode,
    tracePixelWidth: result.width,
    tracePixelHeight: result.height,
    bounds: result.bounds,
    transform,
    paths:
      project.machine?.kind === 'cnc'
        ? fairTracedPathsForCnc(result.paths, transform)
        : result.paths,
  };
}
