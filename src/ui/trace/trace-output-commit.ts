import type { Project, RasterImage, TracedImage } from '../../core/scene';
import type { TraceExistingImageOptions } from '../state/scene-mutations';
import type { TraceOutput } from './dialog-parts';
import {
  buildRasterTraceOutput,
  rasterTraceInputs,
  sameRasterTraceInputs,
} from './trace-raster-output';

export type TraceOutputCommitArgs = {
  readonly seed: Pick<RasterImage, 'id' | 'source'>;
  readonly traceOutput?: TraceOutput;
  readonly deleteSourceAfterTrace?: boolean;
  readonly replaceTraceId?: string;
};

export type TraceOutputCommitContext = {
  readonly traceExistingImage: (
    sourceId: string,
    traced: TracedImage,
    options?: TraceExistingImageOptions,
  ) => void;
  readonly commitRasterizedTrace: (
    sourceId: string,
    raster: RasterImage,
    options?: TraceExistingImageOptions,
  ) => void;
  readonly pushToast: (message: string, variant: 'success' | 'error') => void;
  readonly getCurrentProject: () => Project;
};

export async function commitTraceOutput(
  args: TraceOutputCommitArgs,
  ctx: TraceOutputCommitContext,
  traced: TracedImage,
  liveProject: Project,
): Promise<boolean> {
  const deleteSourceAfterTrace = args.deleteSourceAfterTrace === true;
  const traceOptions: TraceExistingImageOptions = {
    deleteSourceAfterTrace,
    ...(args.replaceTraceId === undefined ? {} : { replaceTraceId: args.replaceTraceId }),
  };
  const sourceStatus = deleteSourceAfterTrace ? 'source deleted' : 'source kept';
  const rasterOutput =
    (args.traceOutput ?? 'vector') === 'raster' && liveProject.machine?.kind !== 'cnc';
  if (rasterOutput) {
    return commitRasterTraceOutput(args, ctx, traced, liveProject, traceOptions, sourceStatus);
  }
  ctx.traceExistingImage(args.seed.id, traced, traceOptions);
  ctx.pushToast(traceSuccessMessage(args.seed.source, traced, sourceStatus, false), 'success');
  return true;
}

async function commitRasterTraceOutput(
  args: TraceOutputCommitArgs,
  ctx: TraceOutputCommitContext,
  traced: TracedImage,
  liveProject: Project,
  traceOptions: TraceExistingImageOptions,
  sourceStatus: string,
): Promise<boolean> {
  const inputs = rasterTraceInputs(liveProject, args.seed.id);
  if (inputs === null) {
    ctx.pushToast(
      `The source image or Image operation for ${args.seed.source} changed — re-open Trace to continue.`,
      'error',
    );
    return false;
  }
  const raster = await buildRasterTraceOutput(
    inputs.source,
    traced,
    inputs.operations.map(({ operation }) => operation),
  );
  const currentProject = ctx.getCurrentProject();
  if (currentProject.machine?.kind === 'cnc' || !sameRasterTraceInputs(currentProject, inputs)) {
    ctx.pushToast(
      `The machine, source image, or Image operation for ${args.seed.source} changed while the raster scan was being built — re-open Trace to continue.`,
      'error',
    );
    return false;
  }
  ctx.commitRasterizedTrace(args.seed.id, raster, traceOptions);
  ctx.pushToast(traceSuccessMessage(args.seed.source, traced, sourceStatus, true), 'success');
  return true;
}

function traceSuccessMessage(
  source: string,
  traced: TracedImage,
  sourceStatus: string,
  raster: boolean,
): string {
  const colorCount = traced.paths.length;
  const output = raster ? ' as a raster scan' : '';
  return `Traced ${source}${output} — ${colorCount} color${colorCount === 1 ? '' : 's'}, ${sourceStatus}`;
}
