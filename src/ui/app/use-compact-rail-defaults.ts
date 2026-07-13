import { useEffect } from 'react';
import { useUiStore } from '../state/ui-store';

export const COMPACT_RAIL_QUERY = '(max-width: 700px)';
export const NARROW_RAIL_QUERY = '(max-width: 1100px)';

export function useCompactRailDefaults(): void {
  const setRailPanelVisible = useUiStore((state) => state.setRailPanelVisible);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const narrow = window.matchMedia(NARROW_RAIL_QUERY);
    const compact = window.matchMedia(COMPACT_RAIL_QUERY);
    const applyNarrow = (matches: boolean): void => {
      if (matches) setRailPanelVisible('machine', false);
    };
    const applyCompact = (matches: boolean): void => {
      if (!matches) return;
      setRailPanelVisible('layers', false);
      setRailPanelVisible('machine', false);
    };
    applyNarrow(narrow.matches);
    applyCompact(compact.matches);
    const onNarrowChange = (event: MediaQueryListEvent): void => applyNarrow(event.matches);
    const onCompactChange = (event: MediaQueryListEvent): void => applyCompact(event.matches);
    narrow.addEventListener('change', onNarrowChange);
    compact.addEventListener('change', onCompactChange);
    return () => {
      narrow.removeEventListener('change', onNarrowChange);
      compact.removeEventListener('change', onCompactChange);
    };
  }, [setRailPanelVisible]);
}
