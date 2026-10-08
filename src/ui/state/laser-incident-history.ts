import type { LaserState } from './laser-store';
import type { SerialTranscriptEntry } from './laser-transcript';
import { controllerIncidentContext } from './controller-incident-context';
import type { JobTransportLedgerRefs } from './laser-job-transport-ledger';

const incidentKinds = new Set(['alarm', 'error', 'blocked', 'disconnect']);

export const INCIDENT_HISTORY_MAX = 500;
export type ControllerIncidentState = {
  /** Window-local diagnostics, independent of the rolling wire transcript. */
  readonly incidentHistory?: ReadonlyArray<SerialTranscriptEntry>;
};

export function isControllerIncident(entry: SerialTranscriptEntry): boolean {
  return entry.incident === true || incidentKinds.has(entry.kind);
}

export function captureIncidentEntry(
  entry: SerialTranscriptEntry,
  state: Partial<LaserState>,
  refs: JobTransportLedgerRefs = {},
): SerialTranscriptEntry {
  if (!isControllerIncident(entry) || entry.incidentContext !== undefined) return entry;
  const context = controllerIncidentContext(state, refs);
  return context === undefined
    ? entry
    : Object.freeze({ ...entry, incident: true, incidentContext: context });
}

/** Consume only the new publication delta; old transcript rows are never re-archived. */
export function retainIncidentEntries(
  history: ReadonlyArray<SerialTranscriptEntry>,
  entries: ReadonlyArray<SerialTranscriptEntry>,
): ReadonlyArray<SerialTranscriptEntry> {
  const incidents = entries.filter(isControllerIncident);
  if (incidents.length === 0) return history;
  const seen = new Set(history.map((entry) => entry.id));
  const additions = incidents.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
  return additions.length === 0 ? history : [...history, ...additions].slice(-INCIDENT_HISTORY_MAX);
}

/** Retained rows own original timestamps/context when still present in both rings. */
export function mergeIncidentTranscript(
  transcript: ReadonlyArray<SerialTranscriptEntry>,
  history: ReadonlyArray<SerialTranscriptEntry>,
): ReadonlyArray<SerialTranscriptEntry> {
  const entries = new Map(transcript.map((entry) => [entry.id, entry]));
  for (const entry of history)
    entries.set(entry.id, entry.incident === true ? entry : { ...entry, incident: true });
  return [...entries.values()].sort((a, b) => a.id - b.id);
}
