// Warnings for the Job Review dialog (ADR-224 v2): an amber disclosure whose
// summary always shows the count. It normally stays collapsed, but opens for
// controller-identity evidence so the mismatch is prominent, and for a cut that
// runs before the work inside it, which it offers to fix with Sort cuts last
// (ADR-379). Never gates Confirm — these are the strings the start flow used to
// flash in a toast, plus the job-intent set, held still and grouped. The fix is
// an ordinary project edit: the review rebuilds, and at Start the changed job
// needs a new Frame (ADR-230). A second pass is fixed to its Frame, so it gets
// no fix.

import {
  warnDetailsStyle,
  warnFixStyle,
  warnHintStyle,
  warnListStyle,
  warnSummaryStyle,
} from './job-review.styles';
import type { JobReviewPurpose } from './job-review-store';
import { SortCutsLastButton } from '../../layers/SortCutsLastButton';
import { isControllerIdentityWarning } from '../controller-identity-warnings';
import { isCutOrderWarning } from '../cut-order-warnings';

const FIX_TITLE: Readonly<Record<JobReviewPurpose, string | null>> = {
  start:
    'Run each cut after the work inside it. This changes the job, so Frame it again before ' +
    'starting.',
  frame: 'Run each cut after the work inside it. Frame then traces the sorted job.',
  'laser-second-pass': null,
};

export function JobReviewWarnings(props: {
  readonly warnings: ReadonlyArray<string>;
  readonly purpose?: JobReviewPurpose;
}): JSX.Element | null {
  if (props.warnings.length === 0) return null;
  const fixTitle = FIX_TITLE[props.purpose ?? 'start'];
  return (
    <details open={props.warnings.some(opensWarnings)} style={warnDetailsStyle}>
      <summary
        style={warnSummaryStyle}
        title="Review every warning for this job. Warnings never block the start."
      >
        Warnings ({props.warnings.length}){' '}
        <span style={warnHintStyle}>— open to review; none block the start</span>
      </summary>
      <ul style={warnListStyle}>
        {props.warnings.map((warning) => (
          <li key={warning}>
            {warning}
            {fixTitle !== null && isCutOrderWarning(warning) ? (
              <span style={warnFixStyle}>
                <SortCutsLastButton hideWhenSorted title={fixTitle} />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function opensWarnings(warning: string): boolean {
  return isControllerIdentityWarning(warning) || isCutOrderWarning(warning);
}
