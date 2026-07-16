// The load-bearing physical confirmations for pass-boundary CNC recovery
// (ADR-215) plus the position-evidence choice. These are physical
// observations KerfDesk cannot infer from controller acknowledgements.

import type { CncPassRecoveryChecklistDraft } from './cnc-pass-recovery-review';

export function CncPassRecoveryChecklist(props: {
  readonly checklist: CncPassRecoveryChecklistDraft;
  /** Null when the retained-position path is available for this incident. */
  readonly retainedPositionIssue: string | null;
  readonly onChange: (checklist: CncPassRecoveryChecklistDraft) => void;
}): JSX.Element {
  const { checklist, onChange } = props;
  const retained = checklist.position?.kind === 'retained-confirmed';
  return (
    <div style={sectionStyle}>
      <p style={bodyStyle}>
        Check each item only after inspecting the machine — these are physical facts, not values the
        app can read from the controller.
      </p>
      <div style={checksStyle}>
        <ReviewCheck
          label="The cutter is physically clear of stock and safe to move."
          checked={checklist.cutterClear}
          onChange={(cutterClear) => onChange({ ...checklist, cutterClear })}
        />
        <ReviewCheck
          label="The spindle is physically stopped."
          checked={checklist.spindleStopped}
          onChange={(spindleStopped) => onChange({ ...checklist, spindleStopped })}
        />
        <ReviewCheck
          label="Stock, clamps, fixtures, and workholding are unchanged and secure."
          checked={checklist.workholdingConfirmed}
          onChange={(workholdingConfirmed) => onChange({ ...checklist, workholdingConfirmed })}
        />
        <ReviewCheck
          label="The required tool is installed, intact, and Z-zeroed for this job."
          checked={checklist.toolConfirmed}
          onChange={(toolConfirmed) => onChange({ ...checklist, toolConfirmed })}
        />
      </div>
      <fieldset style={positionStyle}>
        <legend style={legendStyle}>Position and work zero</legend>
        <label style={radioStyle}>
          <input
            type="radio"
            name="cnc-pass-recovery-position"
            checked={retained}
            disabled={props.retainedPositionIssue !== null}
            title="Keep the controller's retained position — available only with session-continuity evidence."
            onChange={() => onChange({ ...checklist, position: { kind: 'retained-confirmed' } })}
          />
          <span>
            Position retained — the controller kept power, the work offset matches the interrupted
            run, and nothing was moved by hand except extraction jogs.
          </span>
        </label>
        {props.retainedPositionIssue !== null ? (
          <p style={retainedIssueStyle}>{props.retainedPositionIssue}</p>
        ) : null}
        <label style={radioStyle}>
          <input
            type="radio"
            name="cnc-pass-recovery-position"
            checked={checklist.position?.kind === 're-zeroed'}
            title="Position was re-established by hand before recovery."
            onChange={() => onChange({ ...checklist, position: { kind: 're-zeroed' } })}
          />
          <span>I re-established the XY/Z zero against my reference before this recovery.</span>
        </label>
      </fieldset>
    </div>
  );
}

function ReviewCheck(props: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label style={checkStyle}>
      <input
        type="checkbox"
        title={props.label}
        checked={props.checked}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

const sectionStyle: React.CSSProperties = { marginTop: 12 };
const bodyStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  lineHeight: 1.5,
};
const checksStyle: React.CSSProperties = { display: 'grid', gap: 8, marginBlock: 10 };
const checkStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  fontSize: 12,
  lineHeight: 1.4,
};
const positionStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: '8px 10px',
  display: 'grid',
  gap: 8,
};
const legendStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, padding: '0 4px' };
const radioStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  fontSize: 12,
  lineHeight: 1.4,
};
const retainedIssueStyle: React.CSSProperties = {
  color: 'var(--lf-warning)',
  fontSize: 11,
  margin: '0 0 0 24px',
};
