// Mount point for the Image Studio (ADR-242). App renders this always; the
// heavy overlay component chunk loads lazily only once a session opens, so
// non-users pay nothing at cold start (the ADR-102 lazy-import precedent).
// If that chunk can no longer be fetched (a window left on the previous build),
// the boundary shows a notice instead of crashing the app; Close stashes the
// session through the store's own closeEditor.

import { lazy, Suspense } from 'react';
import { rejectAsLoadFailure } from '../common/lazy-load-failure';
import { LazyOverlayBoundary } from '../common/LazyOverlayBoundary';
import { useImageEditorStore } from './image-editor-store';
import { useDesignStudioStore } from '../design-studio/design-studio-store';

const LazyOverlay = lazy(() =>
  import('./ImageEditorOverlay')
    .then((m) => ({ default: m.ImageEditorOverlay }))
    .catch(rejectAsLoadFailure),
);

export function ImageEditorHost(props: { readonly embedded?: boolean } = {}): JSX.Element | null {
  const hasSession = useImageEditorStore((s) => s.session !== null);
  const loadState = useImageEditorStore((s) => s.loadState);
  const closeEditor = useImageEditorStore((s) => s.closeEditor);
  const designIsOpen = useDesignStudioStore((s) => s.session !== null);
  if (designIsOpen && !props.embedded) return null;
  if (!hasSession && loadState.kind !== 'loading') return null;
  return (
    <LazyOverlayBoundary
      toolName="Image Studio"
      onClose={closeEditor}
      presentation={props.embedded ? 'inline' : 'dialog'}
    >
      <Suspense fallback={<LoadingCard embedded={props.embedded === true} />}>
        {hasSession ? (
          <LazyOverlay embedded={props.embedded === true} />
        ) : (
          <LoadingCard embedded={props.embedded === true} />
        )}
      </Suspense>
    </LazyOverlayBoundary>
  );
}

function LoadingCard(props: { readonly embedded?: boolean }): JSX.Element {
  return (
    <div
      style={{
        ...loadingBackdropStyle,
        ...(props.embedded ? { position: 'relative', flex: 1 } : {}),
      }}
      role="status"
      aria-label="Opening image"
    >
      <div style={loadingCardStyle}>Opening image…</div>
    </div>
  );
}

const loadingBackdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1010,
  display: 'grid',
  placeItems: 'center',
  background: 'color-mix(in srgb, var(--lf-bg-0) 70%, transparent)',
};

const loadingCardStyle: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: 8,
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
  color: 'var(--lf-text)',
};
