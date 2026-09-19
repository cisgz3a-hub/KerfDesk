import { useEffect, useState } from 'react';
import type { TutorialVisual } from './tutorial-types';
import { TutorialIllustration } from './TutorialIllustration';

export function TutorialExample(props: {
  readonly visual: TutorialVisual;
  readonly phase: number;
  readonly focus: string;
  readonly result: string;
}): JSX.Element {
  const [phase, setPhase] = useState(props.phase);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      if (phase >= 2) setPlaying(false);
      else setPhase(phase + 1);
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [playing, phase]);
  return (
    <figure className="lf-learn-example">
      <div className="lf-learn-example-heading">
        <span>ILLUSTRATED EXAMPLE</span>
        <span>{['Before', 'Action', 'Result'][phase]}</span>
      </div>
      <TutorialIllustration visual={props.visual} phase={phase} focus={props.focus} />
      <div className="lf-learn-example-controls" role="group" aria-label="Example stages">
        {['Before', 'Action', 'Result'].map((label, index) => (
          <button
            type="button"
            key={label}
            title={`Show the ${label.toLowerCase()} illustration`}
            aria-pressed={phase === index}
            onClick={() => {
              setPlaying(false);
              setPhase(index);
            }}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="lf-learn-play"
          title={playing ? 'Pause example playback' : 'Play the three example stages'}
          onClick={() => {
            if (playing) setPlaying(false);
            else {
              setPhase(0);
              setPlaying(true);
            }
          }}
        >
          {playing ? 'Pause' : '▶ Play example'}
        </button>
      </div>
      <figcaption>{props.focus}</figcaption>
    </figure>
  );
}
