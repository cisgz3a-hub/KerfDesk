import type { PlatformAdapter } from '../../platform/types';
import { openProjectCommand } from '../commands/open-project-command';
import { Button } from '../kit';
import { useLaserStore } from '../state/laser-store';
import { isActiveJobStatus } from '../state/laser-store-helpers';
import { useToastStore } from '../state/toast-store';
import { usePendingProjectOpenStore } from './external-project-open';

/** A project file the operating system handed over during a job (ADR-378).
 * Nonmodal, so Pause and Abort stay in reach; Open waits for the job to end. */
export function PendingProjectOpenBanner(props: {
  readonly platform: PlatformAdapter;
}): JSX.Element | null {
  const file = usePendingProjectOpenStore((state) => state.file);
  const jobActive = useLaserStore((state) => isActiveJobStatus(state.streamer?.status ?? null));
  if (file === null) return null;
  const open = (): void => {
    const waiting = usePendingProjectOpenStore.getState().take();
    if (waiting === null) return;
    const pushToast = useToastStore.getState().pushToast;
    void openProjectCommand(props.platform, pushToast, {
      file: waiting,
      stillAllowed: () => {
        if (!isActiveJobStatus(useLaserStore.getState().streamer?.status ?? null)) return true;
        usePendingProjectOpenStore.getState().hold(waiting);
        return false;
      },
    });
  };
  return (
    <section role="status" aria-label="Project waiting to open" style={bannerStyle}>
      <span>
        <strong>{file.name}</strong>{' '}
        {jobActive
          ? "is waiting to open. KerfDesk won't replace the project while a job is running."
          : 'is waiting to open.'}
      </span>
      <div style={actionsStyle}>
        <Button
          variant="primary"
          disabled={jobActive}
          title={jobActive ? 'Available when the job has finished' : `Open ${file.name}`}
          onClick={open}
        >
          Open project
        </Button>
        <Button onClick={() => usePendingProjectOpenStore.getState().dismiss()}>Dismiss</Button>
      </div>
    </section>
  );
}

const bannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 12,
  padding: '8px 12px',
  borderBottom: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
  color: 'var(--lf-text)',
  fontSize: 12,
};
const actionsStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 };
