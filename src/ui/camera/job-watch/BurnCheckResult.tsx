// BurnCheckResult — the burn check's verdict on the last laser job (ADR-490),
// in plain words: how much of the path the camera saw change, any marks
// outside it, and how much it could not judge. The tinted picture on the
// canvas shows where: red where the path shows no change, amber for marks
// outside it, dimmed where the camera could not see.

import type { BurnReport } from '../../../core/camera/job-watch/burn-comparison';
import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { isActiveJob } from '../../state/laser-store-helpers';
import { noteStyle, rowStyle } from '../panel/panel-styles';
import {
  canRetakeAfterPicture,
  clearBurnCheckResult,
  retakeAfterPicture,
  showBurnCheckOnCanvas,
} from './job-watch-runner';
import type { BurnCheckView } from './job-watch-store';

// Below this share hidden, the note would only be noise.
const HIDDEN_WORTH_SAYING = 0.02;

export function BurnCheckResult(props: { readonly view: BurnCheckView }): JSX.Element | null {
  const { view } = props;
  switch (view.kind) {
    case 'idle':
      return null;
    case 'watching':
      return <p style={noteStyle}>Burn check: watching this job.</p>;
    case 'checking':
      return <p style={noteStyle}>Burn check: comparing the pictures…</p>;
    case 'unavailable':
      return <p style={noteStyle}>Burn check: {view.reason}</p>;
    case 'done':
      return <BurnCheckDone view={view} />;
  }
}

function BurnCheckDone(props: {
  readonly view: Extract<BurnCheckView, { kind: 'done' }>;
}): JSX.Element {
  const { report, picture } = props.view;
  const shown = useCameraStore((s) => s.overlayVisible && s.bedPicture === picture);
  const setBedPicture = useCameraStore((s) => s.setBedPicture);
  const jobActive = useLaserStore((s) => isActiveJob(s.streamer));
  const hide = (): void => setBedPicture(null);

  return (
    <div style={blockStyle} aria-label="Burn check">
      {burnCheckSentences(report).map((sentence) => (
        <span key={sentence}>{sentence}</span>
      ))}
      <p style={noteStyle}>
        Light parts of an image engrave may not show on camera, and read as no change.
      </p>
      <div style={rowStyle}>
        <button
          type="button"
          className="lf-btn"
          onClick={shown ? hide : showBurnCheckOnCanvas}
          title="Show the after picture on the canvas, marked where the camera saw a difference from the job."
        >
          {shown ? 'Hide from canvas' : 'Show on canvas'}
        </button>
        <button
          type="button"
          className="lf-btn"
          disabled={jobActive || !canRetakeAfterPicture()}
          onClick={() => void retakeAfterPicture()}
          title="Jog the head clear of the job first, then check again from a new picture."
        >
          Take the after picture again
        </button>
        <button
          type="button"
          className="lf-btn"
          onClick={clearBurnCheckResult}
          title="Throw this check away and take its picture off the canvas."
        >
          Clear
        </button>
      </div>
    </div>
  );
}

/** The verdict in plain sentences. */
export function burnCheckSentences(report: BurnReport): ReadonlyArray<string> {
  const sentences: string[] = [];
  if (report.coverage === null) {
    sentences.push('The camera could not see the job’s path.');
  } else {
    const percent = Math.floor(report.coverage * 100);
    sentences.push(
      report.coverage >= 1
        ? 'The camera sees a change along all of the path.'
        : `The camera sees a change along ${percent}% of the path; where it saw none is red.`,
    );
  }
  sentences.push(
    report.strayMarks === 0
      ? 'No marks outside the path.'
      : `${report.strayMarks} ${report.strayMarks === 1 ? 'mark' : 'marks'} outside the path (${formatArea(report.strayAreaMm2)} mm²), in amber.`,
  );
  if (report.hiddenShare >= HIDDEN_WORTH_SAYING) {
    sentences.push(
      `${Math.round(report.hiddenShare * 100)}% of the path was hidden from the camera (the head, the gantry, or something moving), so it was not judged.`,
    );
  }
  return sentences;
}

function formatArea(areaMm2: number): string {
  return areaMm2 < 10 ? areaMm2.toFixed(1) : String(Math.round(areaMm2));
}

const blockStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
