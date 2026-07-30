// Debounced kerf thin-stroke check for the status footer (V2 plan E2).
// Morphology over the full composite — runs ~400 ms after the last edit.

import { useEffect, useState } from 'react';
import type { Project } from '../../core/scene';
import { useStore } from '../state';
import { computeKerfCheck, type KerfCheck } from './editor-kerf-check';
import type { EditorSession } from './editor-session';
import { useImageEditorStore } from './image-editor-store';

const KERF_CHECK_DEBOUNCE_MS = 400;

type KerfCheckResult = {
  readonly session: EditorSession;
  readonly project: Project;
  readonly check: KerfCheck | null;
};

export function useKerfCheck(): KerfCheck | null {
  const session = useImageEditorStore((s) => s.session);
  const revision = session?.revision ?? -1;
  const project = useStore((s) => s.project);
  const [result, setResult] = useState<KerfCheckResult | null>(null);

  useEffect(() => {
    if (session === null) {
      setResult(null);
      return;
    }
    const timer = window.setTimeout(
      () => setResult({ session, project, check: computeKerfCheck(session, project) }),
      KERF_CHECK_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
    // Revision rides the deps as the pixels' change signal.
  }, [session, revision, project]);

  if (result?.session !== session || result.project !== project) return null;
  return result.check;
}
