import type { CanvasMotionOverlay } from './draw-canvas-motion';

export function CanvasMotionBadge(props: {
  readonly overlay: CanvasMotionOverlay | null;
}): JSX.Element | null {
  const overlay = props.overlay;
  if (overlay === null) return null;
  const message = badgeMessage(overlay);
  return (
    <>
      <span
        data-testid="canvas-motion-probe"
        data-lifecycle={overlay.run?.lifecycle ?? 'idle'}
        data-confirmed-route-mm={overlay.run?.route.confirmedRouteMm ?? 0}
        data-reported-head-x={overlay.run?.reportedHead?.x}
        data-reported-head-y={overlay.run?.reportedHead?.y}
        aria-label={markerDescription(overlay)}
        style={visuallyHiddenStyle}
      />
      {message === null ? null : (
        <div role="status" data-testid="canvas-motion-status" style={badgeStyle}>
          {message}
        </div>
      )}
    </>
  );
}

function markerDescription(overlay: CanvasMotionOverlay): string {
  const frame = overlay.plan.framePerimeter[0];
  const job = overlay.plan.jobStart;
  const frameText = frame === undefined ? 'Frame start unavailable' : 'Frame start ready';
  const jobText = job === null ? 'Job start unavailable' : 'Job start ready';
  return `${frameText}; ${jobText}`;
}

function badgeMessage(overlay: CanvasMotionOverlay): string | null {
  const run = overlay.run;
  const relative = overlay.plan.coordinateFrame.kind === 'relative';
  if (run === null) {
    if (relative) return 'Relative view — physical bed position unverified';
    return overlay.plan.unavailableReason;
  }
  const truth = overlay.plan.capability === 'realtime' ? 'Controller-reported' : 'Planned route';
  const state = run.controllerState ?? lifecycleLabel(run.lifecycle);
  const z =
    overlay.plan.machineKind === 'cnc' && run.reportedHead !== null
      ? ` • Z ${run.reportedHead.z.toFixed(2)} mm`
      : '';
  const reason = run.accuracyReason === null ? '' : ` • ${run.accuracyReason}`;
  const relativeLabel = relative ? ' • relative view — physical bed position unverified' : '';
  return `${truth} • ${state}${z}${reason}${relativeLabel}`;
}

function lifecycleLabel(lifecycle: NonNullable<CanvasMotionOverlay['run']>['lifecycle']): string {
  switch (lifecycle) {
    case 'tool-change':
      return 'Tool change — trail suspended';
    case 'stopped':
      return 'Stopped';
    case 'disconnected':
      return 'Disconnected';
    case 'errored':
      return 'Error';
    case 'finished':
      return 'Finished';
    case 'paused':
      return 'Paused';
    case 'running':
      return 'Running';
  }
}

const badgeStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 12,
  maxWidth: 420,
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--lf-danger)',
  background: 'var(--lf-tint-danger)',
  color: 'var(--lf-danger-fg)',
  fontSize: 12,
  fontWeight: 600,
  pointerEvents: 'none',
  zIndex: 4,
};

const visuallyHiddenStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
