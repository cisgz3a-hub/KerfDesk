// The safety acknowledgement section of the Job Review dialog (ADR-224).
// Absorbs the two former native start confirms with their exact prompt
// text: pressing the dialog's single Start button IS the acknowledgement,
// the same one affirmative click accepting window.confirm was before. A
// verified laser session needs none; the header shows a chip instead (v3).

import { assertNever } from '../../../core/scene';
import type { JobReviewAcknowledgement as AcknowledgementModel } from './job-review-model';
import type { JobReviewPurpose } from './job-review-store';
import { ackFootnoteStyle, ackPromptStyle, bannerStyle } from './job-review.styles';

export function JobReviewAcknowledgement(props: {
  readonly acknowledgement: AcknowledgementModel;
  readonly purpose?: JobReviewPurpose;
}): JSX.Element | null {
  const ack = props.acknowledgement;
  switch (ack.kind) {
    case 'laser-verified':
      return null;
    case 'laser-unverified':
      return (
        <AcknowledgementBanner
          heading="Confirm laser settings"
          prompt={ack.prompt}
          purpose={props.purpose ?? 'start'}
        />
      );
    case 'laser-operator-stated':
      return <OperatorStatedFact statement={ack.statement} />;
    case 'cnc':
      return (
        <AcknowledgementBanner
          heading="Confirm CNC setup"
          prompt={ack.prompt}
          purpose={props.purpose ?? 'start'}
        />
      );
    default:
      return assertNever(ack, 'job review acknowledgement');
  }
}

// The operator's own recorded statement (ADR-095 Amendment 1): a plain fact
// line, not a warning banner, and nothing to confirm. Its text says it is
// operator-stated and that KerfDesk has not checked it.
function OperatorStatedFact(props: { readonly statement: string }): JSX.Element {
  return (
    <p role="note" aria-label="Operator-stated power scale" style={ackFootnoteStyle}>
      {props.statement}
    </p>
  );
}

function AcknowledgementBanner(props: {
  readonly heading: string;
  readonly prompt: string;
  readonly purpose: JobReviewPurpose;
}): JSX.Element {
  return (
    <section
      aria-label={props.heading}
      className="lf-banner lf-banner--warning"
      style={bannerStyle}
    >
      <strong>{props.heading}</strong>
      <p style={ackPromptStyle}>{props.prompt}</p>
      <p style={ackFootnoteStyle}>Pressing {actionLabel(props.purpose)} confirms this.</p>
    </section>
  );
}

function actionLabel(purpose: JobReviewPurpose): string {
  if (purpose === 'frame') return 'Accept & Frame';
  return purpose === 'laser-second-pass' ? 'Start second pass' : 'Start job';
}
