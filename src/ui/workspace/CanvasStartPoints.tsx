import { useLayoutEffect, useRef, useState } from 'react';
import type { Project, Vec2 } from '../../core/scene';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { canvasTheme } from '../theme/canvas-theme';
import type { CanvasMotionOverlay } from './draw-canvas-motion';
import { startEditingContext, startEditReason, type StartKind } from './canvas-start-editing';
import { startEditingBusy, useStartPointInteraction } from './start-point-interaction';
import { StartPointSettings } from './StartPointSettings';
import { computeView, type ViewState } from './view-transform';
import type { CanvasBitmapSize } from './use-canvas-bitmap-size';
import { layoutStartHandles, layoutStartLabel, type StartLayoutRect } from './canvas-start-layout';
import { useStartChromeRects } from './use-start-chrome-rects';
import './canvas-start-points.css';

type Props = {
  readonly canvas: React.RefObject<HTMLCanvasElement | null>;
  readonly project: Project;
  readonly view: ViewState;
  readonly size: CanvasBitmapSize;
  readonly overlay: CanvasMotionOverlay | null;
};

export function CanvasStartPoints(props: Props): JSX.Element | null {
  const epoch = useStore((state) => state.projectDocumentEpoch);
  if (props.overlay === null) return null;
  return (
    <>
      <StartPoints key={epoch} {...props} overlay={props.overlay} />
    </>
  );
}

function StartPoints(props: Props & { readonly overlay: CanvasMotionOverlay }): JSX.Element {
  const { plan } = props.overlay;
  const context =
    props.overlay.planIsCurrent === false ? undefined : startEditingContext(plan, props.project);
  const laserBusy = useLaserStore(() => startEditingBusy());
  const preparingFrame = useFramePreparationStore((state) => state.pending);
  const busy = laserBusy || preparingFrame;
  const interacting = useStore((state) => state.pendingUndo !== null);
  const interaction = useStartPointInteraction({ ...props, plan, context });
  const chrome = useStartChromeRects(props.canvas, props.size);
  const view = computeView(
    props.size.width,
    props.size.height,
    props.project.device.bedWidth,
    props.project.device.bedHeight,
    props.view,
  );
  const points = displayedStartPoints(plan, interaction);
  const screenPoint = (point: Vec2) => ({
    x: view.offsetX + point.x * view.scale,
    y: view.offsetY + point.y * view.scale,
  });
  const handles = layoutStartHandles(
    {
      ...(points.frame === undefined ? {} : { frame: screenPoint(points.frame) }),
      ...(points.job === null ? {} : { job: screenPoint(points.job) }),
    },
    props.size,
    chrome,
  );
  const current = context?.sourceProject === props.project;
  return (
    <>
      {props.overlay.showStartMarkers !== false &&
        !interacting &&
        (['frame', 'job'] as const).map((kind) => {
          const point = points[kind];
          const handle = handles[kind];
          if (point === null || point === undefined || handle === undefined) return null;
          const reason =
            context === undefined ? 'Preparing start points…' : startEditReason(kind, context);
          const disabled = busy || !current || reason !== null;
          return (
            <StartHandle
              key={kind}
              kind={kind}
              point={point}
              x={screenPoint(point).x}
              y={screenPoint(point).y}
              handle={handle}
              viewport={props.size}
              chrome={[...chrome, ...Object.values(handles)]}
              reason={busy ? 'Start points cannot change while the machine is busy.' : reason}
              disabled={disabled}
              interaction={interaction}
            />
          );
        })}
      <StartPointSettings
        project={props.project}
        context={current ? context : undefined}
        disabled={busy || interacting}
      />
    </>
  );
}

function displayedStartPoints(
  plan: CanvasMotionOverlay['plan'],
  interaction: ReturnType<typeof useStartPointInteraction>,
) {
  return {
    frame:
      interaction.draft?.kind === 'frame'
        ? interaction.draft.point
        : (interaction.keyboardPoint('frame') ?? plan.framePerimeter[0]),
    job:
      interaction.draft?.kind === 'job'
        ? interaction.draft.point
        : (interaction.keyboardPoint('job') ?? plan.jobStart),
  };
}

function useStartLabelSize() {
  const labelRef = useRef<HTMLSpanElement>(null);
  const [labelSize, setLabelSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = labelRef.current;
    if (node === null) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setLabelSize((old) =>
        old.width === rect.width && old.height === rect.height
          ? old
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, []);
  return { labelRef, labelSize };
}

function StartHandle(props: {
  readonly kind: StartKind;
  readonly point: Vec2;
  readonly x: number;
  readonly y: number;
  readonly handle: StartLayoutRect;
  readonly viewport: CanvasBitmapSize;
  readonly chrome: ReadonlyArray<StartLayoutRect>;
  readonly reason: string | null;
  readonly disabled: boolean;
  readonly interaction: ReturnType<typeof useStartPointInteraction>;
}): JSX.Element {
  const label = props.kind === 'frame' ? 'Frame start' : 'Job start';
  const { labelRef, labelSize } = useStartLabelSize();
  const labelBox = layoutStartLabel(
    props.kind,
    props.handle,
    labelSize,
    props.viewport,
    props.chrome,
  );
  const dx = props.handle.x + props.handle.width / 2 - props.x;
  const dy = props.handle.y + props.handle.height / 2 - props.y;
  const hint =
    props.reason ?? `${label}: drag to choose a start; arrow keys move 1 mm, Shift moves 10 mm.`;
  const handlers = props.interaction;
  return (
    <div
      className={`lf-start-anchor lf-start-anchor--${props.kind}`}
      style={{
        left: props.x,
        top: props.y,
        color: props.kind === 'frame' ? canvasTheme.frameStart : canvasTheme.jobStart,
      }}
    >
      {(dx !== 0 || dy !== 0) && (
        <span
          className="lf-start-connector"
          style={{ width: Math.hypot(dx, dy), transform: `rotate(${Math.atan2(dy, dx)}rad)` }}
        />
      )}
      <button
        type="button"
        className="lf-start-handle"
        aria-label={label}
        aria-disabled={props.disabled && !props.interaction.keyboardReady(props.kind)}
        title={hint}
        style={{ left: dx, top: dy, pointerEvents: props.disabled ? 'none' : undefined }}
        onPointerDown={(event) => {
          if (!props.disabled) handlers.down(props.kind, props.point, event);
        }}
        onPointerMove={handlers.move}
        onPointerUp={handlers.up}
        onPointerCancel={handlers.cancel}
        onLostPointerCapture={handlers.cancel}
        onKeyDown={(event) => {
          handlers.key(props.kind, props.point, event, props.disabled);
        }}
      >
        <span aria-hidden="true">{props.kind === 'frame' ? '◇' : '▶'}</span>
        <span
          ref={labelRef}
          className="lf-start-label"
          style={{
            left: labelBox.x - props.handle.x,
            top: labelBox.y - props.handle.y,
            maxWidth: Math.max(0, props.viewport.width - 8),
          }}
        >
          {label}
        </span>
      </button>
    </div>
  );
}
