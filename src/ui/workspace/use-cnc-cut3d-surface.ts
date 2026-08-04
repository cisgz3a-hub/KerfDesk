import { useEffect, useRef, useState } from 'react';
import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
import type { RemovalGrid } from '../../core/sim';
import {
  cancelCncCut3DSurfaceOffThread,
  isCncRemovalGridSuperseded,
  prepareCncCut3DSurfaceOffThread,
} from './cnc-removal-grid-worker-client';

export type CncCut3DSurfaceState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly mesh: ReliefSurfaceMeshWithNormals;
      readonly revision: number;
    }
  | { readonly kind: 'unavailable'; readonly reason: string };

type StoredState = {
  readonly grid: RemovalGrid;
  readonly value: Exclude<CncCut3DSurfaceState, { readonly kind: 'idle' }>;
};

const IDLE: CncCut3DSurfaceState = { kind: 'idle' };
const LOADING: StoredState['value'] = { kind: 'loading' };

/** Lazy, latest-only surface preparation for the explicit Cut 3D dialog. */
export function useCncCut3DSurface(
  grid: RemovalGrid | null,
  active: boolean,
): CncCut3DSurfaceState {
  const [stored, setStored] = useState<StoredState | null>(null);
  const nextRevision = useRef(0);

  useEffect(() => {
    if (!active || grid === null) {
      setStored(null);
      return;
    }
    let cancelled = false;
    setStored({ grid, value: LOADING });
    const pending = prepareCncCut3DSurfaceOffThread(grid);
    if (pending === null) {
      setStored({
        grid,
        value: { kind: 'unavailable', reason: 'Background 3D preparation is unavailable.' },
      });
      return;
    }
    void pending.then(
      (mesh) => {
        if (!cancelled) {
          nextRevision.current += 1;
          setStored({ grid, value: { kind: 'ready', mesh, revision: nextRevision.current } });
        }
      },
      (error: unknown) => {
        if (cancelled || isCncRemovalGridSuperseded(error)) return;
        setStored({
          grid,
          value: {
            kind: 'unavailable',
            reason:
              error instanceof Error
                ? error.message
                : 'Background 3D preparation did not complete.',
          },
        });
      },
    );
    return () => {
      cancelled = true;
      cancelCncCut3DSurfaceOffThread();
    };
  }, [active, grid]);

  if (!active || grid === null) return IDLE;
  return stored?.grid === grid ? stored.value : LOADING;
}
