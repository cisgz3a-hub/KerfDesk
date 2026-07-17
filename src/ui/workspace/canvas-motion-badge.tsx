import { useEffect, useState } from 'react';
import { formatDuration } from '../../core/job';
import { cncPassPosition, type CncPassPosition } from '../state/canvas-pass-progress';
import type { CanvasMotionOverlay } from './draw-canvas-motion';

const ELAPSED_TICK_MS = 1_000;

export function CanvasMotionBadge(props: {
  readonly overlay: CanvasMotionOverlay | null;
}): JSX.Element | null {
  const overlay = props.overlay;
  const nowMs = useElapsedTick(overlay);
  if (overlay === null) return null;
  const passes = overlayPassPosition(overlay);
  const message = badgeMessage(overlay, passes, nowMs);
  return (
    <>
      <CanvasMotionProbe overlay={overlay} passes={passes} nowMs={nowMs} />
      {message === null ? null : (
        <div role="status" data-testid="canvas-motion-status" style={badgeStyle}>
          {message}
        </div>
      )}
    </>
  );
}

// Status frames alone can be sparse (settle-only controllers report only at
// motion boundaries), so an active timed run re-renders once a second to keep
// the elapsed readout moving. The interval exists only while it can change
// the display: a run with a real start stamp and no frozen end stamp.
function useElapsedTick(overlay: CanvasMotionOverlay | null): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const run = overlay?.run ?? null;
  const ticking = run !== null && run.startedAtMs > 0 && run.endedAtMs === null;
  useEffect(() => {
    if (!ticking) return undefined;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), ELAPSED_TICK_MS);
    return () => window.clearInterval(timer);
  }, [ticking]);
  return nowMs;
}

function CanvasMotionProbe(props: {
  readonly overlay: CanvasMotionOverlay;
  readonly passes: CncPassPosition | null;
  readonly nowMs: number;
}): JSX.Element {
  const attrs = probeAttrs(props.overlay, props.passes, props.nowMs);
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
      data-reported-spindle={attrs.spindle}
      data-elapsed-seconds={attrs.elapsedSeconds}
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
  readonly spindle: number | undefined;
  readonly elapsedSeconds: number | undefined;
};

// One null-branch instead of an optional chain per attribute keeps the probe
// component flat and under the complexity cap as readouts accumulate.
function probeAttrs(
  overlay: CanvasMotionOverlay,
  passes: CncPassPosition | null,
  nowMs: number,
): ProbeAttrs {
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
      spindle: undefined,
      elapsedSeconds: undefined,
    };
  }
  const elapsed = elapsedRunSeconds(run, nowMs);
  return {
    lifecycle: run.lifecycle,
    confirmedRouteMm: run.route.confirmedRouteMm,
    headX: run.reportedHead?.x,
    headY: run.reportedHead?.y,
    passCurrent,
    passTotal,
    feed: run.reportedFeedMmPerMin ?? undefined,
    spindle: run.reportedSpindleRpm ?? undefined,
    elapsedSeconds: elapsed ?? undefined,
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

// The `FS:` spindle field is RPM only on a router; a laser reports its power S
// value in the same slot, so the RPM readout is CNC-only (ADR-220). Shown only
// while running, mirroring the feed readout.
function spindleBadgeText(
  overlay: CanvasMotionOverlay,
  run: NonNullable<CanvasMotionOverlay['run']>,
): string {
  if (overlay.plan.machineKind !== 'cnc') return '';
  if (run.lifecycle !== 'running' || run.reportedSpindleRpm === null) return '';
  return ` • ${Math.round(run.reportedSpindleRpm)} rpm`;
}

// Wall-clock elapsed since Start, including holds/tool changes, frozen at the
// run's first terminal transition. Null without a real start stamp — a
// missing timer is honest, a made-up one is not (ADR-221).
function elapsedRunSeconds(
  run: NonNullable<CanvasMotionOverlay['run']>,
  nowMs: number,
): number | null {
  if (run.startedAtMs <= 0) return null;
  const endMs = run.endedAtMs ?? nowMs;
  return Math.max(0, Math.round((endMs - run.startedAtMs) / 1000));
}

function elapsedBadgeText(run: NonNullable<CanvasMotionOverlay['run']>, nowMs: number): string {
  const seconds = elapsedRunSeconds(run, nowMs);
  return seconds === null ? '' : ` • ${formatDuration(seconds)}`;
}

function markerDescription(overlay: CanvasMotionOverlay): string {
  const frame = overlay.plan.framePerimeter[0];
  const job = overlay.plan.jobStart;
  const frameText = frame === undefined ? 'Frame start unavailable' : 'Frame start ready';
  const jobText = job === null ? 'Job start unavailable' : 'Job start ready';
  return `${frameText}; ${jobText}`;
}

function badgeMessage(
  overlay: CanvasMotionOverlay,
  passes: CncPassPosition | null,
  nowMs: number,
): string | null {
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
  // A running origin-anchored job can intentionally use the artwork-relative
  // frame when the machine has no trusted absolute bed coordinates. Its live
  // beam/trail is still controller-reconciled in the job frame, so repeating
  // the idle bed-position warning here incorrectly makes a valid run look
  // unverified. Any real live-position limitation is already carried by the
  // plan capability and accuracy reason.
  return `${truth} • ${state}${elapsedBadgeText(run, nowMs)}${feedBadgeText(run)}${spindleBadgeText(overlay, run)}${z}${passBadgeText(passes)}${reason}`;
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
