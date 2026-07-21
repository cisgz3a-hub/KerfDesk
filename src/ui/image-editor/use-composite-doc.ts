// Memoized layer composite for the canvas (ADR-245): recomputes when the
// session identity changes (layer actions) or the revision bumps (in-place
// pixel mutations the identity cannot see).

import { useMemo } from 'react';
import type { RgbaBuffer } from '../../core/image-edit';
import type { EditorSession } from './editor-session';
import { compositeSession } from './editor-session-layers';

export function useCompositeDoc(
  session: EditorSession | null,
  revision: number,
): RgbaBuffer | undefined {
  return useMemo(() => {
    // Reference the revision so in-place mutations invalidate the memo.
    void revision;
    return session === null ? undefined : compositeSession(session);
  }, [session, revision]);
}
