// Job Review's question for a CNC that KerfDesk 1.0.29 may have made from a
// laser (rolling audit v10 V2-P2-2, ADR-637 Amendment 8). Start waits for the
// answer. "This is a CNC router" is kept and rebuilds the review; "It's a
// laser" closes the review and opens Machine Setup, where choosing Laser and
// Save change the machine. Nothing here changes the machine type itself.

import type { ConvertedLaserSuspicion } from '../../../core/preflight/converted-laser-profile';
import { Button } from '../../kit';
import {
  CONVERTED_LASER_HEADING,
  CONVERTED_LASER_RISK,
  convertedLaserHintSentence,
  useConvertedLaserAnswerStore,
} from '../../state/converted-laser-question';
import { openMachineSetup } from '../device-setup/machine-setup-dialog-store';
import { useJobReviewStore } from './job-review-store';
import { bannerStyle } from './job-review.styles';

export function JobReviewConvertedLaser(props: {
  readonly question: ConvertedLaserSuspicion | undefined;
  readonly onAnswered: () => void;
}): JSX.Element | null {
  if (props.question === undefined) return null;
  const hints = convertedLaserHintSentence(props.question);
  const answerRouter = (): void => {
    useConvertedLaserAnswerStore.getState().answerRouter();
    props.onAnswered();
  };
  const answerLaser = (): void => {
    useJobReviewStore.getState().cancelAndClose();
    openMachineSetup();
  };
  return (
    <section
      aria-label={CONVERTED_LASER_HEADING}
      className="lf-banner lf-banner--danger"
      style={bannerStyle}
    >
      <strong>{CONVERTED_LASER_HEADING}</strong>
      <p style={paragraphStyle}>
        {CONVERTED_LASER_RISK}
        {hints === null ? null : ` ${hints}`}
      </p>
      <p style={paragraphStyle}>Start waits for your answer.</p>
      <span style={actionsStyle}>
        <Button variant="primary" onClick={answerLaser}>
          It&apos;s a laser: open Machine Setup
        </Button>
        <Button onClick={answerRouter}>This is a CNC router</Button>
      </span>
    </section>
  );
}

const paragraphStyle: React.CSSProperties = { margin: '4px 0 0' };

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginTop: 8,
};
