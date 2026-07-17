// Amber, display-only warnings strip for the Job Review dialog (ADR-224).
// Never gates Confirm — these are the same strings the start flow used to
// flash in a toast, plus the job-intent set, held still so the operator can
// actually read them.

import { bannerListStyle, bannerStyle } from './job-review.styles';

export function JobReviewWarnings(props: {
  readonly warnings: ReadonlyArray<string>;
}): JSX.Element | null {
  if (props.warnings.length === 0) return null;
  return (
    <div role="status" className="lf-banner lf-banner--warning" style={bannerStyle}>
      <strong>Warnings — review before starting</strong>
      <ul style={bannerListStyle}>
        {props.warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}
