import { useState } from 'react';
import type { TutorialVisual } from './tutorial-types';
import { TutorialIllustration } from './TutorialIllustration';
import { TutorialPhoto } from './TutorialPhoto';
import { TUTORIAL_PHOTOS } from './tutorial-photos';
import './tutorial-photos.css';

/** The illustration follows the written step; it has no separate navigation. */
export function TutorialExample(props: {
  readonly tutorialId?: string;
  readonly visual: TutorialVisual;
  readonly phase: number;
  readonly focus: string;
}): JSX.Element {
  const [imageFailed, setImageFailed] = useState(false);
  const photo = TUTORIAL_PHOTOS[props.tutorialId ?? ''];
  const showPhoto = photo !== undefined && !imageFailed;
  return (
    <figure
      className="lf-learn-example"
      aria-label={showPhoto ? 'Illustrated picture example' : 'Illustrated example'}
    >
      {showPhoto ? (
        <TutorialPhoto photo={photo} phase={props.phase} onError={() => setImageFailed(true)} />
      ) : (
        <TutorialIllustration visual={props.visual} phase={props.phase} focus={props.focus} />
      )}
    </figure>
  );
}
