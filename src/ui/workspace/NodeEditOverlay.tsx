// The node tool's hover layer: highlights the segment under the pointer, the
// one I, M, D, L, S and A act on, and installs those hover keys while the node
// tool is active (node-edit-keys.ts). Pointer-transparent, like Trim's layer.

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { contourSegments, segmentPoint, segmentStart } from '../../core/geometry/trim-curve-split';
import { applyTransform, polylineToCurveSubpath, type Project, type Vec2 } from '../../core/scene';
import { keyboardOwnedElsewhere } from '../common/keyboard-owner';
import { isEditableShortcutTarget } from '../common/keyboard-targets';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { canvasTheme } from '../theme/canvas-theme';
import { handleNodeEditKey, NODE_EDIT_KEYS } from './node-edit-keys';
import { hitPathNode } from './path-node-hit-test';
import { hitPathSegment, type PathSegmentHit } from './path-segment-hit-test';
import type { CanvasBitmapSize } from './use-canvas-bitmap-size';
import { computeView, type ViewState, type ViewTransform } from './view-transform';

const LINE_WIDTH_PX = 3;
const HIGHLIGHT_SAMPLES = 48;

export function NodeEditOverlay(props: {
  readonly project: Project;
  readonly canvasSize: CanvasBitmapSize;
  readonly viewState: ViewState;
  readonly enabled: boolean;
}): JSX.Element | null {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const active = useUiStore((state) => state.toolMode.kind === 'node') && props.enabled;
  const cursor = useStore((state) => state.cursorMm);
  const selectedNodes = useStore((state) => state.selectedPathNodes);
  const { width, height } = props.canvasSize;
  const { bedWidth, bedHeight } = props.project.device;
  const view = useMemo(
    () => computeView(width, height, bedWidth, bedHeight, props.viewState),
    [width, height, bedWidth, bedHeight, props.viewState],
  );
  const scene = props.project.scene;
  const segment = useMemo(() => {
    if (!active || cursor === null) return null;
    if (hitPathNode(scene, cursor, 1 / view.scale, selectedNodes) !== null) return null;
    return hitPathSegment(scene, cursor, 1 / view.scale);
  }, [active, cursor, scene, view.scale, selectedNodes]);
  useNodeEditKeys(active, view.scale);
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext('2d') ?? null;
    if (ctx === null) return;
    ctx.clearRect(0, 0, width, height);
    const points = segment === null ? null : segmentWorldPoints(props.project, segment);
    if (points !== null) drawHighlight(ctx, points, view);
  }, [segment, view, width, height, props.project]);
  if (!active) return null;
  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={layerStyle}
      aria-hidden="true"
      data-testid="node-edit-layer"
    />
  );
}

function useNodeEditKeys(active: boolean, scale: number): void {
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (isEditableShortcutTarget(event.target) || keyboardOwnedElsewhere()) return;
      const key = event.key.toLowerCase();
      if (!NODE_EDIT_KEYS.has(key)) return;
      const app = useStore.getState();
      if (app.previewMode || app.cursorMm === null) return;
      if (handleNodeEditKey(app, key, app.cursorMm, 1 / scale)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    // Capture runs before the workspace's own shortcuts, where T is Text.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [active, scale]);
}

function segmentWorldPoints(project: Project, segment: PathSegmentHit): ReadonlyArray<Vec2> | null {
  const object = project.scene.objects.find((candidate) => candidate.id === segment.objectId);
  if (object === undefined || !('paths' in object)) return null;
  const path = object.paths[segment.pathIndex];
  const polyline = path?.polylines[segment.curveIndex];
  const curve =
    path?.curves?.[segment.curveIndex] ??
    (polyline === undefined ? undefined : polylineToCurveSubpath(polyline));
  if (curve === undefined) return null;
  const contour = contourSegments(curve, curve.closed);
  const selectedSegment = contour.segments[segment.segmentIndex];
  if (selectedSegment === undefined) return null;
  const from = segmentStart(contour, segment.segmentIndex);
  const points: Vec2[] = [];
  for (let index = 0; index <= HIGHLIGHT_SAMPLES; index += 1) {
    const point = segmentPoint(from, selectedSegment, index / HIGHLIGHT_SAMPLES);
    points.push(applyTransform(point, object.transform));
  }
  return points;
}

function drawHighlight(
  ctx: CanvasRenderingContext2D,
  points: ReadonlyArray<Vec2>,
  view: ViewTransform,
): void {
  ctx.save();
  ctx.strokeStyle = canvasTheme.pathNodeHandleStroke;
  ctx.lineWidth = LINE_WIDTH_PX;
  ctx.lineCap = 'round';
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = view.offsetX + point.x * view.scale;
    const y = view.offsetY + point.y * view.scale;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
}

const layerStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
};
