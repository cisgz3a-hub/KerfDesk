import { findRegistrationBoxes } from '../../core/scene';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { QuickNestDialog } from './QuickNestDialog';
import { ProductionNestDialogHost } from './ProductionNestDialogHost';
import { useEffect, useRef, useState } from 'react';
import { startNestingSearch, type NestingSearch } from './nesting-worker-client';
import type { NestingProgress } from '../../core/nesting/layout-nest';
import type { PreparedNest } from '../state/nest-actions';

export function QuickNestDialogHost(props: { readonly onClose: () => void }): JSX.Element {
  const boardAvailable = useStore((state) => findRegistrationBoxes(state.project.scene).length > 0);
  const project = useStore((state) => state.project);
  const pushToast = useToastStore((state) => state.pushToast);
  const [progress, setProgress] = useState<NestingProgress | null>(null);
  const [draft, setDraft] = useState<PreparedNest | null>(null);
  const [running, setRunning] = useState(false);
  const [production, setProduction] = useState(false);
  const owner = useRef<{ search: NestingSearch | null } | null>(null);
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
  if (production)
    return <ProductionNestDialogHost onClose={props.onClose} onBack={() => setProduction(false)} />;
  return (
    <QuickNestDialog
      boardAvailable={boardAvailable}
      running={running}
      progress={progress}
      {...(draft === null ? {} : { input: draft.input })}
      stale={draft !== null && project !== draft.project}
      onCancel={() => {
        reset();
        props.onClose();
      }}
      onProduction={() => {
        reset();
        setProduction(true);
      }}
      onReset={reset}
      onStop={() => owner.current?.search?.cancel()}
      onApply={(options) => {
        reset();
        const prepared = useStore.getState().prepareNestSelection(options);
        if (!prepared.ok) {
          pushToast(prepared.reason, 'error');
          return;
        }
        const session: { search: NestingSearch | null } = { search: null };
        owner.current = session;
        setDraft(prepared);
        setRunning(true);
        setProgress({ attempted: 0, total: prepared.input.optimise ? 24 : 1, best: null });
        launchNestSearch(prepared, session, owner, setProgress, setRunning, pushToast);
      }}
      onAcceptBest={() => {
        const best = progress?.best;
        if (draft === null || best === null || best === undefined) return;
        owner.current?.search?.cancel();
        const result = useStore.getState().acceptNestSelection(draft, best);
        if (!result.ok) {
          pushToast(result.reason, 'error');
          return;
        }
        reset();
        props.onClose();
        const fallback = result.boundsFallbackUnits ?? 0;
        pushToast(
          fallback === 0
            ? `Nested ${result.packedUnits} unit(s).`
            : `Nested ${result.packedUnits} unit(s); ${fallback} used rectangular bounds.`,
          'success',
        );
      }}
    />
  );
}

function launchNestSearch(
  prepared: PreparedNest,
  session: { search: NestingSearch | null },
  owner: React.MutableRefObject<{ search: NestingSearch | null } | null>,
  setProgress: (value: NestingProgress) => void,
  setRunning: (value: boolean) => void,
  pushToast: (message: string, variant: 'error') => void,
): void {
  try {
    session.search = startNestingSearch(prepared.input, (next) => {
      if (owner.current === session) setProgress(next);
    });
    void session.search.result.then(
      () => {
        if (owner.current === session) setRunning(false);
      },
      (error: unknown) => {
        if (owner.current !== session) return;
        setRunning(false);
        pushToast(error instanceof Error ? error.message : 'Nesting failed.', 'error');
      },
    );
  } catch (error) {
    setRunning(false);
    pushToast(
      error instanceof Error ? error.message : 'Background nesting is unavailable.',
      'error',
    );
  }
}
