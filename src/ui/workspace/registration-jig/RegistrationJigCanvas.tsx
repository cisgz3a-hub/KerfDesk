import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
  type MutableRefObject,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  hitTest,
  sceneObjectHasVisibleLayer,
  transformedBBox,
  type Project,
  type Vec2,
} from '../../../core/scene';
import { Button } from '../../kit';
import { canvasTheme } from '../../theme/canvas-theme';
import { drawScene } from '../draw-scene';
import { createDisplayPolylineCache } from '../display-polylines';
import { useCanvasBitmapSize } from '../use-canvas-bitmap-size';
import {
  canvasMouseToScene,
  clientToCanvasPx,
  computeView,
  zoomAtCursorPx,
  type ViewState,
} from '../view-transform';
import { jigSelectionForHit, moveJigSelection } from './jig-canvas-selection';
import { fitJigCanvasView, JIG_BED_VIEW } from './jig-canvas-view';

export type RegistrationJigCanvasProps = {
  readonly project: Project;
  readonly selectedIds: ReadonlySet<string>;
  readonly onSelectionChange: (ids: ReadonlySet<string>) => void;
  readonly onCommit: (project: Project) => void;
};

type Gesture = {
  readonly pointerId: number;
  readonly kind: 'move' | 'pan';
  readonly start: Vec2;
  readonly base: Project;
  readonly selectedIds: ReadonlySet<string>;
  readonly view: ViewState;
};

export function RegistrationJigCanvas(props: RegistrationJigCanvasProps): JSX.Element {
  const { project, selectedIds } = props;
  const ref = useRef<HTMLCanvasElement>(null);
  const size = useCanvasBitmapSize(ref);
  // Use the measured viewport as it becomes available, without chasing objects
  // as the user edits them. Panning/zooming takes ownership until Fit jig is used.
  const initialProject = useRef(project);
  const [manualView, setView] = useState<ViewState | null>(null);
  const view = manualView ?? fitJigCanvasView(initialProject.current, size);
  const [preview, setPreview] = useState<Project | null>(null);
  const spaceHeld = useRef(false);
  const { gesture, begin, update, end } = useJigCanvasGesture({
    ...props,
    ref,
    view,
    setView,
    setPreview,
    spaceHeld,
  });
  useJigCanvasPaint(ref, preview ?? project, selectedIds, size, view);
  useJigCanvasWheel({ ref, gesture, view, size, project, setView });

  return (
    <div style={hostStyle}>
      <canvas
        ref={ref}
        width={size.width}
        height={size.height}
        aria-label="Registration jig editing canvas"
        aria-describedby="registration-jig-canvas-help"
        tabIndex={0}
        style={canvasStyle}
        onPointerDown={begin}
        onPointerMove={update}
        onPointerUp={(event) => end(event, false)}
        onPointerCancel={(event) => end(event, true)}
        onLostPointerCapture={() => {
          gesture.current = null;
          setPreview(null);
        }}
        onBlur={() => {
          spaceHeld.current = false;
        }}
        onKeyDown={(event) => {
          if (event.code === 'Space') {
            spaceHeld.current = true;
            event.preventDefault();
          }
        }}
        onKeyUp={(event) => {
          if (event.code === 'Space') {
            spaceHeld.current = false;
            event.preventDefault();
          }
        }}
      />
      <div style={footerStyle}>
        <span id="registration-jig-canvas-help">
          Drag to move · Shift-click to select more · Wheel to zoom · Space-drag to pan
        </span>
        <Button onClick={() => setView(fitJigCanvasView(project, size))}>Fit jig</Button>
        <Button onClick={() => setView(JIG_BED_VIEW)}>Fit bed</Button>
      </div>
    </div>
  );
}

function useJigCanvasWheel(args: {
  readonly ref: RefObject<HTMLCanvasElement>;
  readonly gesture: MutableRefObject<Gesture | null>;
  readonly view: ViewState;
  readonly size: { readonly width: number; readonly height: number };
  readonly project: Project;
  readonly setView: (view: ViewState) => void;
}): void {
  const { ref, gesture, view, size, project, setView } = args;
  // React registers wheel handlers as passive, so preventDefault() there cannot
  // stop the page from scrolling. Listen natively with passive: false instead.
  const onWheel = useRef<(event: WheelEvent) => void>(() => undefined);
  onWheel.current = (event) => {
    event.preventDefault();
    if (gesture.current !== null) return;
    const cursorPx = clientToCanvasPx(event, ref.current);
    if (cursorPx === null) return;
    const zoom = wheelZoomFactor(view, event.deltaY);
    setView(
      zoomAtCursorPx({
        cursorPx,
        factor: zoom / view.zoomFactor,
        canvas: size,
        bed: { width: project.device.bedWidth, height: project.device.bedHeight },
        view,
      }),
    );
  };
  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return;
    const listener = (event: WheelEvent): void => onWheel.current(event);
    canvas.addEventListener('wheel', listener, { passive: false });
    return () => canvas.removeEventListener('wheel', listener);
  }, [ref]);
}

function wheelZoomFactor(view: ViewState, deltaY: number): number {
  // A very small jig can open above the normal zoom limit. Zooming out must
  // remain gradual rather than snapping straight back to that limit.
  return Math.max(
    0.1,
    Math.min(Math.max(50, view.zoomFactor), view.zoomFactor * Math.exp(-deltaY * 0.0015)),
  );
}

type GestureArgs = RegistrationJigCanvasProps & {
  readonly ref: RefObject<HTMLCanvasElement>;
  readonly view: ViewState;
  readonly setView: (view: ViewState) => void;
  readonly setPreview: Dispatch<SetStateAction<Project | null>>;
  readonly spaceHeld: MutableRefObject<boolean>;
};

function useJigCanvasGesture(args: GestureArgs) {
  const {
    project,
    selectedIds,
    onSelectionChange,
    onCommit,
    ref,
    view,
    setView,
    setPreview,
    spaceHeld,
  } = args;
  const gesture = useRef<Gesture | null>(null);
  useEffect(() => {
    gesture.current = null;
    setPreview(null);
  }, [project, setPreview]);

  const begin = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0 && event.button !== 1) return;
    const point = canvasMouseToScene(event, ref.current, project, view);
    if (point === null) return;
    event.preventDefault();
    event.currentTarget.focus();
    const pan = event.button === 1 || spaceHeld.current;
    const hit = pan ? null : hitTest(project.scene, point);
    let nextIds = selectedIds;
    if (!pan) {
      nextIds = selectionAtHit(project, hit, selectedIds, event.shiftKey);
      onSelectionChange(nextIds);
    }
    if (!pan && (hit === null || !nextIds.has(hit))) return;
    gesture.current = {
      pointerId: event.pointerId,
      kind: pan ? 'pan' : 'move',
      start: point,
      base: project,
      selectedIds: nextIds,
      view,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const update = (event: PointerEvent<HTMLCanvasElement>): Project | null => {
    const active = gesture.current;
    if (active === null || active.pointerId !== event.pointerId || active.base !== project)
      return null;
    const point = canvasMouseToScene(event, ref.current, project, active.view);
    if (point === null) return null;
    const dx = point.x - active.start.x;
    const dy = point.y - active.start.y;
    if (active.kind === 'pan') {
      setView({ ...active.view, panX: active.view.panX + dx, panY: active.view.panY + dy });
      return null;
    }
    const next = moveJigSelection(active.base, active.selectedIds, dx, dy);
    setPreview(next);
    return next;
  };

  const end = (event: PointerEvent<HTMLCanvasElement>, cancelled: boolean): void => {
    const active = gesture.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    const next = cancelled ? null : update(event);
    gesture.current = null;
    setPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (next !== null && next !== active.base) onCommit(next);
  };

  return { gesture, begin, update, end };
}

function selectionAtHit(
  project: Project,
  hit: string | null,
  selectedIds: ReadonlySet<string>,
  additive: boolean,
): ReadonlySet<string> {
  if (hit === null) return additive ? selectedIds : new Set<string>();
  return jigSelectionForHit(project.scene, hit, selectedIds, additive);
}

function useJigCanvasPaint(
  ref: RefObject<HTMLCanvasElement>,
  displayed: Project,
  selectedIds: ReadonlySet<string>,
  size: { readonly width: number; readonly height: number },
  view: ViewState,
): void {
  const [paintRevision, setPaintRevision] = useState(0);
  const cache = useRef(createDisplayPolylineCache());
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (canvas === null || ctx == null) return;
    const frame = requestAnimationFrame(() => {
      drawScene(ctx, size.width, size.height, displayed, {
        selectedId: null,
        preview: false,
        view,
        displayPolylineCache: cache.current,
        onRasterBitmapReady: () => setPaintRevision((revision) => revision + 1),
      });
      drawSelection(ctx, displayed, selectedIds, size, view);
    });
    return () => cancelAnimationFrame(frame);
  }, [ref, displayed, selectedIds, size, view, paintRevision]);
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  project: Project,
  selectedIds: ReadonlySet<string>,
  size: { readonly width: number; readonly height: number },
  viewState: ViewState,
): void {
  const view = computeView(
    size.width,
    size.height,
    project.device.bedWidth,
    project.device.bedHeight,
    viewState,
  );
  ctx.save();
  ctx.strokeStyle = canvasTheme.selection;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  for (const object of project.scene.objects) {
    if (!selectedIds.has(object.id) || !sceneObjectHasVisibleLayer(project.scene, object)) continue;
    const bounds = transformedBBox(object);
    ctx.strokeRect(
      bounds.minX * view.scale + view.offsetX,
      bounds.minY * view.scale + view.offsetY,
      (bounds.maxX - bounds.minX) * view.scale,
      (bounds.maxY - bounds.minY) * view.scale,
    );
  }
  ctx.restore();
}

const hostStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
};
const canvasStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: 0,
  flex: 1,
  display: 'block',
  touchAction: 'none',
  background: canvasTheme.viewportSurround,
};
const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '6px 12px',
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
