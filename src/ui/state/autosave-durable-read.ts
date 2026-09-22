import type { AutosaveRecord, AutosaveRecordReadResult, AutosaveSnapshot } from './autosave-record';
import { readAutosaveRecord } from './autosave-record';
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
  | 'unsupported-version'
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
  if (local.unsupportedVersion) warnings.push('unsupported-version');
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
      if (candidate === 'unsupported-version') continue;
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
): AutosaveDurableSnapshot | 'unsupported-version' | null {
  const current = readIndexedDbRecord(
    slot.current,
    slot.storageKey,
    slot.unsupportedVersion === true || slot.currentUnsupportedVersion === true,
  );
  const previous = readIndexedDbRecord(
    slot.previous,
    slot.storageKey,
    slot.previousUnsupportedVersion === true,
  );
  reportIndexedDbVersions(slot, current, previous, warnings);
  // A previous snapshot must not silently replace an unreadable newer one.
  // A compatible current snapshot is still recoverable when only its history
  // needs a different reader; mutation guards keep that history intact.
  if (current.kind === 'unsupported-version') return 'unsupported-version';
  if (current.kind === 'ok') {
    return { ...current.snapshot, backend: 'indexeddb', epoch: slot.epoch, ownership: 'unknown' };
  }
  if (previous.kind === 'ok') {
    warnings.push('recovered-previous');
    return { ...previous.snapshot, backend: 'indexeddb', epoch: slot.epoch, ownership: 'unknown' };
  }
  return previous.kind === 'unsupported-version' ? 'unsupported-version' : null;
}

function readIndexedDbRecord(
  record: AutosaveRecord | null,
  storageKey: string,
  unsupported: boolean,
): AutosaveRecordReadResult {
  if (unsupported) return { kind: 'unsupported-version' };
  return record === null ? { kind: 'invalid' } : readAutosaveRecord(record, storageKey);
}

function reportIndexedDbVersions(
  slot: AutosaveIndexedDbSlot,
  current: AutosaveRecordReadResult,
  previous: AutosaveRecordReadResult,
  warnings: AutosaveDurableWarning[],
): void {
  if (current.kind === 'unsupported-version' || previous.kind === 'unsupported-version') {
    warnings.push('unsupported-version');
  }
  if (
    (slot.currentExpected && current.kind === 'invalid') ||
    (slot.previousExpected && previous.kind === 'invalid')
  )
    warnings.push('corrupt-slot');
}

async function probeOwnership(
  locks: AutosaveSessionLocks,
  sessionId: string | undefined,
): Promise<AutosaveSessionProbe<void>> {
  return sessionId === undefined
    ? { kind: 'unsupported' }
    : locks.runIfAbandoned(sessionId, async () => undefined);
}
