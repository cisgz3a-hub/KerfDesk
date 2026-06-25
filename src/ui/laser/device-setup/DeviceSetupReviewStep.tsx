// Step 5 of the Device Setup wizard: the "ready to cut" checklist. Read-only —
// it renders computeSetupReadiness over the draft; Finish lives in the wizard
// footer and is gated on the same readiness.

import type { DeviceSetupState } from './device-setup-flow';
import { computeSetupReadiness, type SetupChecklistItem } from './device-setup-readiness';

export function DeviceSetupReviewStep({
  state,
}: {
  readonly state: DeviceSetupState;
}): JSX.Element {
  // Score against the detected snapshot the draft was seeded from (state.detected),
  // not the live store, so the checklist always reflects what Finish will commit.
  const readiness = computeSetupReadiness(state.draft, state.detected);
  return (
    <section style={sectionStyle}>
      <p style={readiness.ready ? readyStyle : pendingStyle}>
        {readiness.ready
          ? 'This machine is ready to cut. Finish to save the profile.'
          : 'Resolve the flagged items below, then Finish.'}
      </p>
      <ul style={listStyle}>
        {readiness.items.map((item) => (
          <ChecklistRow key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}

function ChecklistRow({ item }: { readonly item: SetupChecklistItem }): JSX.Element {
  const attention = item.status === 'needs-attention';
  return (
    <li style={rowStyle}>
      <span aria-hidden style={attention ? warnMarkStyle : okMarkStyle}>
        {attention ? '!' : '✓'}
      </span>
      <span style={labelStyle}>{item.label}</span>
      <span style={detailStyle}>{item.detail}</span>
    </li>
  );
}

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const readyStyle: React.CSSProperties = { margin: 0, fontWeight: 600, color: 'var(--lf-success)' };
const pendingStyle: React.CSSProperties = {
  margin: 0,
  fontWeight: 600,
  color: 'var(--lf-warning)',
};
const listStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  fontSize: 12,
};
const okMarkStyle: React.CSSProperties = { color: 'var(--lf-success)', fontWeight: 700, width: 12 };
const warnMarkStyle: React.CSSProperties = {
  color: 'var(--lf-warning)',
  fontWeight: 700,
  width: 12,
};
const labelStyle: React.CSSProperties = { width: 120, color: 'var(--lf-text-muted)' };
const detailStyle: React.CSSProperties = { color: 'var(--lf-text)' };
