// Why KerfDesk itself stopped a run (ADR-341 Amendment 3). Abort and the page
// closing both mark the stream errored before the reset byte goes out, with no
// safety notice, so the checkpoint tracker used to record every one of them as
// "The job stream ended unexpectedly." The request is keyed by the stream
// epoch, so it never describes a later run.

export type JobStopReason = 'operator' | 'app-closing';

export type JobStopRequest = {
  readonly reason: JobStopReason;
  readonly streamerEpoch: number;
};

/** The stop request for the current stream, if KerfDesk was asked to stop it. */
export function currentJobStopRequest(state: {
  readonly jobStopRequest?: JobStopRequest | null;
  readonly streamerEpoch: number;
}): JobStopRequest | null {
  const request = state.jobStopRequest ?? null;
  return request !== null && request.streamerEpoch === state.streamerEpoch ? request : null;
}

export function jobStopRequestMessage(reason: JobStopReason): string {
  return reason === 'app-closing'
    ? 'KerfDesk was closed or reloaded while the job was running and sent a stop to the controller. The stop may not have arrived before the page closed.'
    : 'Stopped by the operator (Abort).';
}
