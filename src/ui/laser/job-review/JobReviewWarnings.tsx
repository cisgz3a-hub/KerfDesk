// Display-only warnings for the Job Review dialog (ADR-224 v2): a collapsed
// amber dropdown whose summary always shows the count, expanding to the full
// list. Never gates Confirm — these are the strings the start flow used to
// flash in a toast, plus the job-intent set, held still and grouped.

import {
  warnDetailsStyle,
  warnHintStyle,
  warnListStyle,
  warnSummaryStyle,
} from './job-review.styles';

export function JobReviewWarnings(props: {
  readonly warnings: ReadonlyArray<string>;
}): JSX.Element | null {
  if (props.warnings.length === 0) return null;
  return (
    <details style={warnDetailsStyle}>
      <summary
        style={warnSummaryStyle}
        title="Expand to read every warning for this job. Warnings never block the start."
      >
        Warnings ({props.warnings.length}){' '}
        <span style={warnHintStyle}>— open to review; none block the start</span>
      </summary>
      <ul style={warnListStyle}>
        {props.warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </details>
  );
}
