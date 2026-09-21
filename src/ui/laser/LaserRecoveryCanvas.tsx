import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { mapControllerPointToScene, type CanvasMotionPlan } from '../state/canvas-motion-plan';
import {
  acknowledgedRecoveryMovement,
  firstRecoveryMovement,
  pickRecoveryMovement,
  recoveryPreviewBounds,
  recoveryPreviewPath,
  zoomRecoveryPreview,
  type RecoveryPreviewView,
} from './laser-recovery-picker-model';

type Props = {
  readonly plan: CanvasMotionPlan;
  readonly ackedLines: number;
  readonly fromLine: number | undefined;
  readonly disabled: boolean;
  readonly onSelect: (line: number) => void;
};

export function LaserRecoveryCanvas(props: Props): JSX.Element {
  const fit = useMemo(() => {
    // Older archives can have a marker-only canvas plan. A missing optional
    // preview must not prevent numeric recovery of their sealed G-code.
    if (
      !Array.isArray(props.plan.manifest?.blocks) ||
      props.plan.device === undefined ||
      props.plan.coordinateFrame === undefined
    )
      return null;
    return recoveryPreviewBounds(props.plan);
  }, [props.plan]);
  if (fit === null || props.plan.capability === 'unavailable') {
    return (
      <p style={hintStyle}>
        A positioned route preview is unavailable for this saved job. Use its original G-code line
        numbers below.
      </p>
    );
  }
  return <RecoveryViewport {...props} fit={fit} />;
}

function RecoveryViewport(props: Props & { readonly fit: RecoveryPreviewView }): JSX.Element {
  const [view, setView] = useState(props.fit);
  const [missed, setMissed] = useState(false);
  const ref = useRef<SVGSVGElement | null>(null);
  const route = useMemo(() => recoveryPreviewPath(props.plan, view), [props.plan, view]);
  const preferred = useMemo(
    () => acknowledgedRecoveryMovement(props.plan, props.ackedLines),
    [props.plan, props.ackedLines],
  );
  const pick = (event: PointerEvent<SVGSVGElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const line = pickRecoveryMovement(
      props.plan,
      {
        x: view.x + ((event.clientX - rect.left) / rect.width) * view.width,
        y: view.y + ((event.clientY - rect.top) / rect.height) * view.height,
      },
      (view.width / rect.width) * 10,
      props.fromLine ?? preferred,
    );
    setMissed(line === null);
    if (line !== null) props.onSelect(line);
  };
  const handlers = usePreviewNavigation({
    ref,
    view,
    setView,
    fit: props.fit,
    disabled: props.disabled,
    pick,
  });
  return (
    <div>
      <PreviewZoomControls
        disabled={props.disabled}
        view={view}
        fit={props.fit}
        setView={setView}
      />
      <svg
        ref={ref}
        role="img"
        aria-label="Laser recovery canvas: zoom, then click an engraved movement to choose its restart line"
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        preserveAspectRatio="none"
        style={canvasStyle}
        {...handlers}
      >
        <path
          d={route.path}
          fill="none"
          stroke="var(--lf-text-muted)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <SelectedRecoveryMovement plan={props.plan} fromLine={props.fromLine} view={view} />
      </svg>
      <p style={hintStyle}>
        Scroll or use +/− to zoom. Drag to pan; click a burn line to select it. The circle marks the
        beam-off entry at the beginning of that movement. Clicking only selects; Start is separate.
        {route.sampled
          ? ' Overview detail is reduced for this large job; zoom in for more detail. Selection uses the complete saved route.'
          : ''}
      </p>
      {missed ? (
        <p role="status" style={hintStyle}>
          Click closer to an engraved movement, or enter its G-code line.
        </p>
      ) : null}
    </div>
  );
}

function SelectedRecoveryMovement(props: {
  readonly plan: CanvasMotionPlan;
  readonly fromLine: number | undefined;
  readonly view: RecoveryPreviewView;
}): JSX.Element | null {
  const block =
    props.fromLine === undefined ? null : firstRecoveryMovement(props.plan, props.fromLine);
  const start = block?.points[0];
  if (block === null || start === undefined) return null;
  const first = mapControllerPointToScene(start, props.plan);
  const points = block.points
    .map((point) => {
      const scene = mapControllerPointToScene(point, props.plan);
      return `${scene.x},${scene.y}`;
    })
    .join(' ');
  return (
    <g data-testid="selected-recovery-movement" data-raw-line={block.rawLineIndex + 1}>
      <polyline
        points={points}
        fill="none"
        stroke="var(--lf-accent)"
        strokeWidth={3}
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={first.x}
        cy={first.y}
        r={props.view.width / 100}
        fill="var(--lf-bg)"
        stroke="var(--lf-accent)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      <title>
        Beam-off entry at X {first.x.toFixed(3)}, Y {first.y.toFixed(3)}; selected movement line{' '}
        {block.rawLineIndex + 1}
      </title>
    </g>
  );
}

function PreviewZoomControls(props: {
  readonly disabled: boolean;
  readonly view: RecoveryPreviewView;
  readonly fit: RecoveryPreviewView;
  readonly setView: (view: RecoveryPreviewView) => void;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 5, margin: '7px 0' }}>
      <button
        type="button"
        disabled={props.disabled}
        aria-label="Zoom in recovery canvas"
        title="Magnify the saved route to choose a restart movement more precisely."
        onClick={() => props.setView(zoomRecoveryPreview(props.view, props.fit, 0.5))}
      >
        +
      </button>
      <button
        type="button"
        disabled={props.disabled}
        aria-label="Zoom out recovery canvas"
        title="Show more of the saved route around the restart point."
        onClick={() => props.setView(zoomRecoveryPreview(props.view, props.fit, 2))}
      >
        −
      </button>
      <button
        type="button"
        disabled={props.disabled}
        title="Fit the complete saved job in the recovery canvas."
        onClick={() => props.setView(props.fit)}
      >
        Fit saved job
      </button>
    </div>
  );
}

type NavigationArgs = {
  readonly ref: React.RefObject<SVGSVGElement | null>;
  readonly view: RecoveryPreviewView;
  readonly fit: RecoveryPreviewView;
  readonly disabled: boolean;
  readonly setView: React.Dispatch<React.SetStateAction<RecoveryPreviewView>>;
  readonly pick: (event: PointerEvent<SVGSVGElement>) => void;
};

function usePreviewNavigation(args: NavigationArgs) {
  const { ref, fit, disabled, setView } = args;
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    moved: boolean;
    view: RecoveryPreviewView;
  } | null>(null);
  useEffect(() => {
    const svg = ref.current;
    if (svg === null) return;
    const wheel = (event: WheelEvent): void => {
      if (disabled) return;
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const anchor = {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
      };
      setView((view) => zoomRecoveryPreview(view, fit, event.deltaY < 0 ? 0.8 : 1.25, anchor));
    };
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => svg.removeEventListener('wheel', wheel);
  }, [ref, fit, disabled, setView]);
  return {
    onPointerDown: (event: PointerEvent<SVGSVGElement>) => {
      if (args.disabled || event.button !== 0 || drag.current !== null) return;
      drag.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
        view: args.view,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<SVGSVGElement>) => {
      const start = drag.current;
      if (args.disabled || start === null || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      start.moved ||= Math.hypot(dx, dy) > 4;
      if (!start.moved) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      args.setView({
        ...start.view,
        x: start.view.x - (dx * start.view.width) / rect.width,
        y: start.view.y - (dy * start.view.height) / rect.height,
      });
    },
    onPointerUp: (event: PointerEvent<SVGSVGElement>) => {
      const start = drag.current;
      if (start !== null && start.id !== event.pointerId) return;
      drag.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      if (!args.disabled && start !== null && !start.moved) args.pick(event);
    },
    onPointerCancel: () => {
      drag.current = null;
    },
    onLostPointerCapture: () => {
      drag.current = null;
    },
  };
}

const canvasStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  aspectRatio: '2 / 1',
  background: 'var(--lf-bg)',
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  cursor: 'crosshair',
  touchAction: 'none',
};
const hintStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 11,
  lineHeight: 1.5,
  margin: '6px 0',
};
