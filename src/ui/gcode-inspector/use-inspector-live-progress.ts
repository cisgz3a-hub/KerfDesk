import { useEffect, useMemo, useState } from 'react';
import type { GcodeRenderModel } from '../../core/gcode-view';
import type { LiveCanvasLifecycle, LiveCanvasRun } from '../state/canvas-motion-plan';
import { canvasProgramMatchesRunQueue, canvasProgramSource } from '../state/canvas-program-source';
import { useLaserStore } from '../state/laser-store';
import type { GcodeInspectionSource } from './gcode-inspection-source';
import { inspectorPlayheadAtRoute } from './inspector-live-progress';
import { inspectorSourceMatchesProgram } from './inspector-live-source';
import type { PlayheadState } from './playhead';

export type InspectorLiveProgress = {
  readonly matched: boolean;
  readonly active: boolean;
  readonly lifecycle: LiveCanvasLifecycle | null;
  readonly playhead: PlayheadState | null;
  /** Trusted controller-reported head; distinct from the projected reveal point. */
  readonly point: PlayheadState['point'];
  /** Confirmed physical route fraction, never acknowledged-line percentage. */
  readonly progress: number | null;
  readonly activeLine: number | null;
  readonly reason: string | null;
};

export function useInspectorLiveProgress(
  model: GcodeRenderModel,
  source?: GcodeInspectionSource,
): InspectorLiveProgress {
  const run = useLaserStore((state) => state.liveCanvasRun ?? null);
  const queued = useLaserStore((state) => state.streamer?.queued ?? null);
  const connected = useLaserStore((state) => state.connection.kind === 'connected');
  const epoch = useLaserStore((state) => state.trustedPositionEpoch ?? 0);
  const plan = run?.plan ?? null;
  const text = canvasProgramSource(plan);
  const sourceMatches = useSourceMatch(source, text);
  const queueMatches = run !== null && canvasProgramMatchesRunQueue(run, queued);
  return useMemo(
    () => deriveProgress(model, run, sourceMatches && queueMatches, connected, epoch),
    [model, run, sourceMatches, queueMatches, connected, epoch],
  );
}

function useSourceMatch(source: GcodeInspectionSource | undefined, text: string | null): boolean {
  const [match, setMatch] = useState<{
    readonly source: GcodeInspectionSource;
    readonly text: string;
    readonly matches: boolean;
  } | null>(null);
  useEffect(() => {
    if (source === undefined || source.kind === 'text' || text === null) return;
    const controller = new AbortController();
    void inspectorSourceMatchesProgram(source, text, controller.signal).then(
      (matches) => {
        if (!controller.signal.aborted) setMatch({ source, text, matches });
      },
      () => {
        if (!controller.signal.aborted) setMatch({ source, text, matches: false });
      },
    );
    return () => controller.abort();
  }, [source, text]);
  if (source === undefined || text === null) return false;
  return source.kind === 'text'
    ? source.text === text
    : match?.source === source && match.text === text && match.matches;
}

function deriveProgress(
  model: GcodeRenderModel,
  run: LiveCanvasRun | null,
  matched: boolean,
  connected: boolean,
  epoch: number,
): InspectorLiveProgress {
  const unavailable: InspectorLiveProgress = {
    matched: false,
    active: false,
    lifecycle: null,
    playhead: null,
    point: null,
    progress: null,
    activeLine: null,
    reason: run === null ? 'No machine run to follow.' : 'This view is not the started program.',
  };
  if (!matched || run === null) return unavailable;
  const realtime = run.plan.capability === 'realtime';
  const playhead = realtime
    ? inspectorPlayheadAtRoute(model, run.plan.manifest, run.route.confirmedRouteMm)
    : null;
  const sameReference = run.plan.positionEpoch === epoch;
  const active = connected && ['running', 'paused', 'tool-change'].includes(run.lifecycle);
  const trusted = mayFollowPosition(run, active, sameReference, playhead);
  return {
    matched: true,
    active,
    lifecycle: run.lifecycle,
    playhead,
    point: trusted ? run.reportedHead : null,
    progress: realtime ? routeFraction(run) : null,
    activeLine: playhead === null ? null : (model.segLine[playhead.segmentIndex] ?? null),
    reason: progressReason(run, { connected, sameReference, realtime, playhead }),
  };
}

function mayFollowPosition(
  run: LiveCanvasRun,
  connected: boolean,
  sameReference: boolean,
  playhead: PlayheadState | null,
): boolean {
  return (
    connected &&
    sameReference &&
    !run.route.uncertain &&
    run.reportedHead !== null &&
    playhead !== null
  );
}

function routeFraction(run: LiveCanvasRun): number {
  const total = run.plan.manifest.totalRouteMm;
  return total <= 0 ? 0 : Math.max(0, Math.min(1, run.route.confirmedRouteMm / total));
}

function progressReason(
  run: LiveCanvasRun,
  state: {
    readonly connected: boolean;
    readonly sameReference: boolean;
    readonly realtime: boolean;
    readonly playhead: PlayheadState | null;
  },
): string | null {
  if (!state.connected) return 'Disconnected; showing the last confirmed progress.';
  if (!state.sameReference)
    return 'Position reference changed; showing the last confirmed progress.';
  if (!state.realtime) return run.plan.unavailableReason ?? 'Live route progress is unavailable.';
  if (run.accuracyReason !== null) return run.accuracyReason;
  if (run.route.uncertain) return 'Route match uncertain; showing the last confirmed progress.';
  if (run.reportedHead === null) return 'Waiting for confirmed machine position.';
  if (state.playhead === null)
    return 'This move uses a different initial position from the preview.';
  return null;
}
