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

export const AUTOSAVE_INTERVAL_MS = 30_000;

let autosaveClearCount = 0;

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
  return autosaveClearCount;
}

export function clearAutosave(
  target: AutosaveScope | AutosaveSnapshot = {},
): LocalAutosaveClearResult {
  autosaveClearCount += 1;
  return clearLocalAutosave(target);
}
