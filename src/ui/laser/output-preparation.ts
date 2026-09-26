import type {
  CncCompilationTaskRunner,
  OutputCompilationProgress,
} from '../../io/gcode/prepare-output-async';
import { prepareOutputAsync } from '../../io/gcode/prepare-output-async';
import { prepareOutputSnapshot, type PrepareOutputOptions } from '../../io/gcode';
import { prepareOutputForStructuredClone } from '../../io/gcode/prepared-output-persistence';
import { archiveCanvasMotionPlan } from '../state/recovery/execution-artifact-canvas';
import { emitPreparedRdFile } from '../../io/rd';
import type { Project } from '../../core/scene';
import { emitSavePreparedOutput } from './save-output-emission';
import { prepareStartJobSnapshot } from './start-job-readiness';
import { prepareStartJobAsync } from './start-job-readiness-async';
import type {
  OutputPreparationRequest,
  OutputPreparationResponse,
  StartOutputPreparationRequest,
  OutputSnapshotRequest,
} from './output-preparation-protocol';
import { hydratePagedRasterProject } from '../import/paged-raster-hydration';
import { runCanvasCompilationTasks } from '../workspace/canvas-compilation-worker-pool';
import { renderVariableText } from '../text/render-variable-text';
import { detectMachineJobWarnings } from './machine-job-warnings';
import { finalizeTiledOutput } from '../app/tiled-output-preparation';
import type { FrameBoundsPreview } from './frame-bounds-preview';

export type OutputPreparationContext = {
  readonly jobId: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: OutputCompilationProgress) => void;
  /** Start only: the Frame rectangles, reported as soon as the job is
   * compiled so a split Frame can trace them while the exact program is still
   * being finished (ADR-353). */
  readonly onFrameBounds?: (preview: FrameBoundsPreview) => void;
  readonly runCncTasks?: CncCompilationTaskRunner;
};

export async function prepareOutputRequest(
  request: OutputPreparationRequest,
  context: OutputPreparationContext = { jobId: 'output-preparation' },
): Promise<OutputPreparationResponse> {
  const project = await hydratePagedRasterProject(request.project);
  switch (request.kind) {
    case 'prepare':
      return prepareOnlyOutput(request, project, context);
    case 'tiles':
      return prepareTilesOutput(request, project, context);
    case 'rd':
      return prepareRdOutput(request, project, context);
    case 'save':
      return prepareSaveOutput(request, project, context);
    case 'start':
      return { kind: 'start', result: await prepareStartOutput({ ...request, project }, context) };
  }
}

async function prepareOnlyOutput(
  request: Extract<OutputPreparationRequest, { readonly kind: 'prepare' }>,
  project: Project,
  context: OutputPreparationContext,
): Promise<OutputPreparationResponse> {
  const prepared = await asyncPreparer(context)(project, request.options);
  const machineWarnings = prepared.ok
    ? detectMachineJobWarnings(
        prepared.project,
        request.controllerSettings ?? null,
        request.activeWcs ?? null,
        prepared,
      )
    : [];
  return {
    kind: 'prepared',
    result: prepared.ok ? prepareOutputForStructuredClone(prepared) : prepared,
    machineWarnings,
  };
}

async function prepareTilesOutput(
  request: Extract<OutputPreparationRequest, { readonly kind: 'tiles' }>,
  project: Project,
  context: OutputPreparationContext,
): Promise<OutputPreparationResponse> {
  const prepared = await prepareWithOptionalSnapshot(project, request, context);
  return {
    kind: 'tiles',
    result: finalizeTiledOutput(
      prepared,
      request.savedName,
      request.controllerSettings ?? null,
      request.activeWcs ?? null,
    ),
  };
}

async function prepareRdOutput(
  request: Extract<OutputPreparationRequest, { readonly kind: 'rd' }>,
  project: Project,
  context: OutputPreparationContext,
): Promise<OutputPreparationResponse> {
  const prepared = await prepareWithOptionalSnapshot(project, request, context);
  // The same options as the direct path: placement picks the reference point
  // and the preflight frame decides the post-compile checks (audit RU-2/RU-7).
  return { kind: 'rd', result: emitPreparedRdFile(prepared, request.options) };
}

async function prepareSaveOutput(
  request: Extract<OutputPreparationRequest, { readonly kind: 'save' }>,
  project: Project,
  context: OutputPreparationContext,
): Promise<OutputPreparationResponse> {
  const prepared = await prepareWithOptionalSnapshot(project, request, context);
  const machineWarnings = prepared.ok
    ? detectMachineJobWarnings(
        prepared.project,
        request.controllerSettings ?? null,
        request.activeWcs ?? null,
        prepared,
      )
    : [];
  return {
    kind: 'save',
    result: emitSavePreparedOutput(prepared, request.options, machineWarnings),
  };
}

async function prepareStartOutput(
  request: StartOutputPreparationRequest,
  context: OutputPreparationContext,
) {
  const prepare = asyncPreparer(context);
  const result =
    request.snapshot === undefined
      ? await prepareStartJobAsync(
          request.project,
          request.controllerSettings,
          request.machine,
          request.jobPlacement,
          request.outputScope,
          request.resolvedJobOrigin,
          request.requireFrame,
          prepare,
          context.onFrameBounds,
        )
      : await prepareStartJobSnapshot(
          request.project,
          request.controllerSettings,
          request.machine,
          request.jobPlacement,
          request.outputScope,
          {
            clock: fixedSnapshotClock(request.snapshot.evaluatedAtIso),
            renderVariableText,
            ...request.snapshot,
            ...(request.resolvedJobOrigin === undefined
              ? {}
              : { resolvedJobOrigin: request.resolvedJobOrigin }),
            requireFrame: request.requireFrame,
            prepare,
            ...(context.onFrameBounds === undefined
              ? {}
              : { onFrameBounds: context.onFrameBounds }),
          },
        );
  return result.ok
    ? {
        ...result,
        prepared: prepareOutputForStructuredClone(result.prepared),
        // Packed for the boundary, not archived: the client unpacks it
        // (TransferredStartJobPreparation). The archive budget belongs to the
        // archive, which is written later and is best-effort; enforcing it
        // here would turn a large job into a Start refusal (ADR-345).
        canvasPlan: archiveCanvasMotionPlan(result.canvasPlan, { enforceArchiveBudget: false }),
      }
    : result;
}

function fixedSnapshotClock(evaluatedAtIso: string): () => Date {
  const timestamp = new Date(evaluatedAtIso);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error('Output snapshot evaluation time is invalid.');
  }
  return () => new Date(timestamp.getTime());
}

function prepareWithOptionalSnapshot(
  project: Project,
  request: { readonly options: PrepareOutputOptions; readonly snapshot?: OutputSnapshotRequest },
  context: OutputPreparationContext,
) {
  const prepare = asyncPreparer(context);
  return request.snapshot === undefined
    ? prepare(project, request.options)
    : prepareOutputSnapshot(project, {
        ...request.options,
        ...request.snapshot,
        clock: fixedSnapshotClock(request.snapshot.evaluatedAtIso),
        renderVariableText,
        prepare,
      });
}

function asyncPreparer(context: OutputPreparationContext) {
  return (project: Parameters<typeof prepareOutputAsync>[0], options: PrepareOutputOptions) =>
    prepareOutputAsync(project, options, {
      jobId: context.jobId,
      runCncTasks: context.runCncTasks ?? runCanvasCompilationTasks,
      ...(context.signal === undefined ? {} : { signal: context.signal }),
      ...(context.onProgress === undefined ? {} : { onProgress: context.onProgress }),
    });
}
