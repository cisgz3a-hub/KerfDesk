import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { SOFTWARE_ABORT_LABEL, SOFTWARE_ABORT_TITLE } from '../common/software-abort-copy';

const MAXIMUM_STACKING_ORDER = 2_147_483_647;

export function PersistentJobStop(): JSX.Element | null {
  const isJobActive = useLaserStore((state) => isActiveJob(state.streamer));
  const stopJob = useLaserStore((state) => state.stopJob);
  if (!isJobActive) return null;
  return (
    <button
      type="button"
      className="lf-btn lf-btn--danger"
      style={persistentStopStyle}
      title={SOFTWARE_ABORT_TITLE}
      onClick={() => void stopJob().catch(() => undefined)}
    >
      {SOFTWARE_ABORT_LABEL}
    </button>
  );
}

const persistentStopStyle: React.CSSProperties = {
  position: 'fixed',
  top: 8,
  right: 8,
  zIndex: MAXIMUM_STACKING_ORDER,
  minWidth: 112,
  minHeight: 44,
  fontWeight: 700,
  boxShadow: 'var(--lf-shadow)',
};
