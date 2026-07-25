// useCurrentGcode — compiles the CURRENT project into G-code for the
// main-canvas G-code view (ADR-255 stage 9b).
//
// Compiles on demand, not on every edit: a full emit on each keystroke would
// make the canvas feel heavy on large jobs. The view shows when it is stale
// and offers Refresh, so what you look at is always a program you asked for.
//
// Read-only by construction: it borrows the Save context but never writes,
// streams, or advances variable text.

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlatform } from '../app/platform-context';
import { handleInspectCurrentGcode } from '../app/inspect-current-gcode-action';
import { saveGcodeContext } from '../commands/gcode-command-actions';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';

export type CurrentGcode =
  | { readonly kind: 'idle' }
  | { readonly kind: 'compiling' }
  | { readonly kind: 'ready'; readonly programName: string; readonly text: string }
  | { readonly kind: 'empty' };

export function useCurrentGcode(active: boolean): {
  readonly state: CurrentGcode;
  readonly stale: boolean;
  readonly refresh: () => void;
} {
  const platform = usePlatform();
  const project = useStore((store) => store.project);
  const [state, setState] = useState<CurrentGcode>({ kind: 'idle' });
  const compiledFor = useRef<unknown>(null);

  const refresh = useCallback(() => {
    const app = useStore.getState();
    const laser = useLaserStore.getState();
    const { pushToast } = useToastStore.getState();
    const snapshot = app.project;
    setState({ kind: 'compiling' });
    void handleInspectCurrentGcode(
      saveGcodeContext({ platform, app, laser, pushToast, openInspector: () => undefined }),
      (programName, text) => {
        compiledFor.current = snapshot;
        setState({ kind: 'ready', programName, text });
      },
    ).then(() => {
      // handleInspectCurrentGcode toasts and calls nothing back when the
      // project yields no program; reflect that instead of hanging on
      // "compiling" forever.
      setState((current) => (current.kind === 'compiling' ? { kind: 'empty' } : current));
    });
  }, [platform]);

  // Compile when the view first becomes visible, and never while hidden.
  useEffect(() => {
    if (!active) return;
    if (compiledFor.current === project) return;
    refresh();
  }, [active, project, refresh]);

  return { state, stale: state.kind === 'ready' && compiledFor.current !== project, refresh };
}
