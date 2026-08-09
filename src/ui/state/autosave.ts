// Synchronous project autosave compatibility surface. The interval and large-
// project IndexedDB path live in separate modules; this localStorage writer is
// retained for legacy recovery and the browser's best-effort beforeunload path.

import type { Project } from '../../core/scene';
import {
  clearLocalAutosave,
  readLocalAutosave,
  type LocalAutosaveClearResult,
  writeLocalAutosave,
} from './autosave-local-storage';
import type { AutosaveScope, AutosaveSnapshot, AutosaveWriteResult } from './autosave-record';

export type {
  AutosaveScope,
  AutosaveSnapshot,
  AutosaveWriteFailure,
  AutosaveWriteResult,
} from './autosave-record';

const AUTOSAVE_GENERATION_KEY = 'lf2:autosave:generation:v1';
const AUTOSAVE_HISTORY_STATE_KEY = '__laserforgeAutosaveWindow';

export const AUTOSAVE_INTERVAL_MS = 30_000;

export function writeAutosave(
  project: Project,
  now: number = Date.now(),
  scope: AutosaveScope = {},
): AutosaveWriteResult {
  return writeLocalAutosave(project, now, scope);
}

export function readAutosave(): AutosaveSnapshot | null {
  return readLocalAutosave();
}

export function autosaveSlotGeneration(): number {
  if (typeof sessionStorage !== 'undefined') {
    try {
      const value = Number(sessionStorage.getItem(AUTOSAVE_GENERATION_KEY) ?? '0');
      return Number.isSafeInteger(value) && value >= 0 ? value : 0;
    } catch {
      /* fall through to per-window history state */
    }
  }
  return autosaveHistoryState()?.generation ?? 0;
}

export function clearAutosave(
  target: AutosaveScope | AutosaveSnapshot = {},
): LocalAutosaveClearResult {
  advanceAutosaveSlotGeneration();
  return clearLocalAutosave(target);
}

function advanceAutosaveSlotGeneration(): void {
  let generationStored = false;
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(AUTOSAVE_GENERATION_KEY, String(autosaveSlotGeneration() + 1));
      generationStored = true;
    } catch {
      /* the clear itself can still proceed */
    }
  }
  if (!generationStored) {
    updateAutosaveHistoryState({ generation: autosaveSlotGeneration() + 1 });
  }
}

type AutosaveHistoryState = {
  readonly sessionId?: string;
  readonly generation?: number;
};

function autosaveHistoryState(): AutosaveHistoryState | null {
  if (typeof history === 'undefined') return null;
  try {
    const state: unknown = history.state;
    if (typeof state !== 'object' || state === null) return null;
    return readAutosaveHistoryValue((state as Record<string, unknown>)[AUTOSAVE_HISTORY_STATE_KEY]);
  } catch {
    return null;
  }
}

function readAutosaveHistoryValue(value: unknown): AutosaveHistoryState | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const sessionId = typeof record['sessionId'] === 'string' ? record['sessionId'] : undefined;
  const generation = nonNegativeSafeInteger(record['generation']);
  return {
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(generation === undefined ? {} : { generation }),
  };
}

function nonNegativeSafeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function updateAutosaveHistoryState(update: AutosaveHistoryState): void {
  if (typeof history === 'undefined') return;
  try {
    const state: unknown = history.state;
    const root = typeof state === 'object' && state !== null ? state : {};
    history.replaceState(
      {
        ...root,
        [AUTOSAVE_HISTORY_STATE_KEY]: { ...autosaveHistoryState(), ...update },
      },
      '',
    );
  } catch {
    /* localStorage cleanup still reports its own result */
  }
}
