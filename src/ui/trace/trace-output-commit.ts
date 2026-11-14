import type { Project, RasterImage, TracedImage } from '../../core/scene';
import type { TraceOptions } from '../../core/trace';
import type { TraceExistingImageOptions } from '../state/scene-mutations';
import { projectWithCameraTraceSource } from '../state/camera-trace-import';
import { replacedTraceResult, retraceOperationsNote } from '../state/retrace-carry';
import { useStore } from '../state/store';
import { checkTraceSignal } from './trace-cancellation';
import type { TraceOutput } from './dialog-parts';
import type { TraceCommitClaim } from './trace-commit-ownership';
import { traceNoticeMessage, type TraceNotice } from './trace-notices';
import { scheduleTraceMinFeatureNotice } from './trace-min-feature-notice';
import {
  buildRasterTraceOutput,
  rasterTraceInputs,
  sameRasterTraceInputs,
} from './trace-raster-output';

export type TraceOutputCommitArgs = {
  readonly photoShading?: boolean;
  /** The source as the dialog opened on it; a re-trace measures the replaced
   *  trace's offset against its transform (ADR-408 Amendment 1). */
  readonly seed: Pick<RasterImage, 'id' | 'source'> & Partial<Pick<RasterImage, 'transform'>>;
  readonly traceOutput?: TraceOutput;
  readonly deleteSourceAfterTrace?: boolean;
  readonly replaceTraceId?: string;
  readonly notices?: ReadonlyArray<TraceNotice>;
  /** The trace's options; a colour-layer trace gives each colour its own
   *  operation with a darkness-ordered power (ADR-461). */
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
  readonly pushToast: (message: string, variant: 'success' | 'error' | 'warning') => void;
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
  const traceOptions = traceCommitOptions(args, owner);
  const status = traceCommitStatus(args, owner, liveProject, traced);
  if (usesRasterTraceOutput(args, traced, liveProject)) {
    const outputProject =
      owner.cameraSource === undefined
        ? liveProject
        : projectWithCameraTraceSource(liveProject, owner.cameraSource);
    return commitRasterTraceOutput(args, ctx, traced, outputProject, traceOptions, status);
  }
  if (ctx.claimOwner() === null) return false;
  ctx.traceExistingImage(args.seed.id, traced, withColourLayerOutput(traceOptions, args));
  const cnc = liveProject.machine?.kind === 'cnc';
  ctx.pushToast(traceSuccessMessage(args, traced, status, false, cnc), 'success');
  scheduleTraceMinFeatureNotice(
    traced.id,
    () => useStore.getState().project,
    (message) => ctx.pushToast(message, 'warning'),
  );
  return true;
}

function traceCommitOptions(
  args: TraceOutputCommitArgs,
  owner: TraceCommitClaim,
): TraceExistingImageOptions {
  return {
    deleteSourceAfterTrace: args.deleteSourceAfterTrace === true,
    ...(owner.cameraSource === undefined ? {} : { cameraSource: owner.cameraSource }),
    ...(args.replaceTraceId === undefined ? {} : { replaceTraceId: args.replaceTraceId }),
    ...(args.replaceTraceId === undefined || args.seed.transform === undefined
      ? {}
      : { retraceSourceTransform: args.seed.transform }),
  };
}

function traceCommitStatus(
  args: TraceOutputCommitArgs,
  owner: TraceCommitClaim,
  liveProject: Project,
  traced: TracedImage,
): TraceCommitStatus {
  const sourceStatus = args.deleteSourceAfterTrace === true ? 'source deleted' : 'source kept';
  // A camera trace commits through its own import, not the in-place re-trace.
  if (owner.cameraSource !== undefined) return { sourceStatus };
  const retrace = retraceSummary(liveProject, args.replaceTraceId, traced);
  return retrace === undefined ? { sourceStatus } : { sourceStatus, retrace };
}

// Line + fill (ADR-454) is vector-only: the raster route renders one
// style for every path, which would turn its fills into outline rings.
function usesRasterTraceOutput(
  args: TraceOutputCommitArgs,
  traced: TracedImage,
  liveProject: Project,
): boolean {
  return (
    (args.traceOutput ?? 'vector') === 'raster' &&
    liveProject.machine?.kind !== 'cnc' &&
    traced.traceMode !== 'hybrid'
  );
}

async function commitRasterTraceOutput(
  args: TraceOutputCommitArgs,
  ctx: TraceOutputCommitContext,
  traced: TracedImage,
  liveProject: Project,
  traceOptions: TraceExistingImageOptions,
  status: TraceCommitStatus,
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
  ctx.pushToast(traceSuccessMessage(args, traced, status, true, false), 'success');
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
// (ADR-461); the store needs to know which output the powers are for and
// whether the paper was traced (its operation starts with output off).
function withColourLayerOutput(
  options: TraceExistingImageOptions,
  args: TraceOutputCommitArgs,
): TraceExistingImageOptions {
  const colourLayers = args.options?.colourLayers;
  if (colourLayers === undefined) return options;
  return {
    ...options,
    colourLayers: {
      output: colourLayers.output ?? 'cut-out',
      paperTraced: colourLayers.keepBackground === true,
    },
  };
}

// Re-trace Original keeps the replaced trace's place and, for a same-mode
// vector re-trace, its operations (ADR-408 Amendment 1); the toast says so.
type RetraceSummary = { readonly label: string; readonly note?: string };

type TraceCommitStatus = { readonly sourceStatus: string; readonly retrace?: RetraceSummary };

function retraceSummary(
  project: Project,
  replaceTraceId: string | undefined,
  traced: TracedImage,
): RetraceSummary | undefined {
  const previous = replacedTraceResult(project.scene, replaceTraceId);
  if (previous === undefined) return undefined;
  const note = retraceOperationsNote(previous, traced);
  return { label: previous.name ?? traced.source, ...(note === undefined ? {} : { note }) };
}

function traceSuccessMessage(
  args: TraceOutputCommitArgs,
  traced: TracedImage,
  { sourceStatus, retrace }: TraceCommitStatus,
  raster: boolean,
  cnc: boolean,
): string {
  const colorCount = traced.paths.length;
  const output = raster ? ' as a raster scan' : '';
  // CNC operation power is not a tone, so a CNC commit keeps its powers
  // (colour-layer-power.ts) and the toast must not claim otherwise.
  const layers = `${colorCount} colour layer${colorCount === 1 ? '' : 's'}`;
  const colours =
    args.options?.colourLayers !== undefined && !raster
      ? cnc
        ? layers
        : `${layers}, power set by darkness`
      : `${colorCount} color${colorCount === 1 ? '' : 's'}`;
  const summary =
    retrace === undefined
      ? `Traced ${args.seed.source}${output} — ${colours}, ${sourceStatus}`
      : [
          `Re-traced ${retrace.label}${output} in place — ${colours}, kept its place`,
          ...(retrace.note === undefined || raster ? [] : [retrace.note]),
          sourceStatus,
        ].join(', ');
  return [summary, ...(args.notices ?? []).map(traceNoticeMessage)].join('. ');
}
