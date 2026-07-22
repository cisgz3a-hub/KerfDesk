// Memoized layer composite for the canvas (ADR-245 + V2 plan A1): recomputes
// when the session identity changes (layer actions) or the revision bumps
// (in-place pixel mutations), reusing the previous composite buffer and
// repainting only the last op's dirty window where the session declares one.

import { useMemo, useRef } from 'react';
import type { RgbaBuffer } from '../../core/image-edit';
import { nextComposite, type CompositeCache } from './composite-cache';
import type { EditorSession } from './editor-session';

export function useCompositeDoc(
  session: EditorSession | null,
  revision: number,
): RgbaBuffer | undefined {
  const cacheRef = useRef<CompositeCache | null>(null);
  return useMemo(() => {
    // Reference the revision so in-place mutations invalidate the memo.
    void revision;
    if (session === null) {
      cacheRef.current = null;
      return undefined;
    }
    const result = nextComposite(cacheRef.current, session);
    cacheRef.current = result.cache;
    return result.doc;
  }, [session, revision]);
}
