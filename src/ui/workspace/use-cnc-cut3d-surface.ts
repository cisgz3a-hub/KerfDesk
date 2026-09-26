import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
import type { RemovalGrid } from '../../core/sim';
import {
  isCncRemovalGridSuperseded,
  prepareCncCut3DSurfaceOffThread,
} from './cnc-removal-grid-worker-client';
import { createCoalescedJob, type CoalescedOutcome } from './coalesced-preview-job';

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

/** Lazy surface preparation for the explicit Cut 3D dialog. While a newer
 * grid is prepared the last surface stays up, so the open viewer keeps its
 * canvas and camera instead of dropping to a spinner. A newer grid waits for
 * the running surface rather than cancelling it (ADR-425), so playback on a
 * slow machine still swaps new surfaces in. */
export function useCncCut3DSurface(
  grid: RemovalGrid | null,
  active: boolean,
): CncCut3DSurfaceState {
  const [stored, setStored] = useState<StoredState | null>(null);
  const [lastReady, setLastReady] = useState<ReadySurface | null>(null);
  const nextRevision = useRef(0);

  const job = useMemo(() => {
    if (!active) return null;
    return createCoalescedJob<RemovalGrid, ReliefSurfaceMeshWithNormals>(
      (target, signal) => prepareCncCut3DSurfaceOffThread(target, signal),
      (target, outcome) => {
        if (outcome.kind !== 'done') {
          setStored({ grid: target, value: unavailable(outcome) });
          return;
        }
        nextRevision.current += 1;
        const ready: ReadySurface = {
          kind: 'ready',
          mesh: outcome.value,
          revision: nextRevision.current,
          updating: false,
        };
        setStored({ grid: target, value: ready });
        setLastReady(ready);
      },
      isCncRemovalGridSuperseded,
    );
  }, [active]);

  useEffect(() => {
    if (job === null) {
      setStored(null);
      setLastReady(null);
      return;
    }
    return () => job.cancel();
  }, [job]);
  useEffect(() => {
    if (job === null) return;
    if (grid !== null) {
      job.request(grid);
      return;
    }
    job.cancel();
    setStored(null);
    setLastReady(null);
  }, [job, grid]);

  if (!active || grid === null) return IDLE;
  const value = stored?.grid === grid ? stored.value : LOADING;
  return value.kind === 'loading' && lastReady !== null ? { ...lastReady, updating: true } : value;
}

function unavailable(
  outcome: Exclude<CoalescedOutcome<unknown>, { readonly kind: 'done' }>,
): Extract<CncCut3DSurfaceState, { readonly kind: 'unavailable' }> {
  if (outcome.kind === 'unavailable') {
    return { kind: 'unavailable', reason: 'Background 3D preparation is unavailable.' };
  }
  return {
    kind: 'unavailable',
    reason:
      outcome.error instanceof Error
        ? outcome.error.message
        : 'Background 3D preparation did not complete.',
  };
}
