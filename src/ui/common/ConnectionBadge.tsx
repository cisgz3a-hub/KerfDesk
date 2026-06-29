// Connection badge (ADR-060). Reflects internet reachability (navigator.onLine).
// The app and machine control run fully offline, so this is purely reassurance:
// it appears ONLY when offline, telling the operator a dropped connection is
// expected, not a fault. Hidden when online to avoid chrome clutter.

import { useSyncExternalStore } from 'react';

function subscribe(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

export function ConnectionBadge(): JSX.Element | null {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  if (online) return null;
  return (
    <span
      role="status"
      title="No internet connection. The app and machine control run fully offline."
      style={badgeStyle}
    >
      Offline
    </span>
  );
}

const badgeStyle: React.CSSProperties = {
  fontSize: 'var(--lf-text-xs)',
  color: 'var(--lf-warning-fg)',
  background: 'var(--lf-tint-warning)',
  border: '1px solid var(--lf-warning)',
  borderRadius: 'var(--lf-radius-sm)',
  padding: '1px 6px',
};
