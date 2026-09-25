import type { Project, RasterImage, TracedImage } from '../../core/scene';
import type { TraceOptions } from '../../core/trace';
import type { TraceExistingImageOptions } from '../state/scene-mutations';
import { projectWithCameraTraceSource } from '../state/camera-trace-import';
import { useStore } from '../state/store';
import { checkTraceSignal } from './trace-cancellation';
import type { TraceOutput } from './dialog-parts';
import type { TraceCommitClaim } from './trace-commit-ownership';
import { traceNoticeMessage, type TraceNotice } from './trace-notices';
import {
  buildRasterTraceOutput,
  rasterTraceInputs,
  sameRasterTraceInputs,
} from './trace-raster-output';

export type TraceOutputCommitArgs = {
  readonly photoShading?: boolean;
  readonly seed: Pick<RasterImage, 'id' | 'source'>;
  readonly traceOutput?: TraceOutput;
  readonly deleteSourceAfterTrace?: boolean;
  readonly replaceTraceId?: string;
  readonly notices?: ReadonlyArray<TraceNotice>;
  /** The trace's options; a colour-layer trace gives each colour its own
   *  operation with a darkness-ordered power (ADR-402). */
  readonly options?: Pick<TraceOptions, 'colourLayers'>;
};

export type TraceOutputCommitContext = {
  readonly signal?: AbortSignal;
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
  readonly claimOwner: () => TraceCommitClaim | null;
};

export async function commitTraceOutput(
  args: TraceOutputCommitArgs,
  ctx: TraceOutputCommitContext,
  traced: TracedImage,
  liveProject: Project,
): Promise<boolean> {
  const owner = ctx.claimOwner();
  if (owner === null) return false;
  const deleteSourceAfterTrace = args.deleteSourceAfterTrace === true;
  const traceOptions: TraceExistingImageOptions = {
    deleteSourceAfterTrace,
    ...(owner.cameraSource === undefined ? {} : { cameraSource: owner.cameraSource }),
    ...(args.replaceTraceId === undefined ? {} : { replaceTraceId: args.replaceTraceId }),
  };
  const sourceStatus = deleteSourceAfterTrace ? 'source deleted' : 'source kept';
  const rasterOutput =
    (args.traceOutput ?? 'vector') === 'raster' && liveProject.machine?.kind !== 'cnc';
  if (rasterOutput) {
    const outputProject =
      owner.cameraSource === undefined
        ? liveProject
        : projectWithCameraTraceSource(liveProject, owner.cameraSource);
    return commitRasterTraceOutput(args, ctx, traced, outputProject, traceOptions, sourceStatus);
  }
  if (ctx.claimOwner() === null) return false;
  ctx.traceExistingImage(args.seed.id, traced, withColourLayerOutput(traceOptions, args));
  ctx.pushToast(traceSuccessMessage(args, traced, sourceStatus, false), 'success');
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
    if (ctx.claimOwner() !== null) {
      ctx.pushToast(
        `The source image or Image operation for ${args.seed.source} changed — re-open Trace to continue.`,
        'error',
      );
    }
    return false;
  }
  const raster = await buildOwnedRaster(
    args,
    ctx,
    traced,
    inputs,
    traceOptions.cameraSource !== undefined,
  );
  const currentOwner = ctx.claimOwner();
  if (currentOwner === null) return false;
  const currentProject = currentOwner.project;
  if (
    currentProject.machine?.kind === 'cnc' ||
    (traceOptions.cameraSource === undefined && !sameRasterTraceInputs(currentProject, inputs))
  ) {
    ctx.pushToast(
      `The machine, source image, or Image operation for ${args.seed.source} changed while the raster scan was being built — re-open Trace to continue.`,
      'error',
    );
    return false;
  }
  ctx.commitRasterizedTrace(args.seed.id, raster, traceOptions);
  ctx.pushToast(traceSuccessMessage(args, traced, sourceStatus, true), 'success');
  return true;
}

async function buildOwnedRaster(
  args: TraceOutputCommitArgs,
  ctx: TraceOutputCommitContext,
  traced: TracedImage,
  inputs: NonNullable<ReturnType<typeof rasterTraceInputs>>,
  camera: boolean,
): Promise<RasterImage> {
  checkTraceSignal(ctx.signal);
  // Keep the final publication recheck; this subscription also stops obsolete CPU work.
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const validate = (): void => {
    const owner = ctx.claimOwner();
    if (
      owner === null ||
      owner.project.machine?.kind === 'cnc' ||
      (!camera && !sameRasterTraceInputs(owner.project, inputs))
    )
      abort();
  };
  const unsubscribe = useStore.subscribe(validate);
  ctx.signal?.addEventListener('abort', abort, { once: true });
  try {
    validate();
    return await buildRasterTraceOutput(
      inputs.source,
      traced,
      inputs.operations.map(({ operation }) => operation),
      args.photoShading === true,
      controller.signal,
    );
  } finally {
    unsubscribe();
    ctx.signal?.removeEventListener('abort', abort);
  }
}

// A colour-layer trace gives each colour's operation a darkness-ordered power
// (ADR-402); the store needs to know which output the powers are for.
function withColourLayerOutput(
  options: TraceExistingImageOptions,
  args: TraceOutputCommitArgs,
): TraceExistingImageOptions {
  const colourLayers = args.options?.colourLayers;
  if (colourLayers === undefined) return options;
  return { ...options, colourLayerOutput: colourLayers.output ?? 'cut-out' };
}

function traceSuccessMessage(
  args: TraceOutputCommitArgs,
  traced: TracedImage,
  sourceStatus: string,
  raster: boolean,
): string {
  const colorCount = traced.paths.length;
  const output = raster ? ' as a raster scan' : '';
  const colours =
    args.options?.colourLayers !== undefined && !raster
      ? `${colorCount} colour layer${colorCount === 1 ? '' : 's'}, power set by darkness`
      : `${colorCount} color${colorCount === 1 ? '' : 's'}`;
  const summary = `Traced ${args.seed.source}${output} — ${colours}, ${sourceStatus}`;
  return [summary, ...(args.notices ?? []).map(traceNoticeMessage)].join('. ');
}
