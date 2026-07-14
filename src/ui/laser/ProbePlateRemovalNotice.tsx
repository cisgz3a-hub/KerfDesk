// ProbePlateRemovalNotice — the post-probe "confirm the touch plate is
// removed" blocker. Extracted from ProbeControls so hosts can mount it
// OUTSIDE their collapsed <details>: this confirmation is the only thing
// standing between a successful probe and Start, and while it was hidden
// inside a folded section, operators "fixed" the blocked Start with Zero Z
// at the parked height instead — re-zeroing work Z in the air.

import { useLaserStore } from '../state/laser-store';
import { probePlateRemovalRequired } from '../state/work-z-zero-evidence';

export function ProbePlateRemovalNotice(): JSX.Element | null {
  const required = useLaserStore((state) => probePlateRemovalRequired(state.workZZeroEvidence));
  const confirm = useLaserStore((state) => state.confirmProbePlateRemoved);
  if (!required) return null;
  return (
    <div role="alert" style={noticeStyle}>
      <strong>Probe complete — spindle start is still blocked.</strong>
      <span>Remove the touch plate and probe lead from the stock and cutter.</span>
      <button
        type="button"
        onClick={confirm}
        title="Confirm the touch plate and probe lead are clear of the stock and cutter before the spindle starts."
      >
        Confirm plate removed
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
