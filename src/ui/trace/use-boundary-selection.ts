// The Trace dialog's boundary-region selection: the boxed region plus its
// mode (crop vs enhance, ADR-113). Bundled into one hook so the dialog body
// stays small and the "clearing the box resets the mode to crop" invariant
// lives in one place instead of being re-implemented at each clear site.

import { useState } from 'react';
import type { TraceBoundary } from '../../core/trace';
import type { BoundaryMode } from './region-enhance-trace';

export type BoundarySelection = {
  readonly boundary: TraceBoundary | null;
  readonly setBoundary: (boundary: TraceBoundary | null) => void;
  readonly boundaryMode: BoundaryMode;
  readonly setBoundaryMode: (mode: BoundaryMode) => void;
  /** Clear the region AND reset the mode: 'enhance' is meaningless with no
   *  region, and the mode toggle is hidden without one (crop is the default). */
  readonly clearBoundary: () => void;
};

export function useBoundarySelection(): BoundarySelection {
  const [boundary, setBoundary] = useState<TraceBoundary | null>(null);
  const [boundaryMode, setBoundaryMode] = useState<BoundaryMode>('crop');
  const clearBoundary = (): void => {
    setBoundary(null);
    setBoundaryMode('crop');
  };
  return { boundary, setBoundary, boundaryMode, setBoundaryMode, clearBoundary };
}
