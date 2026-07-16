import { cncPassPosition, type CncPassPosition } from '../state/canvas-pass-progress';
import type { CanvasMotionOverlay } from './draw-canvas-motion';

export function CanvasMotionBadge(props: {
  readonly overlay: CanvasMotionOverlay | null;
}): JSX.Element | null {
  const overlay = props.overlay;
  if (overlay === null) return null;
  const passes = overlayPassPosition(overlay);
  const message = badgeMessage(overlay, passes);
  return (
    <>
      <CanvasMotionProbe overlay={overlay} passes={passes} />
      {message === null ? null : (
        <div role="status" data-testid="canvas-motion-status" style={badgeStyle}>
          {message}
        </div>
      )}
    </>
  );
}

function CanvasMotionProbe(props: {
  readonly overlay: CanvasMotionOverlay;
  readonly passes: CncPassPosition | null;
}): JSX.Element {
  const attrs = probeAttrs(props.overlay, props.passes);
  return (
    <span
      data-testid="canvas-motion-probe"
      data-lifecycle={attrs.lifecycle}
      data-confirmed-route-mm={attrs.confirmedRouteMm}
      data-reported-head-x={attrs.headX}
      data-reported-head-y={attrs.headY}
      data-pass-current={attrs.passCurrent}
      data-pass-total={attrs.passTotal}
      data-reported-feed={attrs.feed}
      aria-label={markerDescription(props.overlay)}
      style={visuallyHiddenStyle}
    />
  );
}

type ProbeAttrs = {
  readonly lifecycle: string;
  readonly confirmedRouteMm: number;
  readonly headX: number | undefined;
  readonly headY: number | undefined;
  readonly passCurrent: number | undefined;
  readonly passTotal: number | undefined;
  readonly feed: number | undefined;
};

// One null-branch instead of an optional chain per attribute keeps the probe
// component flat and under the complexity cap as readouts accumulate.
function probeAttrs(overlay: CanvasMotionOverlay, passes: CncPassPosition | null): ProbeAttrs {
  const passCurrent = passes?.current;
  const passTotal = passes?.total;
  const run = overlay.run;
  if (run === null) {
    return {
      lifecycle: 'idle',
      confirmedRouteMm: 0,
      headX: undefined,
      headY: undefined,
      passCurrent,
      passTotal,
      feed: undefined,
    };
  }
  return {
    lifecycle: run.lifecycle,
    confirmedRouteMm: run.route.confirmedRouteMm,
    headX: run.reportedHead?.x,
    headY: run.reportedHead?.y,
    passCurrent,
    passTotal,
    feed: run.reportedFeedMmPerMin ?? undefined,
  };
}

// Pass progress follows the same confirmed-route truth as the trail: it
// advances only with reconciled motion and freezes with an uncertain route.
function overlayPassPosition(overlay: CanvasMotionOverlay): CncPassPosition | null {
  const spans = overlay.plan.cncPassSpans;
  if (spans === undefined || overlay.run === null) return null;
  return cncPassPosition(spans, overlay.run.route.confirmedRouteMm);
}

function passBadgeText(passes: CncPassPosition | null): string {
  if (passes === null) return '';
  const remaining = passes.remaining > 0 ? ` • ${passes.remaining} remaining` : '';
  return ` • Pass ${passes.current} of ${passes.total}${remaining}`;
}

// Feed is only meaningful while the machine is actively cutting: a held or
// finished run reports 0, and a stopped/disconnected run's last sample is
// stale. Restricting to 'running' keeps the readout live, never misleading.
function feedBadgeText(run: NonNullable<CanvasMotionOverlay['run']>): string {
  if (run.lifecycle !== 'running' || run.reportedFeedMmPerMin === null) return '';
  return ` • ${Math.round(run.reportedFeedMmPerMin)} mm/min`;
}

function markerDescription(overlay: CanvasMotionOverlay): string {
  const frame = overlay.plan.framePerimeter[0];
  const job = overlay.plan.jobStart;
  const frameText = frame === undefined ? 'Frame start unavailable' : 'Frame start ready';
  const jobText = job === null ? 'Job start unavailable' : 'Job start ready';
  return `${frameText}; ${jobText}`;
}

function badgeMessage(overlay: CanvasMotionOverlay, passes: CncPassPosition | null): string | null {
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
  return `${truth} • ${state}${feedBadgeText(run)}${z}${passBadgeText(passes)}${reason}${relativeLabel}`;
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
