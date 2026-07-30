// Mount point for the Design Studio (ADR-268). App renders this always; the
// heavy overlay chunk loads lazily only once a session opens, so a user who
// never opens the Studio pays nothing at cold start (the ADR-102 lazy-import
// precedent, and the same shape as ImageEditorHost).

import { lazy, Suspense } from 'react';
import { useDesignStudioStore } from './design-studio-store';

const LazyOverlay = lazy(() =>
  import('./DesignStudioOverlay').then((m) => ({ default: m.DesignStudioOverlay })),
);

export function DesignStudioHost(): JSX.Element | null {
  const hasSession = useDesignStudioStore((state) => state.session !== null);
  if (!hasSession) return null;
  return (
    <Suspense fallback={<LoadingCard />}>
      <LazyOverlay />
    </Suspense>
  );
}

function LoadingCard(): JSX.Element {
  return (
    <div style={backdropStyle} role="status" aria-label="Opening Design Studio">
      <div style={cardStyle}>Opening Design Studio…</div>
    </div>
  );
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1010,
  display: 'grid',
  placeItems: 'center',
  background: 'color-mix(in srgb, var(--lf-bg-0) 70%, transparent)',
};

const cardStyle: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: 8,
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
  color: 'var(--lf-text)',
};
