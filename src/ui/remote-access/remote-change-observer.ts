import { useLaserStore } from '../state/laser-store';

export type RemoteMachineEvent = 'job.finished' | 'job.stopped' | 'machine.alarm';
export type RemoteObservation = {
  readonly observed: { readonly revision: string; readonly machineSeq: number };
  readonly events: readonly RemoteMachineEvent[];
};
type Laser = ReturnType<typeof useLaserStore.getState>;

/**
 * ADR-582/583: a monotonic machine-status sequence and kind-only job events. Nothing here
 * carries artwork, file names, positions or messages; the relay only learns that something
 * changed and clients then read the ordinary bounded projections.
 */
export function createRemoteChangeObserver(revision: () => string) {
  let machineSeq = 0;
  let key = machineKey(useLaserStore.getState());
  const events: RemoteMachineEvent[] = [];
  const unsubscribe = useLaserStore.subscribe((state, previous) => {
    const next = machineKey(state);
    if (next !== key) {
      key = next;
      machineSeq += 1;
    }
    const event = machineEvent(state, previous);
    if (event !== null && events.length < 8) events.push(event);
  });
  return {
    take: (): RemoteObservation => ({
      observed: { revision: revision(), machineSeq },
      events: events.splice(0, events.length),
    }),
    dispose: unsubscribe,
  };
}

/** Whole-percent progress, so a running job changes the key at most 100 times. */
function progressKey(stream: Laser['streamer']): string {
  if (stream === null || stream.queued.length === 0) return '';
  return Math.floor((stream.completed / stream.queued.length) * 100).toString();
}
function machineKey(state: Laser): string {
  const report = state.statusReport;
  return [
    state.connection.kind,
    report?.state,
    report === null ? '' : `${point(report.mPos)};${point(report.wPos)}`,
    state.streamer?.status,
    progressKey(state.streamer),
    state.motionOperation?.kind,
    state.controllerOperation?.kind,
    state.homingState,
    state.activeWcs,
  ]
    .map((part) => part ?? '')
    .join('|');
}
function point(value: { x: number; y: number; z: number } | null): string {
  return value === null
    ? ''
    : `${Math.round(value.x * 100)},${Math.round(value.y * 100)},${Math.round(value.z * 100)}`;
}
const RUNNING = new Set(['streaming', 'paused', 'tool-change']);
const ENDED: Record<string, RemoteMachineEvent> = {
  done: 'job.finished',
  cancelled: 'job.stopped',
  errored: 'job.stopped',
  disconnected: 'job.stopped',
};
function machineEvent(state: Laser, previous: Laser): RemoteMachineEvent | null {
  if (state.statusReport?.state === 'Alarm' && previous.statusReport?.state !== 'Alarm')
    return 'machine.alarm';
  const before = previous.streamer?.status ?? '';
  const after = state.streamer?.status ?? '';
  return before !== after && RUNNING.has(before) ? (ENDED[after] ?? null) : null;
}
