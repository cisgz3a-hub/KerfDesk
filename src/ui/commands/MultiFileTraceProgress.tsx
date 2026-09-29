// Non-modal Multi-File Trace progress (rank 21): "Tracing i of N" with a
// Cancel that aborts the batch. The editor stays usable while it runs.

import { create } from 'zustand';
import { Button } from '../kit';

export type MultiFileTraceProgressState = {
  readonly current: number;
  readonly total: number;
  readonly cancel: () => void;
  readonly cancelling: boolean;
  // Which batch the panel belongs to, so a batch closes only its own panel.
  readonly token: symbol;
};

type ProgressStore = {
  readonly progress: MultiFileTraceProgressState | null;
};

export const useMultiFileTraceProgress = create<ProgressStore>(() => ({ progress: null }));

/** Whether a Multi-File Trace batch is running (one runs at a time). */
export function isMultiFileTraceRunning(): boolean {
  return useMultiFileTraceProgress.getState().progress !== null;
}

/** Show the panel for a batch of `total` files; returns its updater and closer. */
export function beginMultiFileTraceProgress(
  total: number,
  abort: () => void,
): {
  readonly update: (current: number) => void;
  readonly end: () => void;
} {
  const token = Symbol('multi-file-trace');
  const own = (): MultiFileTraceProgressState | null => {
    const progress = useMultiFileTraceProgress.getState().progress;
    return progress?.token === token ? progress : null;
  };
  const cancel = (): void => {
    const progress = own();
    if (progress !== null)
      useMultiFileTraceProgress.setState({ progress: { ...progress, cancelling: true } });
    abort();
  };
  useMultiFileTraceProgress.setState({
    progress: { current: 0, total, cancel, cancelling: false, token },
  });
  return {
    update: (current) => {
      const progress = own();
      if (progress !== null)
        useMultiFileTraceProgress.setState({ progress: { ...progress, current } });
    },
    end: () => {
      if (own() !== null) useMultiFileTraceProgress.setState({ progress: null });
    },
  };
}

export function MultiFileTraceProgressPanel(): JSX.Element | null {
  const progress = useMultiFileTraceProgress((state) => state.progress);
  if (progress === null) return null;
  const text = progress.cancelling
    ? 'Cancelling Multi-File Trace...'
    : `Tracing ${Math.max(1, progress.current)} of ${progress.total}`;
  return (
    <section role="status" aria-label="Multi-File Trace progress" style={panelStyle}>
      <span>{text}</span>
      <Button
        aria-label="Cancel Multi-File Trace"
        disabled={progress.cancelling}
        onClick={progress.cancel}
      >
        Cancel
      </Button>
    </section>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  left: 16,
  bottom: 16,
  zIndex: 900,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 12px',
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  background: 'var(--lf-surface)',
  color: 'var(--lf-text)',
  fontSize: 12,
};
