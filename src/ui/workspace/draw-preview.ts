// Preview-mode rendering for the workspace (F-A8). Original geometry is
// drawn at 30% opacity behind the toolpath; the toolpath itself is
// rendered as cut polylines + travel dashed lines, optionally truncated
// at a 0..1 scrubber fraction with a red head marker at the cut point.

import {
  assertNever,
  sceneLayerVisibility,
  type Layer,
  type Project,
  type SceneObject,
  type OutputScope,
  type Vec2,
  validateOutputScope,
} from '../../core/scene';
import { buildToolpath, EMPTY_JOB, type JobOriginPlacement, type Toolpath } from '../../core/job';
import { resolveGrblDialect } from '../../core/devices';
import {
  prepareOutput,
  prepareOutputSnapshot,
  type PreparedOutput,
  type PrepareOutputSnapshotOptions,
} from '../../io/gcode';
import { hydratePagedRasterProject } from '../import/paged-raster-hydration';
import { costlyCanvasPreparation } from './canvas-preparation-policy';
import { buildDisplayPolylines } from './display-polylines';
import { strokePolylinesBatched } from './draw-vector-strokes';
import {
  previewRouteForDrawing,
  registerExecutablePlanPreviewRoute,
} from './executable-plan-preview-route';
import type { PreviewIssue, PreviewToolpath } from './preview-status';
import {
  mapOwnedToolpathToScene,
  mapToolpathToScene,
  registerPreviewJobOriginOffset,
} from './preview-scene-frame';
import type { ViewTransform } from './view-transform';
import { preparePreviewFrame } from './preview-route-frame';
import { renderPreviewFrame } from './preview-route-render';

type FaintVectorObject = Extract<
  SceneObject,
  { readonly kind: 'imported-svg' | 'text' | 'traced-image' | 'shape' }
>;

export function drawObjectsFaint(
  ctx: CanvasRenderingContext2D,
  project: Project,
  view: ViewTransform,
): void {
  ctx.save();
  ctx.globalAlpha = 0.3;
  const layerByColor = sceneLayerVisibility.lookup(project.scene.layers);
  for (const obj of project.scene.objects) {
    if (!hasFaintVectorGeometry(obj)) continue;
    drawObjectPolylinesFaint(ctx, obj, layerByColor, view);
  }
  ctx.restore();
}

function hasFaintVectorGeometry(obj: SceneObject): obj is FaintVectorObject {
  switch (obj.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
    case 'shape':
      return true;
    case 'raster-image':
    case 'relief':
      return false;
    default:
      return assertNever(obj, 'SceneObject');
  }
}

function drawObjectPolylinesFaint(
  ctx: CanvasRenderingContext2D,
  obj: FaintVectorObject,
  layerByColor: Map<string, Layer>,
  view: ViewTransform,
): void {
  if (!hasFaintVectorGeometry(obj)) return;
  for (const path of obj.paths) {
    const resolution = sceneLayerVisibility.resolvePath(obj, path, layerByColor);
    if (!resolution.visible) continue;
    ctx.strokeStyle = resolution.operation?.color ?? path.color;
    ctx.lineWidth = resolution.operation?.output === false ? 0.75 : 1.5;
    const display = buildDisplayPolylines(path.polylines);
    strokePolylinesBatched(ctx, obj, display.polylines, view);
  }
}

export function drawPreview(
  ctx: CanvasRenderingContext2D,
  toolpath: Toolpath,
  view: ViewTransform,
  scrubberT: number,
  options: {
    readonly showTravel?: boolean;
    readonly showFuture?: boolean;
    readonly showEndpoints?: boolean;
  } = {},
): void {
  const route = previewRouteForDrawing(toolpath);
  renderPreviewFrame(ctx, preparePreviewFrame(route, scrubberT, options), view);
}

export function buildPreviewToolpath(
  project: Project,
  options: { readonly jobOrigin?: JobOriginPlacement; readonly outputScope?: OutputScope } = {},
): PreviewToolpath {
  // Use the SAME prepared job (compile + optimize) as Save/Start so the preview
  // shows the exact path ORDER the machine runs (roadmap P1-C). Cheap scoped
  // complexity gates run first so huge traces/fills never reach synchronous
  // compile on the MAIN thread; the worker path (ADR-244) prepares them
  // unbounded off-thread instead.
  const issue = previewPreparationIssue(project, options);
  if (issue !== null) return emptyPreviewToolpath(issue);
  return buildPreviewToolpathUnbounded(project, options);
}

/**
 * The gates every synchronous preview build runs before preparing on the main
 * thread: output-scope validation, then the canvas-responsiveness complexity
 * fallbacks (ADR-241/ADR-243). Null means the project is safe to prepare
 * synchronously; an issue is the reason it is not. Start, Save, and Frame
 * prepare these scenes regardless — only the live preview pauses.
 */
export function previewPreparationIssue(
  project: Project,
  options: { readonly outputScope?: OutputScope } = {},
): PreviewIssue | null {
  const scoped =
    options.outputScope === undefined
      ? null
      : validateOutputScope(project.scene, options.outputScope);
  if (scoped !== null && !scoped.ok) {
    return { kind: 'preparation-failed', messages: scoped.messages };
  }
  if (costlyCanvasPreparation(project, options.outputScope)) return { kind: 'too-complex' };
  return null;
}

/**
 * buildPreviewToolpath without the canvas-responsiveness complexity gates.
 * Runs the full prepare (compile + optimize) no matter the scene size — only
 * call this off the main thread (the ADR-244 preparation worker) or in tests.
 */
export function buildPreviewToolpathUnbounded(
  project: Project,
  options: { readonly jobOrigin?: JobOriginPlacement; readonly outputScope?: OutputScope } = {},
): PreviewToolpath {
  const prepared = prepareOutput(project, {
    ...(options.jobOrigin === undefined ? {} : { jobOrigin: options.jobOrigin }),
    ...(options.outputScope === undefined ? {} : { outputScope: options.outputScope }),
  });
  return buildPreviewToolpathFromPrepared(project, prepared, options.jobOrigin, {
    executablePlan: true,
  });
}

export async function buildPreviewToolpathSnapshot(
  project: Project,
  options: Pick<
    PrepareOutputSnapshotOptions,
    'clock' | 'renderVariableText' | 'jobOrigin' | 'outputScope' | 'registration'
  >,
): Promise<PreviewToolpath> {
  // Hydrate before the gates: this path can await, so a page-backed project
  // becomes an ordinary embedded one and is judged on the same geometry the
  // synchronous callers see (hydration fills pixels, never dimensions).
  const hydrated = await hydratePagedRasterProject(project);
  const issue = previewPreparationIssue(hydrated, options);
  if (issue !== null) return emptyPreviewToolpath(issue);
  const prepared = await prepareOutputSnapshot(hydrated, options);
  return buildPreviewToolpathFromPrepared(hydrated, prepared, options.jobOrigin, {
    executablePlan: true,
  });
}

export function buildPreviewToolpathFromPrepared(
  project: Project,
  prepared: PreparedOutput,
  jobOrigin?: JobOriginPlacement,
  options: { readonly executablePlan?: boolean } = {},
): PreviewToolpath {
  if (!prepared.ok) {
    return emptyPreviewToolpath({
      kind: 'preparation-failed',
      messages: prepared.preflight.issues.map((issue) => issue.message),
    });
  }
  // The prepared job is in machine/work coordinates; the canvas (ghost +
  // raster sim) draws in scene space. Map back so the overlay registers with
  // the design instead of mirroring about the bed midline (H3).
  const startPoint = previewStartPoint(jobOrigin);
  const parkPoint = previewParkPoint(project, jobOrigin);
  const machineToolpath = buildToolpath(prepared.job, {
    startPoint,
    ...(parkPoint === undefined ? {} : { parkPoint }),
    scanningOffsets: project.device.scanningOffsets,
    bedSizeMm: { widthMm: project.device.bedWidth, heightMm: project.device.bedHeight },
  });
  // The plan-preview gate already excludes streamed rasters. Their freshly
  // built machine array has no remaining consumer, so reuse its slots instead
  // of retaining two full routes while mapping millions of raster steps.
  const streamedRaster = prepared.job.groups.some(
    (group) => group.kind === 'raster' && group.rowProvider !== undefined,
  );
  const mapPreview = streamedRaster ? mapOwnedToolpathToScene : mapToolpathToScene;
  const previewToolpath = mapPreview(machineToolpath, prepared.jobOriginOffset, project.device);
  registerPreviewJobOriginOffset(previewToolpath, prepared.jobOriginOffset);
  if (options.executablePlan === true && !streamedRaster) {
    registerExecutablePlanPreviewRoute({
      previewToolpath,
      legacyMachineToolpath: machineToolpath,
      prepared,
      ...(jobOrigin === undefined ? {} : { jobOrigin }),
      jobOriginOffset: prepared.jobOriginOffset,
      device: project.device,
    });
  }
  return previewToolpath;
}

function previewStartPoint(jobOrigin: JobOriginPlacement | undefined): Vec2 {
  return jobOrigin?.startFrom === 'current-position' ? jobOrigin.currentPosition : { x: 0, y: 0 };
}

function previewParkPoint(
  project: Project,
  jobOrigin: JobOriginPlacement | undefined,
): Vec2 | undefined {
  if (jobOrigin?.startFrom === 'current-position') return jobOrigin.currentPosition;
  if (project.machine?.kind === 'cnc' || resolveGrblDialect(project.device).parkAtOriginAfterJob) {
    return { x: 0, y: 0 };
  }
  return undefined;
}

function emptyPreviewToolpath(previewIssue: PreviewIssue): PreviewToolpath {
  return { ...buildToolpath(EMPTY_JOB), previewIssue };
}
