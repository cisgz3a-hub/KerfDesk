// The safety acknowledgement section of the Job Review dialog (ADR-224).
// Absorbs the two former native start confirms with their exact prompt
// text: pressing the dialog's single Start button IS the acknowledgement,
// the same one affirmative click accepting window.confirm was before.

import { assertNever } from '../../../core/scene';
import type { JobReviewAcknowledgement as AcknowledgementModel } from './job-review-model';
import type { JobReviewPurpose } from './job-review-store';
import {
  ackFootnoteStyle,
  ackPromptStyle,
  bannerStyle,
  verifiedNoteStyle,
} from './job-review.styles';

export function JobReviewAcknowledgement(props: {
  readonly acknowledgement: AcknowledgementModel;
  readonly purpose?: JobReviewPurpose;
}): JSX.Element {
  const ack = props.acknowledgement;
  switch (ack.kind) {
    case 'laser-verified':
      return (
        <p role="note" style={verifiedNoteStyle}>
          GRBL laser mode ($32=1) is verified for this controller session — no extra acknowledgement
          is needed.
        </p>
      );
    case 'laser-unverified':
      return (
        <AcknowledgementBanner
          heading="Laser mode acknowledgement"
          prompt={ack.prompt}
          purpose={props.purpose ?? 'start'}
        />
      );
    case 'cnc':
      return (
        <AcknowledgementBanner
          heading="CNC setup confirmation"
          prompt={ack.prompt}
          purpose={props.purpose ?? 'start'}
        />
      );
    default:
      return assertNever(ack, 'job review acknowledgement');
  }
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
      <p style={ackFootnoteStyle}>
        Pressing {props.purpose === 'frame' ? 'Accept & Frame' : 'Start job'} records this
        confirmation for the current controller session and the exact program shown above — the same
        acknowledgement the previous confirmation dialog recorded.
      </p>
    </section>
  );
}
