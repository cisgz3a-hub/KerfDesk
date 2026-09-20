import { useEffect, useState } from 'react';
import type { TutorialVisual } from './tutorial-types';
import { TutorialIllustration } from './TutorialIllustration';
import { TutorialPhoto } from './TutorialPhoto';
import { TUTORIAL_PHOTOS, type TutorialPhoto as Photo } from './tutorial-photos';
import './tutorial-photos.css';

export function TutorialExample(props: {
  readonly tutorialId?: string;
  readonly visual: TutorialVisual;
  readonly phase: number;
  readonly focus: string;
  readonly result: string;
}): JSX.Element {
  const [phase, setPhase] = useState(props.phase);
  const [playing, setPlaying] = useState(false);
  const [diagram, setDiagram] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const photo = TUTORIAL_PHOTOS[props.tutorialId ?? ''];
  const showPhoto = photo !== undefined && !diagram && !imageFailed;
  const labels = showPhoto
    ? photo.frames.map((frame) => frame.label)
    : ['Before', 'Action', 'Result'];
  const shownPhase = labels.length === 1 ? 0 : phase;
  const caption = showPhoto ? photoCaption(photo, shownPhase) : props.focus;
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
        <span>{showPhoto ? 'PICTURE EXAMPLE' : 'ILLUSTRATED EXAMPLE'}</span>
        <span>{labels[shownPhase]}</span>
      </div>
      {showPhoto ? (
        <TutorialPhoto photo={photo} phase={shownPhase} onError={() => setImageFailed(true)} />
      ) : (
        <TutorialIllustration visual={props.visual} phase={phase} focus={props.focus} />
      )}
      <ExampleControls
        labels={labels}
        phase={shownPhase}
        playing={playing}
        select={(index) => {
          setPlaying(false);
          setPhase(index);
        }}
        togglePlay={() => {
          if (!playing) setPhase(0);
          setPlaying(!playing);
        }}
      />
      <figcaption>{caption}</figcaption>
      {photo === undefined ? null : (
        <div className="lf-learn-photo-note">
          <span>{showPhoto ? 'Generated learning example' : 'Diagram view'}</span>
          <button
            type="button"
            title={photoToggleTitle(showPhoto)}
            onClick={() => {
              setPlaying(false);
              setDiagram(showPhoto);
              setImageFailed(false);
            }}
          >
            {showPhoto ? 'Show diagram' : 'Show picture'}
          </button>
        </div>
      )}
    </figure>
  );
}

function photoToggleTitle(showPhoto: boolean): string {
  return showPhoto
    ? 'Show the diagram instead of the generated picture.'
    : 'Show the generated picture instead of the diagram.';
}

function photoCaption(photo: Photo, phase: number): string {
  return (photo.frames[phase] ?? photo.frames[0]).caption;
}

function ExampleControls(props: {
  readonly labels: readonly string[];
  readonly phase: number;
  readonly playing: boolean;
  readonly select: (phase: number) => void;
  readonly togglePlay: () => void;
}): JSX.Element | null {
  if (props.labels.length === 1) return null;
  return (
    <div className="lf-learn-example-controls" role="group" aria-label="Example stages">
      {props.labels.map((label, index) => (
        <button
          type="button"
          key={label}
          title={`Show the ${label.toLowerCase()} illustration`}
          aria-pressed={props.phase === index}
          onClick={() => props.select(index)}
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        className="lf-learn-play"
        title={props.playing ? 'Pause example playback' : 'Play the three example stages'}
        onClick={props.togglePlay}
      >
        {props.playing ? 'Pause' : '▶ Play example'}
      </button>
    </div>
  );
}
