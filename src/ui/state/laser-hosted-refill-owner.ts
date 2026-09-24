import type { SerialConnection } from '../../platform/types';
import type { LaserState } from './laser-store';

type HostedRefillContext = {
  readonly get: () => LaserState;
  readonly refs: {
    readonly connection?: SerialConnection | null;
    readonly writeEpoch?: number;
  };
};

/** Read the current ledger only while the run that requested handover still
 * owns this controller. ACKs can advance it before the ready barrier arrives. */
export function captureHostedRefillStream(context: HostedRefillContext) {
  const { get, refs } = context;
  const { controllerSessionEpoch, streamerEpoch, activeRunId } = get();
  const connection = refs.connection;
  const writeEpoch = refs.writeEpoch ?? 0;
  return () => {
    const state = get();
    return refs.connection === connection &&
      (refs.writeEpoch ?? 0) === writeEpoch &&
      state.controllerSessionEpoch === controllerSessionEpoch &&
      state.streamerEpoch === streamerEpoch &&
      state.activeRunId === activeRunId
      ? state.streamer
      : null;
  };
}
