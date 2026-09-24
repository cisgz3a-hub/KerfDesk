// use-rotary-test-rotation — owns one Test rotation run for Rotary Setup
// (ADR-373). Closing the dialog mid-run stops the motion: nothing may keep
// turning the part once the controls that started it are gone.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLaserStore } from '../state/laser-store';
import { controllerActionFailureHandler } from './report-controller-action-failure';
import {
  runRotaryTestRotation,
  stopRotaryTestMotion,
  type RotaryTestOutcome,
  type RotaryTestPhase,
  type RotaryTestPlan,
} from './rotary-test-rotation';

export type RotaryTestView =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly plan: RotaryTestPlan; readonly phase: RotaryTestPhase }
  | {
      readonly kind: 'finished';
      readonly plan: RotaryTestPlan;
      readonly outcome: RotaryTestOutcome;
    };

export type RotaryTestControls = {
  readonly view: RotaryTestView;
  readonly start: (plan: RotaryTestPlan) => void;
  readonly stop: () => void;
};

export function useRotaryTestRotation(): RotaryTestControls {
  const [view, setView] = useState<RotaryTestView>({ kind: 'idle' });
  const runRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const start = useCallback((plan: RotaryTestPlan): void => {
    if (runRef.current !== null) return;
    const run = new AbortController();
    runRef.current = run;
    const current = (): boolean => mountedRef.current && runRef.current === run;
    setView({ kind: 'running', plan, phase: 'turning' });
    void runRotaryTestRotation({
      plan,
      signal: run.signal,
      onPhase: (phase) => {
        if (current()) setView({ kind: 'running', plan, phase });
      },
    }).then((outcome) => {
      if (!current()) return;
      runRef.current = null;
      setView({ kind: 'finished', plan, outcome });
    });
  }, []);

  const stop = useCallback((): void => {
    const run = runRef.current;
    if (run === null || run.signal.aborted) return;
    stopRun(run);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return (): void => {
      mountedRef.current = false;
      const run = runRef.current;
      runRef.current = null;
      if (run !== null) stopRun(run);
    };
  }, []);

  return { view, start, stop };
}

function stopRun(run: AbortController): void {
  run.abort();
  void stopRotaryTestMotion(useLaserStore.getState()).catch(
    controllerActionFailureHandler('Stop rotation'),
  );
}
