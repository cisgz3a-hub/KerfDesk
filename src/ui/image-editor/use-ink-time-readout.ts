// Debounced ink & time readout for the status footer (V2 plan E1). The scan
// walks the whole composite, so it runs ~300 ms after the last edit rather
// than per revision.

import { useEffect, useState } from 'react';
import { useStore } from '../state';
import { computeInkTimeReadout, type InkTimeReadout } from './editor-ink-time';
import { useImageEditorStore } from './image-editor-store';

const READOUT_DEBOUNCE_MS = 300;

export function useInkTimeReadout(): InkTimeReadout | null {
  const session = useImageEditorStore((s) => s.session);
  const revision = session?.revision ?? -1;
  const project = useStore((s) => s.project);
  const [readout, setReadout] = useState<InkTimeReadout | null>(null);

  useEffect(() => {
    if (session === null) {
      setReadout(null);
      return;
    }
    const timer = window.setTimeout(
      () => setReadout(computeInkTimeReadout(session, project)),
      READOUT_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
    // Revision rides the deps as the pixels' change signal for the
    // in-place mutations the session identity cannot see.
  }, [session, revision, project]);

  return readout;
}
