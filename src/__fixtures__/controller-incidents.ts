import type { LaserState } from '../ui/state/laser-store';
import { useLaserStore } from '../ui/state/laser-store';
import { initialLaserState } from '../ui/state/laser-store-helpers';
import type { SerialTranscriptEntry } from '../ui/state/laser-transcript';

// Narrow prospective fields let regression tests collect before the D1
// production change, without importing a helper that does not yet exist.
export type IncidentEntry = Omit<SerialTranscriptEntry, 'kind'> & {
  readonly kind: SerialTranscriptEntry['kind'] | 'disconnect';
};
export type IncidentState = LaserState & {
  readonly incidentHistory?: ReadonlyArray<IncidentEntry>;
  readonly clearIncidentHistory?: () => void;
};

export const INCIDENT_AT = Date.parse('2026-10-07T08:00:00.000Z');
export const SAFETY_NOTICE = {
  kind: 'disconnect-during-job',
  message: 'Check the physical machine before continuing.',
} as const;

export function incidentEntry(id: number, overrides: Partial<IncidentEntry> = {}): IncidentEntry {
  return {
    id,
    at: INCIDENT_AT + id,
    direction: 'in',
    source: 'controller',
    kind: 'alarm',
    raw: `ALARM:${id}`,
    ...overrides,
  };
}

export function incidentHistory(
  state:
    | LaserState
    | { readonly incidentHistory?: ReadonlyArray<IncidentEntry> } = useLaserStore.getState(),
) {
  return (
    (state as { readonly incidentHistory?: ReadonlyArray<IncidentEntry> }).incidentHistory ?? []
  );
}

export function seedIncidentHistory(
  entries: ReadonlyArray<IncidentEntry>,
  state: Partial<LaserState> = {},
): void {
  const patch: Partial<LaserState> & { readonly incidentHistory: ReadonlyArray<IncidentEntry> } = {
    ...state,
    incidentHistory: entries,
  };
  useLaserStore.setState(patch);
}

export function resetIncidentState(): void {
  seedIncidentHistory([], initialLaserState());
}
