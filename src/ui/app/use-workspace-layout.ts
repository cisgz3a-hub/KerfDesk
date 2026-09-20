import { useSyncExternalStore } from 'react';
import { useWorkspaceLayoutStore } from '../state/workspace-layout-store';

export const COMPACT_WORKSPACE_QUERY = '(max-width: 1439px), (max-height: 719px)';
export const SINGLE_PANEL_QUERY = '(max-width: 959px)';
type AvailableLayout = 'narrow' | 'compact' | 'spacious';

function readAvailableLayout(): AvailableLayout {
  if (typeof window === 'undefined') return 'compact';
  if (typeof window.matchMedia === 'function') {
    if (window.matchMedia(SINGLE_PANEL_QUERY).matches) return 'narrow';
    return window.matchMedia(COMPACT_WORKSPACE_QUERY).matches ? 'compact' : 'spacious';
  }
  if (window.innerWidth < 960) return 'narrow';
  return window.innerWidth < 1440 || window.innerHeight < 720 ? 'compact' : 'spacious';
}

function subscribeToViewport(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') {
    window.addEventListener('resize', onChange);
    return () => window.removeEventListener('resize', onChange);
  }
  const queries = [SINGLE_PANEL_QUERY, COMPACT_WORKSPACE_QUERY].map((query) =>
    window.matchMedia(query),
  );
  queries.forEach((query) => query.addEventListener('change', onChange));
  return () => queries.forEach((query) => query.removeEventListener('change', onChange));
}

export function useWorkspaceLayout(): 'compact' | 'spacious' {
  const preference = useWorkspaceLayoutStore((state) => state.preference);
  const available = useSyncExternalStore<AvailableLayout>(
    subscribeToViewport,
    readAvailableLayout,
    () => 'compact',
  );
  // A manual Spacious preference is remembered, but never squeezes the canvas
  // out of a window that cannot hold two usable panels. It returns when resized.
  if (available === 'narrow') return 'compact';
  return preference === 'auto' ? available : preference;
}
