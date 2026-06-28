// Reflects the project's save state in the OS window title (F-A11). Format:
//   * Fresh project        → "KerfDesk"
//   * Edited fresh project → "KerfDesk — untitled *"
//   * Loaded / saved file  → "KerfDesk — my-job.lf2"
//   * Loaded then edited   → "KerfDesk — my-job.lf2 *"
//
// Lives in its own hook so App.tsx stays a thin layout shell and so we
// can swap to Tauri / Electron's setTitle path in a Phase B platform
// adapter without rewriting the consumer.

import { useEffect } from 'react';
import { useStore } from '../state';
import { APP_DISPLAY_NAME } from '../../core/app-branding';

export function useWindowTitle(): void {
  const dirty = useStore((s) => s.dirty);
  const savedName = useStore((s) => s.savedName);
  useEffect(() => {
    const name = savedName ?? (dirty ? 'untitled' : null);
    const marker = dirty ? ' *' : '';
    document.title = name === null ? APP_DISPLAY_NAME : `${APP_DISPLAY_NAME} — ${name}${marker}`;
  }, [dirty, savedName]);
}
