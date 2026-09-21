import type { AutosaveSnapshot } from './autosave-record';
import { autosaveSnapshotFromRecord } from './autosave-record';
import { autosaveSessionIdForStorageKey, readLocalAutosaveState } from './autosave-local-storage';
import type { AutosaveIndexedDbSlot } from './autosave-indexeddb';
import type { AutosaveDurableRepository } from './autosave-durable-repository';
import type { AutosaveSessionLocks, AutosaveSessionProbe } from './autosave-session-lock';

export type AutosaveDurableSnapshot = AutosaveSnapshot & {
  readonly backend: 'indexeddb' | 'local';
  readonly epoch?: number;
  readonly ownership: 'current' | 'abandoned' | 'unknown';
};

export type AutosaveDurableWarning =
  | 'indexeddb-read-failed'
  | 'local-read-failed'
  | 'recovered-previous'
  | 'corrupt-slot'
  | 'ownership-probe-failed';

// A slot this read could not restore. Retirement must compare its observed
// bytes or epoch, because a successful write can replace it before cleanup.
export type AutosaveUnreadableSlot = {
  readonly storageKey: string;
  readonly sessionId: string | undefined;
} & (
  | { readonly backend: 'local'; readonly raw: string }
  | { readonly backend: 'indexeddb'; readonly epoch: number }
);

export type AutosaveDurableReadResult = {
  readonly snapshot: AutosaveDurableSnapshot | null;
  readonly warnings: ReadonlyArray<AutosaveDurableWarning>;
  readonly unreadable: ReadonlyArray<AutosaveUnreadableSlot>;
};

export async function readLatestDurableAutosave(
  repository: AutosaveDurableRepository,
  locks: AutosaveSessionLocks,
  currentSessionId: string,
): Promise<AutosaveDurableReadResult> {
  const warnings: AutosaveDurableWarning[] = [];
  const unreadable: AutosaveUnreadableSlot[] = [];
  const candidates = await readCandidates(repository, warnings, unreadable);
  const eligible = await eligibleCandidates(locks, candidates, currentSessionId, warnings);
  eligible.sort((a, b) => b.savedAt - a.savedAt);
  return { snapshot: eligible[0] ?? null, warnings: [...new Set(warnings)], unreadable };
}

async function readCandidates(
  repository: AutosaveDurableRepository,
  warnings: AutosaveDurableWarning[],
  unreadable: AutosaveUnreadableSlot[],
): Promise<AutosaveDurableSnapshot[]> {
  const local = readLocalAutosaveState();
  if (local.corrupt) warnings.push('corrupt-slot');
  if (local.failed) warnings.push('local-read-failed');
  for (const { storageKey, raw } of local.unreadableSlots) {
    unreadable.push({
      storageKey,
      raw,
      sessionId: autosaveSessionIdForStorageKey(storageKey),
      backend: 'local',
    });
  }
  const candidates = local.snapshots.map(localCandidate);
  try {
    for (const slot of await repository.readAllSlots()) {
      const candidate = indexedDbCandidate(slot, warnings);
      if (candidate !== null) {
        candidates.push(candidate);
        continue;
      }
      // An empty manifest is a cleared slot, not a loss; only a manifest that
      // still points at snapshots it can no longer resolve is unreadable.
      if (slot.currentExpected || slot.previousExpected) {
        unreadable.push({
          storageKey: slot.storageKey,
          sessionId: slot.sessionId,
          backend: 'indexeddb',
          epoch: slot.epoch,
        });
      }
    }
  } catch {
    warnings.push('indexeddb-read-failed');
  }
  return candidates;
}

async function eligibleCandidates(
  locks: AutosaveSessionLocks,
  candidates: ReadonlyArray<AutosaveDurableSnapshot>,
  currentSessionId: string,
  warnings: AutosaveDurableWarning[],
): Promise<AutosaveDurableSnapshot[]> {
  const eligible: AutosaveDurableSnapshot[] = [];
  for (const candidate of candidates) {
    if (candidate.sessionId === currentSessionId) {
      eligible.push({ ...candidate, ownership: 'current' });
      continue;
    }
    const probe = await probeOwnership(locks, candidate.sessionId);
    if (probe.kind === 'live') continue;
    if (probe.kind === 'failed') warnings.push('ownership-probe-failed');
    const ownership = probe.kind === 'reconciled' ? 'abandoned' : 'unknown';
    eligible.push({ ...candidate, ownership });
  }
  return eligible;
}

function localCandidate(snapshot: AutosaveSnapshot): AutosaveDurableSnapshot {
  return { ...snapshot, backend: 'local', ownership: 'unknown' };
}

function indexedDbCandidate(
  slot: AutosaveIndexedDbSlot,
  warnings: AutosaveDurableWarning[],
): AutosaveDurableSnapshot | null {
  const current = slot.current && autosaveSnapshotFromRecord(slot.current, slot.storageKey);
  const previous = slot.previous && autosaveSnapshotFromRecord(slot.previous, slot.storageKey);
  if ((slot.currentExpected && current === null) || (slot.previousExpected && previous === null)) {
    warnings.push('corrupt-slot');
  }
  if (current !== null) {
    return { ...current, backend: 'indexeddb', epoch: slot.epoch, ownership: 'unknown' };
  }
  if (previous !== null) {
    warnings.push('recovered-previous');
    return { ...previous, backend: 'indexeddb', epoch: slot.epoch, ownership: 'unknown' };
  }
  return null;
}

async function probeOwnership(
  locks: AutosaveSessionLocks,
  sessionId: string | undefined,
): Promise<AutosaveSessionProbe<void>> {
  return sessionId === undefined
    ? { kind: 'unsupported' }
    : locks.runIfAbandoned(sessionId, async () => undefined);
}
