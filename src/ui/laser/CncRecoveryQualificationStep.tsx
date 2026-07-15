import type { CncSupervisedRecoveryReview } from './cnc-supervised-recovery-flow';

export type CncRecoveryReviewDraft = Omit<CncSupervisedRecoveryReview, 'uncertaintyEventId'>;

export function CncRecoveryQualificationStep(props: {
  readonly review: CncRecoveryReviewDraft;
  readonly onChange: (review: CncRecoveryReviewDraft) => void;
}): JSX.Element {
  const { review, onChange } = props;
  return (
    <div>
      <div style={dangerStyle}>
        Do not continue while the cutter is embedded, touching stock, or in an unknown position.
        Clear it using the machine manufacturer&apos;s procedure first.
      </div>
      <p style={bodyStyle}>
        These are physical observations, not facts KerfDesk can infer from controller
        acknowledgements. Check each item only after inspecting the machine.
      </p>
      <div style={checksStyle}>
        <ReviewCheck
          label="The cutter is physically clear of stock and safe to move."
          checked={review.cutterClear}
          onChange={(cutterClear) => onChange({ ...review, cutterClear })}
        />
        <ReviewCheck
          label="The spindle is physically stopped before inspection and requalification."
          checked={review.spindleStopped}
          onChange={(spindleStopped) => onChange({ ...review, spindleStopped })}
        />
        <ReviewCheck
          label="Position was re-homed or requalified; G54 XY/WCS and Z zero were verified."
          checked={review.positionRequalified}
          onChange={(positionRequalified) => onChange({ ...review, positionRequalified })}
        />
        <ReviewCheck
          label="The correct installed tool was inspected and is intact."
          checked={review.toolInspected}
          onChange={(toolInspected) => onChange({ ...review, toolInspected })}
        />
        <ReviewCheck
          label="Stock, clamps, fixtures, and workholding are unchanged and secure."
          checked={review.workholdingConfirmed}
          onChange={(workholdingConfirmed) => onChange({ ...review, workholdingConfirmed })}
        />
        <ReviewCheck
          label="All machining before the selected uncertainty segment is known complete."
          checked={review.priorWorkConfirmed}
          onChange={(priorWorkConfirmed) => onChange({ ...review, priorWorkConfirmed })}
        />
        <ReviewCheck
          label="The displayed tangent runway through the preceding segment is physically clear."
          checked={review.clearedPathConfirmed}
          onChange={(clearedPathConfirmed) => onChange({ ...review, clearedPathConfirmed })}
        />
      </div>
      <label style={fieldStyle}>
        Machine-specific runway qualification record
        <input
          aria-label="CNC recovery runway qualification record"
          title="Enter the machine-specific air-cut or scrap-test record that qualified this runway profile."
          value={review.qualificationId}
          onChange={(event) => onChange({ ...review, qualificationId: event.currentTarget.value })}
          placeholder="Example: AIR-CUT-2026-07-15"
          autoComplete="off"
        />
      </label>
      <p style={hintStyle}>
        Enter the ID or date of the air-cut/scrap test that validated these recovery-runway
        assumptions on this machine. A generic profile name is not a qualification record.
      </p>
    </div>
  );
}

export function isCncRecoveryReviewComplete(review: CncRecoveryReviewDraft): boolean {
  return (
    review.cutterClear &&
    review.spindleStopped &&
    review.positionRequalified &&
    review.toolInspected &&
    review.workholdingConfirmed &&
    review.priorWorkConfirmed &&
    review.clearedPathConfirmed &&
    review.qualificationId.trim().length > 0
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

const dangerStyle: React.CSSProperties = {
  border: '1px solid var(--lf-danger)',
  borderRadius: 6,
  padding: '8px 10px',
  color: 'var(--lf-danger)',
  fontWeight: 650,
  fontSize: 12,
};
const bodyStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  lineHeight: 1.5,
};
const checksStyle: React.CSSProperties = { display: 'grid', gap: 8, marginBlock: 12 };
const checkStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  fontSize: 12,
  lineHeight: 1.4,
};
const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gap: 5,
  fontSize: 12,
  fontWeight: 650,
};
const hintStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 11,
  lineHeight: 1.4,
};
