import {
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
  type SceneObject,
  type TracedImage,
  type Transform,
} from '../../../core/scene';
import type { TraceOptions } from '../../../core/trace';
import { readImageDensity, type ImageDensity } from '../../common/image-density';
import { rasterImportGeometry } from '../../common/image-import';
import { readRasterSourceFile } from '../../import/paged-raster-source';
import { positionTraceOverRasterSource } from '../../state/trace-placement';
import { fairTracedPathsForCnc } from '../../trace/cnc-trace-fairing';
import { readFileAsDataUrl, readImageNaturalSize } from '../../trace/image-loader';
import { matchingPreparedTrace, type PreparedTrace } from '../../trace/prepared-trace';
import { resolveTraceCommitResult } from '../../trace/trace-commit-result';
import { traceModeForOptions } from '../../trace/trace-mode-for-options';
import { bindTraceSourceMask } from '../../trace/trace-source-mask';
import type { TracePreviewState } from '../../trace/use-trace-preview';

export type JigTraceSource = {
  readonly file: File;
  readonly dataUrl: string;
  readonly natural: { readonly width: number; readonly height: number };
  readonly density: ImageDensity | null;
  /** The jig image the trace replaces; absent for an uploaded file. */
  readonly image?: RasterImage;
};

export async function loadJigTraceSource(file: File): Promise<JigTraceSource> {
  const [dataUrl, natural, density] = await Promise.all([
    readFileAsDataUrl(file),
    readImageNaturalSize(file),
    readImageDensity(file),
  ]);
  return { file, dataUrl, natural, density };
}

/** Reads an image already on the jig, clipped by its crop or image mask like Trace Image. */
export async function loadJigImageTraceSource(
  image: RasterImage,
  maskObject: SceneObject | undefined,
): Promise<JigTraceSource> {
  const file = bindTraceSourceMask(
    await readRasterSourceFile(image, image.source),
    image,
    maskObject,
  );
  const [dataUrl, natural] = await Promise.all([
    readFileAsDataUrl(file),
    readImageNaturalSize(file),
  ]);
  return { file, dataUrl, natural, density: null, image };
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
  const traced: TracedImage = {
    kind: 'traced-image',
    id: crypto.randomUUID(),
    source: source.file.name,
    // Line + fill stays 'hybrid', as the Trace dialog commits it.
    traceMode: traceModeForOptions(options),
    tracePixelWidth: result.width,
    tracePixelHeight: result.height,
    bounds: result.bounds,
    transform: IDENTITY_TRANSFORM,
    paths: result.paths,
  };
  const transform = traceTransform(source, traced, result);
  return {
    ...traced,
    transform,
    ...(project.machine?.kind === 'cnc'
      ? { paths: fairTracedPathsForCnc(result.paths, transform) }
      : {}),
  };
}

// A replacing trace lies over its image; an upload keeps the file's physical size.
function traceTransform(
  source: JigTraceSource,
  traced: TracedImage,
  grid: { readonly width: number; readonly height: number },
): Transform {
  if (source.image !== undefined)
    return positionTraceOverRasterSource(source.image, traced).transform;
  const geometry = rasterImportGeometry({
    naturalWidth: source.natural.width,
    naturalHeight: source.natural.height,
    sampledWidth: grid.width,
    sampledHeight: grid.height,
    ...(source.density === null ? {} : { density: source.density }),
  });
  return {
    ...IDENTITY_TRANSFORM,
    scaleX: (geometry.bounds.maxX - geometry.bounds.minX) / grid.width,
    scaleY: (geometry.bounds.maxY - geometry.bounds.minY) / grid.height,
  };
}
