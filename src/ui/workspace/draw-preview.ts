// Preview-mode rendering for the workspace (F-A8). Original geometry is
// drawn at 30% opacity behind the toolpath; the toolpath itself is
// rendered as cut polylines + travel dashed lines, optionally truncated
// at a 0..1 scrubber fraction with a red head marker at the cut point.

import { canvasTheme } from '../theme/canvas-theme';
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
import {
  buildToolpath,
  EMPTY_JOB,
  sliceToolpath,
  type JobOriginPlacement,
  type Toolpath,
  type ToolpathStep,
} from '../../core/job';
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
import { mapToolpathToScene, registerPreviewJobOriginOffset } from './preview-scene-frame';
import type { ViewTransform } from './view-transform';
import { displayPolylinePointIndices, displayStepIndices } from './preview-display-decimation';

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
  if (route.totalLength === 0) return;
  const showTravel = options.showTravel !== false;
  const showFuture = options.showFuture !== false;
  const showEndpoints = options.showEndpoints !== false;
  if (showFuture && scrubberT < 1) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    drawWholeSteps(ctx, route.steps, view, showTravel);
    ctx.restore();
  }
  const sliced = sliceToolpath(route, scrubberT * route.totalLength);
  ctx.save();
  ctx.globalAlpha = 0.72;
  drawWholeSteps(ctx, sliced.whole, view, showTravel);
  if (sliced.partial !== null) drawStep(ctx, sliced.partial, view, showTravel);
  ctx.restore();
  if (showEndpoints) drawEndpoints(ctx, route.steps, view);
  if (sliced.head !== null && scrubberT < 1) drawHead(ctx, sliced.head, view);
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
  const previewToolpath = mapToolpathToScene(
    machineToolpath,
    prepared.jobOriginOffset,
    project.device,
  );
  registerPreviewJobOriginOffset(previewToolpath, prepared.jobOriginOffset);
  if (options.executablePlan === true) {
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

function drawStep(
  ctx: CanvasRenderingContext2D,
  step: ToolpathStep,
  view: ViewTransform,
  showTravel: boolean,
): void {
  if (step.kind === 'travel') {
    if (showTravel) drawTravel(ctx, step.from, step.to, view, step.motion);
  } else if (step.kind === 'plunge') {
    // Vertical-only move — no XY extent to draw in the 2D route. The
    // depth-shaded CNC preview (H.2 removal grid) is where plunges show.
  } else drawCut(ctx, step.polyline, step.color, view);
}

function drawWholeSteps(
  ctx: CanvasRenderingContext2D,
  steps: ReadonlyArray<ToolpathStep>,
  view: ViewTransform,
  showTravel: boolean,
): void {
  for (const index of displayStepIndices(steps.length)) {
    const step = steps[index];
    if (step === undefined) continue;
    drawStep(ctx, step, view, showTravel);
  }
}

function drawHead(ctx: CanvasRenderingContext2D, head: Vec2, view: ViewTransform): void {
  drawRouteMarker(ctx, head, view, 5, canvasTheme.previewHeadFill, canvasTheme.previewHeadStroke);
}

function drawEndpoints(
  ctx: CanvasRenderingContext2D,
  steps: ReadonlyArray<ToolpathStep>,
  view: ViewTransform,
): void {
  const start = firstRoutePoint(steps);
  const end = lastRoutePoint(steps);
  if (start !== null) {
    drawRouteMarker(
      ctx,
      start,
      view,
      3.5,
      canvasTheme.previewHeadStroke,
      canvasTheme.previewTravel,
    );
  }
  if (end !== null) {
    drawRouteMarker(ctx, end, view, 3.5, canvasTheme.previewTravel, canvasTheme.previewHeadStroke);
  }
}

function drawRouteMarker(
  ctx: CanvasRenderingContext2D,
  head: Vec2,
  view: ViewTransform,
  radiusPx: number,
  fillStyle: string,
  strokeStyle: string,
): void {
  const cx = view.offsetX + head.x * view.scale;
  const cy = view.offsetY + head.y * view.scale;
  ctx.save();
  ctx.fillStyle = fillStyle;
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawTravel(
  ctx: CanvasRenderingContext2D,
  from: Vec2,
  to: Vec2,
  view: ViewTransform,
  motion: Extract<ToolpathStep, { kind: 'travel' }>['motion'],
): void {
  const feed = motion === 'feed';
  ctx.strokeStyle = feed ? canvasTheme.previewFeedTravel : canvasTheme.previewTravel;
  ctx.lineWidth = feed ? 0.75 : 0.5;
  ctx.setLineDash(feed ? [5, 2] : [2, 3]);
  ctx.beginPath();
  ctx.moveTo(view.offsetX + from.x * view.scale, view.offsetY + from.y * view.scale);
  ctx.lineTo(view.offsetX + to.x * view.scale, view.offsetY + to.y * view.scale);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawCut(
  ctx: CanvasRenderingContext2D,
  polyline: ReadonlyArray<Vec2>,
  _color: string,
  view: ViewTransform,
): void {
  ctx.strokeStyle = canvasTheme.previewCut;
  ctx.lineWidth = 1;
  ctx.beginPath();
  let first = true;
  for (const index of displayPolylinePointIndices(polyline.length)) {
    const point = polyline[index];
    if (point === undefined) continue;
    const x = view.offsetX + point.x * view.scale;
    const y = view.offsetY + point.y * view.scale;
    if (first) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    first = false;
  }
  ctx.stroke();
}

function firstRoutePoint(steps: ReadonlyArray<ToolpathStep>): Vec2 | null {
  const first = steps[0];
  if (first === undefined) return null;
  if (first.kind === 'travel') return first.from;
  if (first.kind === 'plunge') return first.at;
  return first.polyline[0] ?? null;
}

function lastRoutePoint(steps: ReadonlyArray<ToolpathStep>): Vec2 | null {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step === undefined) continue;
    if (step.kind === 'travel') return step.to;
    if (step.kind === 'plunge') return step.at;
    const end = step.polyline[step.polyline.length - 1];
    if (end !== undefined) return end;
  }
  return null;
}
