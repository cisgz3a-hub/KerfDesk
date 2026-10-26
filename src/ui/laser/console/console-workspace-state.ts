import { useState, type Dispatch, type SetStateAction } from 'react';
import { create } from 'zustand';

// Workspace utility drafts outlive responsive panel remounts, but never go
// into a project or storage and are never submitted by restoring the panel.
export const useConsoleWorkspaceState = create<{
  readonly command: string;
  readonly showStatus: boolean;
  readonly showStream: boolean;
}>(() => ({ command: '', showStatus: false, showStream: false }));

function setWorkspaceCommand(value: SetStateAction<string>): void {
  useConsoleWorkspaceState.setState((state) => ({
    command: typeof value === 'function' ? value(state.command) : value,
  }));
}

export function useConsoleCommandDraft(
  retain: boolean,
): [string, Dispatch<SetStateAction<string>>] {
  const [local, setLocal] = useState('');
  const retained = useConsoleWorkspaceState((state) => state.command);
  return retain ? [retained, setWorkspaceCommand] : [local, setLocal];
}
