import { useEffect } from 'react';
import { useUiStore } from '../state/ui-store';

export const COMPACT_RAIL_QUERY = '(max-width: 700px)';

export function useCompactRailDefaults(): void {
  const setRailPanelVisible = useUiStore((state) => state.setRailPanelVisible);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const compact = window.matchMedia(COMPACT_RAIL_QUERY);
    const apply = (matches: boolean): void => {
      if (!matches) return;
      setRailPanelVisible('layers', false);
      setRailPanelVisible('machine', false);
    };
    apply(compact.matches);
    const onChange = (event: MediaQueryListEvent): void => apply(event.matches);
    compact.addEventListener('change', onChange);
    return () => compact.removeEventListener('change', onChange);
  }, [setRailPanelVisible]);
}
