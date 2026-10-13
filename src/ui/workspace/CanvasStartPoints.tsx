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
  const view = computeView(
    props.size.width,
    props.size.height,
    props.project.device.bedWidth,
    props.project.device.bedHeight,
    props.view,
  );
  const points = {
    frame: interaction.draft?.kind === 'frame' ? interaction.draft.point : plan.framePerimeter[0],
    job: interaction.draft?.kind === 'job' ? interaction.draft.point : plan.jobStart,
  };
  const near = nearbyStarts(points.frame, points.job, view.scale);
  const current = context?.sourceProject === props.project;
  return (
    <>
      {props.overlay.showStartMarkers !== false &&
        !interacting &&
        (['frame', 'job'] as const).map((kind) => {
          const point = points[kind];
          if (point === null || point === undefined) return null;
          const reason =
            context === undefined ? 'Preparing start points…' : startEditReason(kind, context);
          const disabled = busy || !current || reason !== null;
          return (
            <StartHandle
              key={kind}
              kind={kind}
              point={point}
              x={view.offsetX + point.x * view.scale}
              y={view.offsetY + point.y * view.scale}
              offset={near ? (kind === 'frame' ? -14 : 14) : 0}
              reason={busy ? 'Start points cannot change while the machine is busy.' : reason}
              disabled={disabled}
              interaction={interaction}
            />
          );
        })}
      <StartPointSettings
        project={props.project}
        context={current ? context : undefined}
        disabled={busy}
      />
    </>
  );
}

function StartHandle(props: {
  readonly kind: StartKind;
  readonly point: Vec2;
  readonly x: number;
  readonly y: number;
  readonly offset: number;
  readonly reason: string | null;
  readonly disabled: boolean;
  readonly interaction: ReturnType<typeof useStartPointInteraction>;
}): JSX.Element {
  const label = props.kind === 'frame' ? 'Frame start' : 'Job start';
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
      {props.offset !== 0 && (
        <span
          className="lf-start-connector"
          style={{ left: Math.min(0, props.offset), width: Math.abs(props.offset) }}
        />
      )}
      <button
        type="button"
        className="lf-start-handle"
        aria-label={label}
        aria-disabled={props.disabled}
        title={hint}
        style={{ left: props.offset }}
        onPointerDown={(event) => {
          if (!props.disabled) handlers.down(props.kind, props.point, event);
        }}
        onPointerMove={handlers.move}
        onPointerUp={handlers.up}
        onPointerCancel={handlers.cancel}
        onLostPointerCapture={handlers.cancel}
        onKeyDown={(event) => {
          if (!props.disabled) handlers.key(props.kind, props.point, event);
        }}
      >
        <span aria-hidden="true">{props.kind === 'frame' ? '◇' : '▶'}</span>
        <span className="lf-start-label">{label}</span>
      </button>
    </div>
  );
}

function nearbyStarts(frame: Vec2 | undefined, job: Vec2 | null, scale: number): boolean {
  return (
    frame !== undefined && job !== null && Math.hypot(frame.x - job.x, frame.y - job.y) * scale < 25
  );
}
