// Debounced output-facing dot-width check for the status footer (V2 plan E2).
// The cached Apply composite is copied into a target-scoped worker after the
// last edit; no full-project compilation runs on the UI thread.

import { useEffect, useMemo, useState } from 'react';
import type { RgbaBuffer } from '../../core/image-edit';
import type { Project } from '../../core/scene';
import { useOutputScope, useStore } from '../state';
import { kerfCheckFromParity, kerfOutputParityInput, type KerfCheck } from './editor-kerf-check';
import type { EditorSession } from './editor-session';
import { useImageEditorStore } from './image-editor-store';
import { kerfCheckContext, type KerfCheckContext } from './kerf-check-context';
import { startKerfCheckWorker, type KerfCheckWorkerHandle } from './kerf-check-worker-client';

const KERF_CHECK_DEBOUNCE_MS = 400;

type KerfCheckResult = {
  readonly session: EditorSession;
  readonly project: Project;
  readonly context: KerfCheckContext;
  readonly check: KerfCheck | null;
};

/** Return the latest target-scoped background dot-width advisory. */
export function useKerfCheck(composite: RgbaBuffer | undefined): KerfCheck | null {
  const session = useImageEditorStore((state) => state.session);
  const revision = session?.revision ?? -1;
  const project = useStore((state) => state.project);
  const jobPlacement = useStore((state) => state.jobPlacement);
  const outputScope = useOutputScope();
  const context = useMemo(
    () => (session === null ? null : kerfCheckContext(session, project, outputScope, jobPlacement)),
    [jobPlacement, outputScope, project, session],
  );
  const [result, setResult] = useState<KerfCheckResult | null>(null);

  useEffect(() => {
    if (session === null || composite === undefined || context === null) {
      setResult(null);
      return;
    }
    let isCancelled = false;
    let worker: KerfCheckWorkerHandle | null = null;
    const timer = window.setTimeout(() => {
      worker = startKerfCheckWorker(kerfOutputParityInput(session, composite, context));
      if (worker === null) {
        setResult({ session, project, context, check: null });
        return;
      }
      void worker.result.then(
        (parity) => {
          if (isCancelled) return;
          setResult({
            session,
            project,
            context,
            check: parity === null ? null : kerfCheckFromParity(session, context, parity),
          });
        },
        () => {
          if (!isCancelled) setResult({ session, project, context, check: null });
        },
      );
    }, KERF_CHECK_DEBOUNCE_MS);
    return () => {
      isCancelled = true;
      window.clearTimeout(timer);
      worker?.cancel();
    };
    // Revision rides the deps as the pixels' in-place change signal.
  }, [composite, context, project, revision, session]);

  if (
    result?.session !== session ||
    result.project !== project ||
    context === null ||
    result.context.outputScopeKey !== context.outputScopeKey ||
    result.context.outputPlacementKey !== context.outputPlacementKey
  ) {
    return null;
  }
  return result.check;
}
