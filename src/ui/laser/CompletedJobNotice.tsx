import type { CSSProperties } from 'react';
import {
  completedJobCanBeDismissed,
  dismissCompletedJobDisplay,
} from '../state/completed-job-display';
import { useLaserStore } from '../state/laser-store';

/** A compact completion acknowledgement in the persistent job-actions dock. */
export function CompletedJobNotice(): JSX.Element | null {
  // Subscribe to stable values: trailing status polls keep replacing the run.
  const canDismiss = useLaserStore(completedJobCanBeDismissed);
  const plan = useLaserStore((state) => state.liveCanvasRun?.plan);
  const startedAtMs = useLaserStore((state) => state.liveCanvasRun?.startedAtMs);
  if (!canDismiss || plan === undefined || startedAtMs === undefined) return null;
  return (
    <section aria-label="Completed job" style={noticeStyle}>
      <div style={messageStyle} role="status">
        <strong style={headingStyle}>Job complete</strong>
        <span style={detailStyle}>Clear preview. Keep design.</span>
      </div>
      <button
        type="button"
        className="lf-btn lf-btn--primary"
        style={buttonStyle}
        title="Clear the completed run display. Keep the artwork and saved job history."
        onClick={() => dismissCompletedJobDisplay({ plan, startedAtMs })}
      >
        Done
      </button>
    </section>
  );
}

const noticeStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  boxSizing: 'border-box',
  padding: '6px 8px',
  background: 'var(--lf-bg-1)',
  border: '1px solid var(--lf-border)',
  borderLeft: '3px solid var(--lf-success)',
  borderRadius: 'var(--lf-radius-md)',
};
const messageStyle: CSSProperties = {
  display: 'grid',
  gap: 1,
  minWidth: 0,
};
const headingStyle: CSSProperties = {
  fontSize: 14,
  lineHeight: 1.3,
  color: 'var(--lf-success-fg)',
};
const detailStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.3,
  color: 'var(--lf-text-muted)',
};
const buttonStyle: CSSProperties = { minHeight: 40, minWidth: 64 };
