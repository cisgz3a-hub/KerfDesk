// Compiles the current project for the canvas G-code view. Costly projects use
// the same bounded output-worker scheduler as Save. The hook owns request
// identity so an edit can cancel stale work and can never publish old bytes.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { OutputCompilationProgress } from '../../io/gcode/prepare-output-async';
import { usePlatform } from '../app/platform-context';
import { handleInspectCurrentGcode } from '../app/inspect-current-gcode-action';
import { saveGcodeContext } from '../commands/gcode-command-actions';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';

export type CurrentGcode =
  | { readonly kind: 'idle' }
  | { readonly kind: 'compiling'; readonly progress?: OutputCompilationProgress }
  | { readonly kind: 'ready'; readonly programName: string; readonly text: string }
  | { readonly kind: 'empty' }
  | { readonly kind: 'stale'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

export function useCurrentGcode(active: boolean): {
  readonly state: CurrentGcode;
  readonly stale: boolean;
  readonly refresh: () => void;
} {
  const project = useStore((store) => store.project);
  const [state, setState] = useState<CurrentGcode>({ kind: 'idle' });
  const compiledFor = useRef<unknown>(null);
  const compilingFor = useRef<unknown>(null);
  const activeController = useRef<AbortController | null>(null);
  const runSequence = useRef(0);

  const refresh = useCurrentGcodeRefresh({
    compiledFor,
    compilingFor,
    activeController,
    runSequence,
    setState,
  });

  // A project replacement means the active request no longer describes the
  // canvas. Cancel it immediately; do not auto-recompile on every keystroke.
  useEffect(() => {
    const controller = activeController.current;
    if (controller === null || compilingFor.current === project) return;
    runSequence.current += 1;
    activeController.current = null;
    compilingFor.current = null;
    controller.abort();
    setState({
      kind: 'stale',
      reason: 'Design changed while G-code was compiling. Refresh to compile the current canvas.',
    });
  }, [project]);

  useEffect(() => {
    if (!active) {
      const controller = activeController.current;
      if (controller !== null) {
        runSequence.current += 1;
        activeController.current = null;
        compilingFor.current = null;
        controller.abort();
      }
      return;
    }
    if (compiledFor.current === useStore.getState().project) return;
    refresh();
  }, [active, refresh]);

  useEffect(
    () => () => {
      activeController.current?.abort();
      activeController.current = null;
    },
    [],
  );

  return {
    state,
    stale: state.kind === 'stale' || (state.kind === 'ready' && compiledFor.current !== project),
    refresh,
  };
}

function useCurrentGcodeRefresh(args: {
  readonly compiledFor: { current: unknown };
  readonly compilingFor: { current: unknown };
  readonly activeController: { current: AbortController | null };
  readonly runSequence: { current: number };
  readonly setState: (state: CurrentGcode) => void;
}): () => void {
  const platform = usePlatform();
  const { compiledFor, compilingFor, activeController, runSequence, setState } = args;
  return useCallback(() => {
    activeController.current?.abort();
    const app = useStore.getState();
    const laser = useLaserStore.getState();
    const { pushToast } = useToastStore.getState();
    const snapshot = app.project;
    const controller = new AbortController();
    const runId = runSequence.current + 1;
    runSequence.current = runId;
    activeController.current = controller;
    compilingFor.current = snapshot;
    setState({ kind: 'compiling' });
    void handleInspectCurrentGcode(
      saveGcodeContext({ platform, app, laser, pushToast, openInspector: () => undefined }),
      (programName, text) => {
        if (runSequence.current !== runId || controller.signal.aborted) return;
        compiledFor.current = snapshot;
        setState({ kind: 'ready', programName, text });
      },
      {
        signal: controller.signal,
        onProgress: (progress) => {
          if (runSequence.current !== runId || controller.signal.aborted) return;
          setState({ kind: 'compiling', progress });
        },
      },
    ).then((result) => {
      if (runSequence.current !== runId || controller.signal.aborted) return;
      activeController.current = null;
      compilingFor.current = null;
      if (result.kind === 'empty') setState({ kind: 'empty' });
      else if (result.kind === 'unavailable' || result.kind === 'failed') {
        setState({ kind: 'unavailable', reason: result.message });
      } else if (result.kind === 'cancelled') {
        setState({ kind: 'stale', reason: 'Compilation was cancelled. Refresh to try again.' });
      }
    });
  }, [activeController, compiledFor, compilingFor, platform, runSequence, setState]);
}
