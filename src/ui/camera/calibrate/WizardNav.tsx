// WizardNav — Back and Next for the guided camera setup's screens (ADR-663),
// Next on the right as the one primary action.

import type { CSSProperties } from 'react';

export function WizardNav(props: {
  readonly onBack?: () => void;
  readonly onNext: () => void;
  readonly nextLabel?: string;
  readonly nextDisabled?: boolean;
  readonly nextTitle: string;
}): JSX.Element {
  return (
    <div style={navStyle}>
      {props.onBack === undefined ? null : (
        <button
          type="button"
          className="lf-btn"
          onClick={props.onBack}
          title="Back to the previous step."
        >
          Back
        </button>
      )}
      <span style={spacerStyle} />
      <button
        type="button"
        className="lf-btn lf-btn--primary"
        disabled={props.nextDisabled}
        onClick={props.onNext}
        title={props.nextTitle}
      >
        {props.nextLabel ?? 'Next'}
      </button>
    </div>
  );
}

const navStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 };
const spacerStyle: CSSProperties = { flex: 1 };
