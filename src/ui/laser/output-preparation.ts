import type {
  CncCompilationTaskRunner,
  OutputCompilationProgress,
} from '../../io/gcode/prepare-output-async';
import { prepareOutputAsync } from '../../io/gcode/prepare-output-async';
import { prepareOutputSnapshot, type PrepareOutputOptions } from '../../io/gcode';
import { prepareOutputForStructuredClone } from '../../io/gcode/prepared-output-persistence';
import { emitPreparedRdFile } from '../../io/rd';
import type { Project } from '../../core/scene';
import { emitSavePreparedOutput } from './save-output-emission';
import { prepareStartJobSnapshot } from './start-job-readiness';
import { prepareStartJobAsync } from './start-job-readiness-async';
import type {
  OutputPreparationRequest,
  OutputPreparationResponse,
  StartOutputPreparationRequest,
} from './output-preparation-protocol';
import { hydratePagedRasterProject } from '../import/paged-raster-hydration';
import { runCanvasCompilationTasks } from '../workspace/canvas-compilation-worker-pool';
import { renderVariableText } from '../text/render-variable-text';
import { detectMachineJobWarnings } from './machine-job-warnings';
import { finalizeTiledOutput } from '../app/tiled-output-preparation';

export type OutputPreparationContext = {
  readonly jobId: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: OutputCompilationProgress) => void;
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
  const prepared = await asyncPreparer(context)(project, request.options);
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
  const prepared = await asyncPreparer(context)(project, request.options);
  return { kind: 'rd', result: emitPreparedRdFile(prepared) };
}

async function prepareSaveOutput(
  request: Extract<OutputPreparationRequest, { readonly kind: 'save' }>,
  project: Project,
  context: OutputPreparationContext,
): Promise<OutputPreparationResponse> {
  const prepare = asyncPreparer(context);
  const prepared =
    request.snapshot === undefined
      ? await prepare(project, request.options)
      : await prepareOutputSnapshot(project, {
          ...request.options,
          clock: fixedSnapshotClock(request.snapshot.evaluatedAtIso),
          renderVariableText,
          ...request.snapshot,
          prepare,
        });
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
          },
        );
  return result.ok
    ? { ...result, prepared: prepareOutputForStructuredClone(result.prepared) }
    : result;
}

function fixedSnapshotClock(evaluatedAtIso: string): () => Date {
  const timestamp = new Date(evaluatedAtIso);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error('Output snapshot evaluation time is invalid.');
  }
  return () => new Date(timestamp.getTime());
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
