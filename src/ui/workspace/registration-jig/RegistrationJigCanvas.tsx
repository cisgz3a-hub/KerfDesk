import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type RefObject,
  type MutableRefObject,
} from 'react';
import { findRegistrationBoxes, type Project } from '../../../core/scene';
import { Button } from '../../kit';
import { canvasTheme } from '../../theme/canvas-theme';
import { useCanvasBitmapSize } from '../use-canvas-bitmap-size';
import {
  canvasMouseToScene,
  clientToCanvasPx,
  zoomAtCursorPx,
  type ViewState,
} from '../view-transform';
import { useJigCanvasPaint } from './jig-canvas-paint';
import { fitJigCanvasView, JIG_BED_VIEW } from './jig-canvas-view';
import { jigOutlineAt } from './fit-jig-artwork';
import { isJigArtworkFile } from './JigArtworkImport';
import { useJigCanvasGesture, type JigGesture } from './use-jig-canvas-gesture';

export type RegistrationJigCanvasProps = {
  readonly project: Project;
  readonly selectedIds: ReadonlySet<string>;
  /** Changes when the outline layout is rebuilt; the view then refits to it. */
  readonly fitRequest?: number;
  readonly onSelectionChange: (ids: ReadonlySet<string>) => void;
  readonly onCommit: (project: Project) => void;
  /** Artwork files dropped on the canvas, with the outline under the drop point. */
  readonly onDropFiles?: (files: ReadonlyArray<File>, outlineId: string | null) => void;
};

const CANVAS_HELP =
  'Drag to move · Handles resize (Shift: free) and rotate (Shift: 15°) · Drag empty space to box-select · Shift-click to select more · Ctrl+A selects all artwork · Wheel to zoom · Space-drag to pan · Drop artwork files on an outline';

export function RegistrationJigCanvas(props: RegistrationJigCanvasProps): JSX.Element {
  const { project, selectedIds } = props;
  const ref = useRef<HTMLCanvasElement>(null);
  const size = useCanvasBitmapSize(ref);
  // Use the measured viewport as it becomes available, without chasing objects
  // as the user edits them. Panning/zooming takes ownership until Fit jig is used
  // or the layout is rebuilt, which can grow the grid well past the old view.
  const [fit, setFit] = useState({ request: props.fitRequest, project });
  const [manualView, setView] = useState<ViewState | null>(null);
  if (fit.request !== props.fitRequest) {
    setFit({ request: props.fitRequest, project });
    setView(null);
  }
  const view = manualView ?? fitJigCanvasView(fit.project, size);
  const [preview, setPreview] = useState<Project | null>(null);
  const [dropOutlineId, setDropOutlineId] = useState<string | null>(null);
  const spaceHeld = useRef(false);
  const { gesture, marquee, notice, cancel, begin, update, end } = useJigCanvasGesture({
    ...props,
    ref,
    view,
    setView,
    setPreview,
    spaceHeld,
  });
  useJigCanvasPaint(ref, preview ?? project, { selectedIds, marquee, dropOutlineId }, size, view);
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
        onLostPointerCapture={cancel}
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
        {...jigCanvasDropHandlers(props.onDropFiles, project, view, setDropOutlineId)}
      />
      <div style={footerStyle}>
        <span id="registration-jig-canvas-help" role="status">
          {notice === '' ? CANVAS_HELP : notice}
        </span>
        <Button onClick={() => setView(fitJigCanvasView(project, size))}>Fit jig</Button>
        <Button onClick={() => setView(JIG_BED_VIEW)}>Fit bed</Button>
      </div>
    </div>
  );
}

// Artwork files dropped on the canvas go to the outline under the drop point,
// which is highlighted while files are dragged over it.
function jigCanvasDropHandlers(
  onDropFiles: RegistrationJigCanvasProps['onDropFiles'],
  project: Project,
  view: ViewState,
  setDropOutlineId: (id: string | null) => void,
): Pick<React.DOMAttributes<HTMLCanvasElement>, 'onDragOver' | 'onDragLeave' | 'onDrop'> {
  const outlineAt = (event: DragEvent<HTMLCanvasElement>): string | null => {
    const point = canvasMouseToScene(event, event.currentTarget, project, view);
    const outlines = findRegistrationBoxes(project.scene);
    const index = point === null ? -1 : jigOutlineAt(outlines, point);
    return outlines[index]?.id ?? null;
  };
  return {
    onDragOver: (event) => {
      if (onDropFiles === undefined) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      const carriesFiles = Array.from(event.dataTransfer.types).includes('Files');
      setDropOutlineId(carriesFiles ? outlineAt(event) : null);
    },
    onDragLeave: () => setDropOutlineId(null),
    onDrop: (event) => {
      event.preventDefault();
      event.stopPropagation();
      setDropOutlineId(null);
      const files = Array.from(event.dataTransfer.files).filter(isJigArtworkFile);
      if (onDropFiles === undefined || files.length === 0) return;
      onDropFiles(files, outlineAt(event));
    },
  };
}

function useJigCanvasWheel(args: {
  readonly ref: RefObject<HTMLCanvasElement>;
  readonly gesture: MutableRefObject<JigGesture | null>;
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
