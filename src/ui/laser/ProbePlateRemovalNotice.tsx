// ProbePlateRemovalNotice — a prominent post-probe reminder. It is mounted
// outside collapsed probe controls so the operator sees it before machining.

import { useLaserStore } from '../state/laser-store';
import { probePlateRemovalRequired } from '../state/work-z-zero-evidence';

export function ProbePlateRemovalNotice(): JSX.Element | null {
  const required = useLaserStore((state) => probePlateRemovalRequired(state.workZZeroEvidence));
  const confirm = useLaserStore((state) => state.confirmProbePlateRemoved);
  if (!required) return null;
  return (
    <div role="alert" style={noticeStyle}>
      <strong>Probe complete — remove the touch plate before machining.</strong>
      <span>Remove the touch plate and probe lead from the stock and cutter.</span>
      <button
        type="button"
        onClick={confirm}
        title="Dismiss this reminder after the touch plate and probe lead are clear of the stock and cutter."
      >
        Dismiss reminder
      </button>
    </div>
  );
}

const noticeStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 6,
  marginTop: 8,
  padding: 8,
  border: '1px solid var(--lf-warning)',
  borderRadius: 4,
  fontSize: 12,
};
