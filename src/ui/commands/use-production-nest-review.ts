import { useEffect, useRef, useState } from 'react';
import type {
  ProductionNestDefinition,
  ProductionNestingProgress,
} from '../../core/nesting/production-nest';
import type { PreparedProductionNest } from '../state/prepare-production-nest';
import {
  startProductionNestingSearch,
  type ProductionNestingSearch,
} from './production-nesting-worker-client';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';

type SearchOwner = { search: ProductionNestingSearch | null };
export function useProductionNestReview(onClose: () => void) {
  const project = useStore((state) => state.project);
  const pushToast = useToastStore((state) => state.pushToast);
  const owner = useRef<SearchOwner | null>(null);
  const [draft, setDraft] = useState<PreparedProductionNest | null>(null);
  const [progress, setProgress] = useState<ProductionNestingProgress | null>(null);
  const [running, setRunning] = useState(false);
  useEffect(
    () => () => {
      owner.current?.search?.cancel();
      owner.current = null;
    },
    [],
  );
  const reset = (): void => {
    owner.current?.search?.cancel();
    owner.current = null;
    setDraft(null);
    setProgress(null);
    setRunning(false);
  };
  const calculate = (definition: ProductionNestDefinition): void => {
    reset();
    const prepared = useStore.getState().prepareProductionNest(definition);
    if (prepared.kind === 'invalid') {
      pushToast(prepared.reason, 'error');
      return;
    }
    const session: SearchOwner = { search: null };
    owner.current = session;
    setDraft(prepared.value);
    setProgress({ attempted: 0, total: definition.optimise ? 24 : 1, best: null });
    setRunning(true);
    launchProductionSearch(prepared.value, session, owner, setProgress, setRunning, pushToast);
  };
  const accept = (partial: boolean): void => {
    if (draft === null || progress?.best === null || progress?.best === undefined) return;
    const result = useStore.getState().acceptProductionNest(draft, progress.best, partial);
    if (result.kind === 'invalid') {
      pushToast(result.reason, 'error');
      return;
    }
    reset();
    onClose();
    pushToast(
      'Generated ' +
        result.value +
        ' copies in named production sheets. The source design is still active.',
      'success',
    );
  };
  return {
    draft,
    progress,
    running,
    stale: draft !== null && draft.project !== project,
    reset,
    calculate,
    accept,
    stop: () => owner.current?.search?.cancel(),
  };
}
function launchProductionSearch(
  prepared: PreparedProductionNest,
  session: SearchOwner,
  owner: React.MutableRefObject<SearchOwner | null>,
  setProgress: (progress: ProductionNestingProgress) => void,
  setRunning: (running: boolean) => void,
  pushToast: (message: string, variant: 'error') => void,
): void {
  try {
    session.search = startProductionNestingSearch(prepared.input, (progress) => {
      if (owner.current === session) setProgress(progress);
    });
    void session.search.result.then(
      () => {
        if (owner.current === session) setRunning(false);
      },
      (error: unknown) => {
        if (owner.current !== session) return;
        setRunning(false);
        pushToast(error instanceof Error ? error.message : 'Quantity nesting failed.', 'error');
      },
    );
  } catch (error) {
    setRunning(false);
    pushToast(
      error instanceof Error ? error.message : 'Background quantity nesting is unavailable.',
      'error',
    );
  }
}
