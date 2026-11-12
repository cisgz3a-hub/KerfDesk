// The Live Motion bar for a job on a controller link outside the laser store:
// a Moshiboard over USB or a Ruida over the network (ADR-705 Amendment 3).
// Their panels sit in the Machine details popover, which unmounts on any
// outside click, so this always-mounted bar keeps an Abort reachable from any
// window state while the link works (PROJECT.md non-negotiable 9; code quality
// audit C2 D1-P2-5) and keeps the job's warnings in view while it runs
// (D1-P2-1). It reads only the boot-side registry, never the link stores.

import { MODAL_REACHABLE_ATTRIBUTE } from '../common/hide-outside-modal';
import {
  activeLinkMachineWork,
  useLinkMachineWorkStore,
  type LinkMachineWork,
} from '../state/link-machine-work';
import { LiveMotionAbortButton } from './LiveMotionAbortButton';
import { LIVE_MOTION_INSET_PROPERTY } from './use-live-motion-inset';

const ACTIVITY_TEXT: Readonly<Record<LinkMachineWork['activity'], string>> = {
  framing: 'is tracing the Frame (laser off)',
  running: 'is running the job',
  homing: 'is homing',
  jogging: 'is jogging the head',
  paused: 'holds the job paused',
  stopping: 'is being stopped',
};

export function LinkMachineWorkBar(): JSX.Element | null {
  const work = useLinkMachineWorkStore(activeLinkMachineWork);
  if (work === null) return null;
  const job = work.activity === 'running' || work.activity === 'paused';
  return (
    <section
      aria-label="Live Motion (controller link)"
      style={barStyle}
      {...{ [MODAL_REACHABLE_ATTRIBUTE]: '' }}
    >
      <div style={statusStyle}>
        <strong style={headingStyle}>
          {work.controller} {ACTIVITY_TEXT[work.activity]}
        </strong>
        {work.advisories.length > 0 && (
          <ul aria-label="Job warnings" style={warningsStyle}>
            {work.advisories.map((advisory) => (
              <li key={advisory}>{advisory}</li>
            ))}
          </ul>
        )}
        <span style={safetyStyle}>
          Software controller stop — use the machine&apos;s own stop or power isolation for danger.
        </span>
      </div>
      <LiveMotionAbortButton label={job ? 'ABORT JOB' : 'ABORT MOTION'} abort={work.abort} />
    </section>
  );
}

// Above the laser's Live Motion bar when both show: that bar publishes the
// height it covers as --lf-live-motion-inset; without it, its usual 34 px.
const barStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: `var(${LIVE_MOTION_INSET_PROPERTY}, 34px)`,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 2_147_483_647,
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '6px 16px',
  width: 'max-content',
  maxWidth: 'min(720px, calc(100vw - 24px))',
  boxSizing: 'border-box',
  padding: '8px 14px',
  background: 'var(--lf-bg-1)',
  border: '1px solid var(--lf-border)',
  borderTop: '3px solid var(--lf-danger)',
  borderRadius: 'var(--lf-radius-lg)',
  boxShadow: 'var(--lf-shadow)',
};
const statusStyle: React.CSSProperties = {
  display: 'flex',
  flex: '1 1 280px',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
};
const headingStyle: React.CSSProperties = { color: 'var(--lf-danger-fg)', fontSize: 15 };
const warningsStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  color: 'var(--lf-text)',
  fontSize: 12,
};
const safetyStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
