export interface AutosaveRunningJobInput {
  appJobRunning: boolean;
  controllerJobRunning: boolean;
}

export interface AutosaveHashInput {
  currentHash: string;
  lastAutosaveHash: string;
}

/**
 * T2-6 Phase 3ak: pure autosave skip/persist decisions.
 * App.tsx still owns interval lifecycle, scene hashing, serialization, and
 * persistence side effects.
 */
export function shouldSkipAutosaveForRunningJob(input: AutosaveRunningJobInput): boolean {
  return input.appJobRunning || input.controllerJobRunning;
}

export function shouldPersistAutosaveForHash(input: AutosaveHashInput): boolean {
  return input.currentHash !== input.lastAutosaveHash;
}
