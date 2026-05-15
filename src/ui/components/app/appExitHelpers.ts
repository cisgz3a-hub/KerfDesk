export type ExitDestination = 'electron-quit' | 'landing';

export interface ExitFlowInput {
  machineStatus: string | null | undefined;
  hasController: boolean;
  controllerJobRunning: boolean;
  sceneDirty: boolean;
  electronQuitAvailable: boolean;
}

export interface ExitFlowPlan {
  shouldDisconnect: boolean;
  promptRunningJob: boolean;
  promptUnsavedChanges: boolean;
  destination: ExitDestination;
}

/**
 * T2-6 Phase 3al: pure app-exit flow decisions.
 * App.tsx still owns prompts, safe-disconnect side effects, and navigation.
 */
export function isExitConnectedStatus(status: string | null | undefined): boolean {
  return !!status && status !== 'disconnected' && status !== 'connecting';
}

export function buildExitFlowPlan(input: ExitFlowInput): ExitFlowPlan {
  const shouldDisconnect = input.hasController && isExitConnectedStatus(input.machineStatus);
  return {
    shouldDisconnect,
    promptRunningJob: shouldDisconnect && input.controllerJobRunning,
    promptUnsavedChanges: input.sceneDirty,
    destination: input.electronQuitAvailable ? 'electron-quit' : 'landing',
  };
}
