// Mount point for the Design Studio (ADR-272). App renders this always; the
// Studio's session code (design-studio-runtime.ts) and its heavy overlay chunk
// load lazily only once a session opens, so a user who never opens the Studio
// pays nothing at cold start (the ADR-102 lazy-import precedent, the same shape
// as ImageEditorHost, and ADR-272 Amendment 9). This host reads only the boot
// shell. If either chunk can no longer be fetched (a window left on the
// previous build), the boundary shows a notice instead of crashing the app;
// Close stashes the drawing through the store's own closeStudio.

import { lazy, Suspense } from 'react';
import { rejectAsLoadFailure, type LazyLoadError } from '../common/lazy-load-failure';
import { LazyOverlayBoundary } from '../common/LazyOverlayBoundary';
import { closeDesignStudio, useDesignStudioShell } from './design-studio-shell';

const LazyOverlay = lazy(() =>
  import('./DesignStudioOverlay')
    .then((m) => ({ default: m.DesignStudioOverlay }))
    .catch(rejectAsLoadFailure),
);

export function DesignStudioHost(): JSX.Element | null {
  const hasSession = useDesignStudioShell((state) => state.sessionOpen);
  const loading = useDesignStudioShell((state) => state.loading);
  const loadFailure = useDesignStudioShell((state) => state.loadFailure);
  if (!hasSession && !loading && loadFailure === null) return null;
  return (
    <LazyOverlayBoundary toolName="Design Studio" onClose={closeDesignStudio}>
      <Suspense fallback={<LoadingCard />}>
        {hasSession ? <LazyOverlay /> : <RuntimePending failure={loadFailure} />}
      </Suspense>
    </LazyOverlayBoundary>
  );
}

// While the first Open fetches the session code: the same card the overlay's
// own chunk shows next. A failed fetch is thrown to the boundary's notice.
function RuntimePending(props: { readonly failure: LazyLoadError | null }): JSX.Element {
  if (props.failure !== null) throw props.failure;
  return <LoadingCard />;
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
