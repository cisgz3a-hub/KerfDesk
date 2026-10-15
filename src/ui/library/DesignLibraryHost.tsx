import { lazy, Suspense } from 'react';
import { rejectAsLoadFailure } from '../common/lazy-load-failure';
import { LazyOverlayBoundary } from '../common/LazyOverlayBoundary';
import { Button, Dialog, DialogActions } from '../kit';
import { useUiStore } from '../state/ui-store';

// Keep the catalogue and its artwork out of the initial workspace load.
const LibraryContents = lazy(() =>
  import('./DesignLibraryDialog')
    .then((module) => ({ default: module.DesignLibraryContents }))
    .catch(rejectAsLoadFailure),
);

export function DesignLibraryHost(): JSX.Element | null {
  const open = useUiStore((state) => state.libraryDialogOpen);
  const setOpen = useUiStore((state) => state.setLibraryDialogOpen);
  if (!open) return null;
  const close = (): void => setOpen(false);
  // One persistent shell retains modal ownership and opener focus while the
  // contents load, including when a stale window cannot fetch the chunk.
  return (
    <Dialog title="Design Library" size="xl" panelClassName="lf-library-dialog" onClose={close}>
      <LazyOverlayBoundary toolName="Design Library" presentation="inline" onClose={close}>
        <Suspense fallback={<LoadingLibrary onClose={close} />}>
          <LibraryContents />
        </Suspense>
      </LazyOverlayBoundary>
    </Dialog>
  );
}

function LoadingLibrary({ onClose }: { readonly onClose: () => void }): JSX.Element {
  return (
    <div style={{ padding: 20 }}>
      <p role="status">Opening Design Library…</p>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </div>
  );
}
