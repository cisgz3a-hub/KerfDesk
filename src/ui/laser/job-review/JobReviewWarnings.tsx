// Display-only warnings for the Job Review dialog (ADR-224 v2): an amber
// disclosure whose summary always shows the count. It normally stays collapsed,
// but opens for controller-identity evidence so the mismatch is prominent, and
// for a router job whose controller has laser mode on or unconfirmed ($32), where
// the spindle skips its spin-up (CNC audit JR-1, MC-1). The laser-mode-on row
// carries a one-click Send $32=0 (ADR-180 Amendment 6).
// Never gates Confirm — these are the strings the start flow used to
// flash in a toast, plus the job-intent set, held still and grouped.

import {
  warnDetailsStyle,
  warnHintStyle,
  warnListStyle,
  warnSummaryStyle,
} from './job-review.styles';
import {
  CNC_LASER_MODE_ENABLED_MESSAGE,
  isCncLaserModeMessage,
} from '../../../core/preflight/controller-readiness';
import { isControllerIdentityWarning } from '../controller-identity-warnings';
import { SendRouterModeButton } from './SendRouterModeButton';

export function JobReviewWarnings(props: {
  readonly warnings: ReadonlyArray<string>;
}): JSX.Element | null {
  if (props.warnings.length === 0) return null;
  return (
    <details open={props.warnings.some(opensWarningList)} style={warnDetailsStyle}>
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
            {warning === CNC_LASER_MODE_ENABLED_MESSAGE ? <SendRouterModeButton /> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function opensWarningList(warning: string): boolean {
  return isControllerIdentityWarning(warning) || isCncLaserModeMessage(warning);
}
