// Compiles the current project for the canvas G-code view. Costly projects use
// the same bounded output-worker scheduler as Save. The hook owns request
// identity so an edit can cancel stale work and can never publish old bytes.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OutputCompilationProgress } from '../../io/gcode/prepare-output-async';
import { usePlatform } from '../app/platform-context';
import { handleInspectCurrentGcode } from '../app/inspect-current-gcode-action';
import { saveGcodeContext } from '../commands/gcode-command-actions';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { isActiveJobStatus } from '../state/laser-store-helpers';
import { useCurrentCanvasRun } from '../state/use-current-canvas-run';
import { useToastStore } from '../state/toast-store';
import type { CanvasMotionPlan, LiveCanvasLifecycle } from '../state/canvas-motion-plan';
import { canvasProgramMatchesRunQueue, canvasProgramSource } from '../state/canvas-program-source';
import {
  deviceInspectionContext,
  projectInspectionContext,
  type GcodeInspectionContext,
} from './gcode-inspection-source';

export type CurrentGcode =
  | { readonly kind: 'idle' }
  | { readonly kind: 'compiling'; readonly progress?: OutputCompilationProgress }
  | {
      readonly kind: 'ready';
      readonly programName: string;
      readonly text: string;
      readonly context: GcodeInspectionContext;
      readonly liveLifecycle?: LiveCanvasLifecycle;
    }
  | { readonly kind: 'empty' }
  | { readonly kind: 'stale'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

export function useCurrentGcode(active: boolean): {
  readonly state: CurrentGcode;
  readonly stale: boolean;
  readonly refresh: () => void;
  readonly followingRun: boolean;
} {
  const liveProgram = useCurrentRunProgram();
  const [dismissedRun, setDismissedRun] = useState<Pick<
    CurrentRunProgram,
    'plan' | 'startedAtMs'
  > | null>(null);
  const followingRun =
    liveProgram !== null &&
    (liveProgram.plan !== dismissedRun?.plan ||
      liveProgram.startedAtMs !== dismissedRun?.startedAtMs);
  const compilation = useCurrentGcodeCompilation(active, followingRun);
  const compile = compilation.refresh;
  const refresh = useCallback(() => {
    if (followingRun && liveProgram !== null) {
      // Refresh cannot replace immutable running bytes with a new compilation.
      if (liveProgram.active) return;
      setDismissedRun({ plan: liveProgram.plan, startedAtMs: liveProgram.startedAtMs });
    }
    compile();
  }, [compile, followingRun, liveProgram]);
  return {
    state: followingRun && liveProgram !== null ? currentRunState(liveProgram) : compilation.state,
    stale: !followingRun && compilation.stale,
    refresh,
    followingRun,
  };
}

function useCurrentGcodeCompilation(
  active: boolean,
  suspended: boolean,
): {
  readonly state: CurrentGcode;
  readonly stale: boolean;
  readonly refresh: () => void;
} {
  const project = useStore((store) => store.project);
  const { state, setState, documentEpoch } = useDocumentOwnedGcodeState();
  const ownerEpoch = useRef(documentEpoch);
  const compiledFor = useRef<unknown>(null);
  const compiledDocumentEpoch = useRef<number | null>(null);
  const compilingFor = useRef<unknown>(null);
  const activeController = useRef<AbortController | null>(null);
  const runSequence = useRef(0);

  const refresh = useCurrentGcodeRefresh({
    compiledFor,
    compiledDocumentEpoch,
    compilingFor,
    activeController,
    runSequence,
    setState,
  });

  useEffect(() => {
    if (ownerEpoch.current === documentEpoch) return;
    ownerEpoch.current = documentEpoch;
    runSequence.current += 1;
    activeController.current?.abort();
    activeController.current = null;
    compilingFor.current = null;
    compiledFor.current = null;
    compiledDocumentEpoch.current = null;
    setState({ kind: 'idle' });
  }, [documentEpoch, setState]);

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
  }, [project, setState]);

  useEffect(() => {
    if (!active || suspended) {
      const controller = activeController.current;
      if (controller !== null) {
        runSequence.current += 1;
        activeController.current = null;
        compilingFor.current = null;
        controller.abort();
      }
      return;
    }
    if (
      compiledFor.current === useStore.getState().project &&
      compiledDocumentEpoch.current === documentEpoch
    )
      return;
    if (activeController.current !== null) return;
    refresh();
  }, [active, suspended, refresh, documentEpoch]);

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

type CurrentRunProgram = {
  readonly plan: CanvasMotionPlan;
  readonly startedAtMs: number;
  readonly text: string;
  readonly lifecycle: LiveCanvasLifecycle;
  readonly context: GcodeInspectionContext;
  readonly active: boolean;
};

function useCurrentRunProgram(): CurrentRunProgram | null {
  const run = useCurrentCanvasRun();
  const plan = run?.plan ?? null;
  const lifecycle = run?.lifecycle ?? null;
  const startedAtMs = run?.startedAtMs ?? 0;
  const active =
    useLaserStore((store) => isActiveJobStatus(store.streamer?.status ?? null)) ||
    (lifecycle !== null && ['running', 'paused', 'tool-change'].includes(lifecycle));
  const queued = useLaserStore((store) => store.streamer?.queued ?? null);
  const context = useMemo(() => (plan === null ? null : runInspectionContext(plan)), [plan]);
  return useMemo(() => {
    if (plan === null || lifecycle === null || context === null) return null;
    const text = canvasProgramSource(plan);
    if (text === null || !canvasProgramMatchesRunQueue({ plan, startedAtMs, lifecycle }, queued))
      return null;
    return { plan, startedAtMs, text, lifecycle, context, active };
  }, [plan, lifecycle, queued, startedAtMs, context, active]);
}

function currentRunState(run: CurrentRunProgram): Extract<CurrentGcode, { kind: 'ready' }> {
  return {
    kind: 'ready',
    programName: runProgramName(run.lifecycle),
    text: run.text,
    liveLifecycle: run.lifecycle,
    context: run.context,
  };
}

function runInspectionContext(plan: CanvasMotionPlan): GcodeInspectionContext {
  return deviceInspectionContext(plan.device, plan.machineKind);
}

function runProgramName(lifecycle: LiveCanvasLifecycle): string {
  switch (lifecycle) {
    case 'running':
      return 'Running program';
    case 'paused':
      return 'Paused program';
    case 'tool-change':
      return 'Running program · Tool change';
    case 'finished':
      return 'Finished program';
    case 'stopped':
      return 'Stopped program';
    case 'disconnected':
      return 'Disconnected program';
    case 'errored':
      return 'Interrupted program';
  }
}

function useCurrentGcodeRefresh(args: {
  readonly compiledFor: { current: unknown };
  readonly compiledDocumentEpoch: { current: number | null };
  readonly compilingFor: { current: unknown };
  readonly activeController: { current: AbortController | null };
  readonly runSequence: { current: number };
  readonly setState: (state: CurrentGcode) => void;
}): () => void {
  const platform = usePlatform();
  const {
    compiledFor,
    compiledDocumentEpoch,
    compilingFor,
    activeController,
    runSequence,
    setState,
  } = args;
  return useCallback(() => {
    activeController.current?.abort();
    const app = useStore.getState();
    const laser = useLaserStore.getState();
    const { pushToast } = useToastStore.getState();
    const snapshot = app.project;
    const documentEpoch = app.projectDocumentEpoch;
    const controller = new AbortController();
    const runId = runSequence.current + 1;
    runSequence.current = runId;
    activeController.current = controller;
    compilingFor.current = snapshot;
    setState({ kind: 'compiling' });
    const current = () => {
      const latest = useStore.getState();
      return (
        runSequence.current === runId &&
        !controller.signal.aborted &&
        latest.projectDocumentEpoch === documentEpoch &&
        latest.project === snapshot
      );
    };
    void handleInspectCurrentGcode(
      saveGcodeContext({ platform, app, laser, pushToast, openInspector: () => undefined }),
      (programName, text, placement) => {
        if (!current()) return;
        compiledFor.current = snapshot;
        compiledDocumentEpoch.current = documentEpoch;
        const context = projectInspectionContext(snapshot, placement);
        setState({ kind: 'ready', programName, text, context });
      },
      {
        signal: controller.signal,
        onProgress: (progress) => {
          if (!current()) return;
          setState({ kind: 'compiling', progress });
        },
      },
    ).then((result) => {
      if (!current()) return;
      activeController.current = null;
      compilingFor.current = null;
      if (result.kind === 'empty') setState({ kind: 'empty' });
      else if (result.kind === 'unavailable' || result.kind === 'failed') {
        setState({ kind: 'unavailable', reason: result.message });
      } else if (result.kind === 'cancelled') {
        setState({ kind: 'stale', reason: 'Compilation was cancelled. Refresh to try again.' });
      }
    });
  }, [
    activeController,
    compiledFor,
    compiledDocumentEpoch,
    compilingFor,
    platform,
    runSequence,
    setState,
  ]);
}

function useDocumentOwnedGcodeState() {
  const documentEpoch = useStore((store) => store.projectDocumentEpoch);
  const [ownedState, setOwnedState] = useState(() => ({
    documentEpoch,
    state: { kind: 'idle' } as CurrentGcode,
  }));
  const setState = useCallback((state: CurrentGcode) => {
    setOwnedState({ documentEpoch: useStore.getState().projectDocumentEpoch, state });
  }, []);
  const state: CurrentGcode =
    ownedState.documentEpoch === documentEpoch ? ownedState.state : { kind: 'idle' };
  return { state, setState, documentEpoch };
}
