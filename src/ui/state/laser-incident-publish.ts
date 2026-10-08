import type { LaserState } from './laser-store';
import type { ControllerIncidentContext } from './controller-incident-context';
import type { JobTransportLedgerRefs } from './laser-job-transport-ledger';
import { systemTranscriptEntry, type TranscriptKind } from './laser-transcript';
import { publishTranscriptPatch, type TranscriptBufferRefs } from './laser-transcript-buffer';

type IncidentRefs = TranscriptBufferRefs & JobTransportLedgerRefs & { nextTranscriptId?: number };

/** Publish an owned diagnostic before its controller/run facts can be torn down. */
export function publishControllerIncident(
  refs: IncidentRefs,
  state: LaserState,
  raw: string,
  kind: TranscriptKind = 'error',
  logLine: string = raw,
  context?: ControllerIncidentContext,
): ReturnType<typeof publishTranscriptPatch> {
  const id = refs.nextTranscriptId ?? 1;
  refs.nextTranscriptId = id + 1;
  const entry = {
    ...systemTranscriptEntry(id, Date.now(), raw, kind),
    incident: true as const,
    ...(context === undefined ? {} : { incidentContext: context }),
  };
  return publishTranscriptPatch(refs, state, entry, logLine);
}

/** A wrapper timeout is a new occurrence, even if an older error has equal text. */
export function publishOwnedDisconnectStopFailure(
  refs: IncidentRefs & { readonly connection?: unknown },
  state: LaserState,
  connection: unknown,
  error: unknown,
): Partial<LaserState> {
  if (refs.connection !== connection) return {};
  const message = error instanceof Error ? error.message : String(error);
  return publishControllerIncident(
    refs,
    state,
    '[lf2] Controller stop before disconnect failed: ' + message,
  );
}
