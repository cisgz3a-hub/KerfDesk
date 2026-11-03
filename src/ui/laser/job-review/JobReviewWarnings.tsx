// Display-only warnings for the Job Review dialog (ADR-224 v3): one short
// headline per warning, always visible, with the rest of its text one click
// away. Controller-identity evidence, a router job whose controller has laser
// mode on or unconfirmed ($32, where the spindle skips its spin-up: CNC audit
// JR-1, MC-1), a Focus Test without confirmed Z and a cut that runs before the
// engraving inside it open their detail at once.
// The laser-mode-on row carries a one-click Send $32=0 (ADR-180 Amendment 6),
// and a cut that runs before the engraving inside it a one-click Cut last
// (ADR-480 Amendment 2).
// Never gates Confirm — these are the strings the start flow used to flash
// in a toast, plus the job-intent set, held still and grouped. A beginner's
// warnings lead, and motion-policy notes they cannot act on fold under
// Technical notes (UX audit U4-P2-6, ADR-687; review-note-rank.ts).

import { useState } from 'react';
import { Icon } from '../../kit';
import {
  warnBodyStyle,
  warnBoxStyle,
  warnBulletStyle,
  warnChevronStyle,
  warnDetailTextStyle,
  warnHeadlineStyle,
  warnHintStyle,
  warnItemStyle,
  warnItemSummaryStyle,
  warnListStyle,
  warnTitleStyle,
} from './job-review.styles';
import {
  CNC_LASER_MODE_ENABLED_MESSAGE,
  isCncLaserModeMessage,
} from '../../../core/preflight/controller-readiness';
import { isFocusTestMachineWarning } from '../../../core/job/focus-test';
import { isControllerIdentityWarning } from '../controller-identity-warnings';
import { isCutBeforeEngravingWarning } from '../cut-order-warnings';
import { rankReviewNotes, technicalNotesLabel } from '../review-note-rank';
import { CutLastButton } from './CutLastButton';
import { splitReviewWarning } from './review-warning-headline';
import { SendRouterModeButton } from './SendRouterModeButton';
import { ShowOmittedFillArtworkButton } from './ShowOmittedFillArtworkButton';
import { ShowOmittedCncArtworkButton } from './ShowOmittedCncArtworkButton';
import { ShowStackedFillCopiesButton } from './ShowStackedFillCopiesButton';
import type { JobReviewCncContourOmissions } from './job-review-cnc-omissions';
import type { JobReviewStackedFillCopies } from './job-review-fill-copies';
import type { JobReviewFillOmissions } from './job-review-fill-omissions';

export function JobReviewWarnings(props: {
  readonly warnings: ReadonlyArray<string>;
  readonly openFillOmissions?: JobReviewFillOmissions;
  readonly openCncContourOmissions?: JobReviewCncContourOmissions;
  readonly stackedFillCopies?: JobReviewStackedFillCopies;
}): JSX.Element | null {
  const ranked = rankReviewNotes(props.warnings);
  const shown = [...ranked.beginner, ...ranked.warnings];
  const count = shown.length;
  if (count === 0 && ranked.technical.length === 0) return null;
  return (
    <section aria-label="Warnings" style={warnBoxStyle}>
      <h3 style={warnTitleStyle}>
        <Icon name="warning" size={13} />
        {count === 0 ? 'Notes' : `${count} ${count === 1 ? 'warning' : 'warnings'}`}
        <span style={warnHintStyle}>· none block the start</span>
      </h3>
      {count === 0 ? null : (
        <ul style={warnListStyle}>
          {shown.map((warning) => (
            <WarningItem key={warning} warning={warning} />
          ))}
        </ul>
      )}
      {ranked.technical.length === 0 ? null : (
        <details>
          <summary style={warnItemSummaryStyle}>
            {technicalNotesLabel(ranked.technical.length)}
          </summary>
          <ul style={warnListStyle}>
            {ranked.technical.map((warning) => (
              <WarningItem key={warning} warning={warning} />
            ))}
          </ul>
        </details>
      )}
      {props.openFillOmissions === undefined ? null : (
        <ShowOmittedFillArtworkButton omissions={props.openFillOmissions} />
      )}
      {props.openCncContourOmissions === undefined ? null : (
        <ShowOmittedCncArtworkButton omissions={props.openCncContourOmissions} />
      )}
      {props.stackedFillCopies === undefined ? null : (
        <ShowStackedFillCopiesButton copies={props.stackedFillCopies} />
      )}
    </section>
  );
}

function WarningItem(props: { readonly warning: string }): JSX.Element {
  const { headline, detail } = splitReviewWarning(props.warning);
  return (
    <li style={warnItemStyle}>
      <span aria-hidden="true" style={warnBulletStyle} />
      <div style={warnBodyStyle}>
        {detail === null ? (
          <span style={warnHeadlineStyle}>{headline}</span>
        ) : (
          <WarningDetail
            headline={headline}
            detail={detail}
            initiallyOpen={opensWarningDetail(props.warning)}
          />
        )}
        {props.warning === CNC_LASER_MODE_ENABLED_MESSAGE ? <SendRouterModeButton /> : null}
        {isCutBeforeEngravingWarning(props.warning) ? <CutLastButton /> : null}
      </div>
    </li>
  );
}

// The row's bullet is its only marker; a trailing chevron says it expands.
function WarningDetail(props: {
  readonly headline: string;
  readonly detail: string;
  readonly initiallyOpen: boolean;
}): JSX.Element {
  const [isOpen, setIsOpen] = useState(props.initiallyOpen);
  return (
    <details open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary style={warnItemSummaryStyle} title={isOpen ? 'Hide details' : 'Show details'}>
        {props.headline}
        <span aria-hidden="true" style={warnChevronStyle}>
          <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={10} />
        </span>
      </summary>
      <p style={warnDetailTextStyle}>{props.detail}</p>
    </details>
  );
}

function opensWarningDetail(warning: string): boolean {
  return (
    isControllerIdentityWarning(warning) ||
    isCncLaserModeMessage(warning) ||
    isFocusTestMachineWarning(warning) ||
    isCutBeforeEngravingWarning(warning)
  );
}
