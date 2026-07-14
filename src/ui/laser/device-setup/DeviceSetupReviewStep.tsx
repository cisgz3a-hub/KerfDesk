// Step 5 of the Device Setup wizard: the "ready to cut" checklist. Read-only —
// it renders computeSetupReadiness over the draft; Finish lives in the wizard
// footer and is gated on the same readiness.

import { assertNever } from '../../../core/scene';
import { Button } from '../../kit';
import type { DeviceSetupStep, DeviceSetupStepProps } from './device-setup-flow';
import {
  computeSetupReadiness,
  type SetupChecklistItem,
  type SetupChecklistItemId,
} from './device-setup-readiness';

export function DeviceSetupReviewStep({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  // Score against the detected snapshot the draft was seeded from (state.detected),
  // not the live store, so the checklist always reflects what Finish will commit.
  const readiness = computeSetupReadiness(state.draft, state.detected, state.machineKind);
  return (
    <section style={sectionStyle}>
      <p style={readiness.ready ? readyStyle : pendingStyle}>
        {readiness.ready
          ? 'This machine is ready to cut. Finish to save the profile.'
          : 'Resolve the flagged items below, then Finish.'}
      </p>
      <ul style={listStyle}>
        {readiness.items.map((item) => (
          <ChecklistRow
            key={item.id}
            item={item}
            onEdit={() => dispatch({ kind: 'go', step: editStepForChecklistItem(item.id) })}
          />
        ))}
      </ul>
    </section>
  );
}

function ChecklistRow(props: {
  readonly item: SetupChecklistItem;
  readonly onEdit: () => void;
}): JSX.Element {
  const { item } = props;
  const attention = item.status === 'needs-attention';
  return (
    <li style={rowStyle}>
      <span aria-hidden style={attention ? warnMarkStyle : okMarkStyle}>
        {attention ? '!' : '✓'}
      </span>
      <span style={labelStyle}>{item.label}</span>
      <span style={detailStyle}>{item.detail}</span>
      <Button variant="ghost" onClick={props.onEdit} aria-label={`Edit ${item.label}`}>
        Edit
      </Button>
    </li>
  );
}

export function editStepForChecklistItem(item: SetupChecklistItemId): DeviceSetupStep {
  switch (item) {
    case 'identity':
    case 'laser-head':
      return 'identify';
    case 'bed':
    case 'power-scale':
    case 'spindle':
      return 'confirm';
    case 'origin':
    case 'homing':
      return 'safety';
    default:
      return assertNever(item);
  }
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
  display: 'grid',
  gridTemplateColumns: '12px 120px minmax(0, 1fr) auto',
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
const labelStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
const detailStyle: React.CSSProperties = { color: 'var(--lf-text)' };
