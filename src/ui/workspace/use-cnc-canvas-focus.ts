import { useCallback, useEffect, useState } from 'react';

export const CNC_CANVAS_FOCUS_QUERY = '(max-width: 1439px)';
export const CNC_PANE_VISIBILITY_STORAGE_KEY = 'laserforge.cnc-3d-pane-visibility.v1';

type CncPanePreference = 'collapsed' | 'expanded' | null;

export type CncCanvasFocus = {
  readonly collapsed: boolean;
  readonly toggleCollapsed: () => void;
};

export function cncPaneCollapsed(
  preference: CncPanePreference,
  canvasFocusViewport: boolean,
): boolean {
  if (preference === 'collapsed') return true;
  if (preference === 'expanded') return false;
  return canvasFocusViewport;
}

export function useCncCanvasFocus(): CncCanvasFocus {
  const [preference, setPreference] = useState<CncPanePreference>(readPreference);
  const [canvasFocusViewport, setCanvasFocusViewport] = useState(readCanvasFocusViewport);
  const collapsed = cncPaneCollapsed(preference, canvasFocusViewport);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(CNC_CANVAS_FOCUS_QUERY);
    setCanvasFocusViewport(query.matches);
    const update = (event: MediaQueryListEvent): void => setCanvasFocusViewport(event.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setPreference((current) => {
      const next = cncPaneCollapsed(current, canvasFocusViewport) ? 'expanded' : 'collapsed';
      writePreference(next);
      return next;
    });
  }, [canvasFocusViewport]);

  return { collapsed, toggleCollapsed };
}

function readCanvasFocusViewport(): boolean {
  return (
    typeof window.matchMedia === 'function' && window.matchMedia(CNC_CANVAS_FOCUS_QUERY).matches
  );
}

function readPreference(): CncPanePreference {
  try {
    if (typeof localStorage === 'undefined') return null;
    const stored = localStorage.getItem(CNC_PANE_VISIBILITY_STORAGE_KEY);
    return stored === 'collapsed' || stored === 'expanded' ? stored : null;
  } catch {
    return null;
  }
}

function writePreference(preference: Exclude<CncPanePreference, null>): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CNC_PANE_VISIBILITY_STORAGE_KEY, preference);
    }
  } catch {
    // Storage can be unavailable; the explicit choice still lasts for this session.
  }
}
