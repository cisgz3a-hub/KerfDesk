import { useEffect, useRef, useState } from 'react';
import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
import type { RemovalGrid } from '../../core/sim';
import {
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
      /** True while a newer grid is prepared; the last surface stays shown. */
      readonly updating: boolean;
    }
  | { readonly kind: 'unavailable'; readonly reason: string };

type StoredState = {
  readonly grid: RemovalGrid;
  readonly value: Exclude<CncCut3DSurfaceState, { readonly kind: 'idle' }>;
};

type ReadySurface = Extract<CncCut3DSurfaceState, { readonly kind: 'ready' }>;

const IDLE: CncCut3DSurfaceState = { kind: 'idle' };
const LOADING: StoredState['value'] = { kind: 'loading' };

/** Lazy, latest-only surface preparation for the explicit Cut 3D dialog.
 * While a newer grid is prepared the last surface stays up, so the open
 * viewer keeps its canvas and camera instead of dropping to a spinner. */
export function useCncCut3DSurface(
  grid: RemovalGrid | null,
  active: boolean,
): CncCut3DSurfaceState {
  const [stored, setStored] = useState<StoredState | null>(null);
  const [lastReady, setLastReady] = useState<ReadySurface | null>(null);
  const nextRevision = useRef(0);

  useEffect(() => {
    if (!active || grid === null) {
      setStored(null);
      setLastReady(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setStored({ grid, value: LOADING });
    const pending = prepareCncCut3DSurfaceOffThread(grid, controller.signal);
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
          const ready: ReadySurface = {
            kind: 'ready',
            mesh,
            revision: nextRevision.current,
            updating: false,
          };
          setStored({ grid, value: ready });
          setLastReady(ready);
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
      controller.abort();
    };
  }, [active, grid]);

  if (!active || grid === null) return IDLE;
  const value = stored?.grid === grid ? stored.value : LOADING;
  return value.kind === 'loading' && lastReady !== null ? { ...lastReady, updating: true } : value;
}
