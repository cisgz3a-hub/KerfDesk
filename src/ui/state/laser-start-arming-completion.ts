import type { SerialConnection } from '../../platform/types';
import { beginPostJobSettle } from './laser-post-job-settle';
import { streamWriteOwner, type StreamWriteOwner } from './laser-stream-heartbeat-containment';
import type { LaserState } from './laser-store';

type StartContext = {
  readonly set: Parameters<typeof beginPostJobSettle>[0];
  readonly get: Parameters<typeof beginPostJobSettle>[1];
  readonly refs: Parameters<typeof beginPostJobSettle>[2] & {
    readonly connection?: SerialConnection | null;
  };
  readonly safeWrite: Parameters<typeof beginPostJobSettle>[3];
};

// The operation's phase object changes during live-status preparation. Keep
// ownership outside it so an older continuation cannot clear a newer Start.
const reservations = new WeakMap<object, object>();

export function createStartArmingCompletion(context: StartContext) {
  const { set, get, refs, safeWrite } = context;
  const token = {};
  const connection = refs.connection;
  const writeEpoch = refs.writeEpoch ?? 0;
  let owner = streamWriteOwner(get());
  let runId: string | null | undefined;
  let accepted = false;
  reservations.set(refs, token);

  const ownsCurrent = (state: LaserState = get()): boolean =>
    reservations.get(refs) === token &&
    refs.connection === connection &&
    (refs.writeEpoch ?? 0) === writeEpoch &&
    state.controllerSessionEpoch === owner.controllerSessionEpoch &&
    state.streamerEpoch === owner.streamerEpoch &&
    (runId === undefined || state.activeRunId === runId);

  return {
    ownsCurrent,
    assertCurrent: (): void => {
      if (!ownsCurrent())
        throw new Error('The controller or Start reservation changed before transmission.');
    },
    streamStarted: (streamOwner: StreamWriteOwner, activeRunId: string | null): void => {
      owner = streamOwner;
      runId = activeRunId;
    },
    accept: (): void => {
      accepted = true;
    },
    finish: (): void => {
      let released = false;
      set((state) => {
        if (!ownsCurrent(state) || state.controllerOperation?.kind !== 'start-arming') return state;
        released = true;
        return { controllerOperation: null };
      });
      // A tiny program can receive its final ACK while the first write or the
      // hosted handover is still pending. Its earlier ACK handler could not
      // settle while Start owned the operation. Retry only after accepted
      // handoff, retaining the normal marker and two fresh Idle requirements.
      if (released && accepted && ownsCurrent() && get().connection.kind === 'connected') {
        beginPostJobSettle(set, get, refs, safeWrite);
      }
      if (reservations.get(refs) === token) reservations.delete(refs);
    },
  };
}
