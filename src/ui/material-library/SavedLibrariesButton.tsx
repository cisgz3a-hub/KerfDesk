// Rail entry point to the Saved Libraries page (ADR-093, F-ML3). Owns the
// open/close state so the Cuts/Layers panel stays small.

import { useState } from 'react';
import { Button } from '../kit';
import { SavedLibrariesDialog } from './SavedLibrariesDialog';

export function SavedLibrariesButton(): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        aria-label="Open saved libraries"
        title="Browse, open, and manage your saved material libraries."
        onClick={() => setOpen(true)}
      >
        Saved Libraries...
      </Button>
      {open ? <SavedLibrariesDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
