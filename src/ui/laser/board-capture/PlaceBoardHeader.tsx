// PlaceBoardHeader — the Place board panel's title row and its three-step
// progress strip (ADR-636): Shape → Capture → Place. The strip is a reading
// aid only; every step stays reachable through the panel's own controls.

import { Button, Icon } from '../../kit';
import { TutorialButton } from '../../tutorials/TutorialButton';

export type PlaceBoardStep = 'shape' | 'capture' | 'place';

const STEPS: ReadonlyArray<{ readonly step: PlaceBoardStep; readonly label: string }> = [
  { step: 'shape', label: '1 Shape' },
  { step: 'capture', label: '2 Capture' },
  { step: 'place', label: '3 Place' },
];

export function PlaceBoardHeader(props: {
  readonly step: PlaceBoardStep;
  readonly disabled: boolean;
  readonly onClose: () => void;
}): JSX.Element {
  const current = STEPS.findIndex((entry) => entry.step === props.step);
  return (
    <>
      <header className="lf-place-board__header">
        <span className="lf-place-board__title">
          <span className="lf-place-board__title-icon" aria-hidden="true">
            <Icon name="crosshair" size={16} />
          </span>
          Place Board
        </span>
        <TutorialButton tutorialId="board" compact label="Place board" />
        <Button
          variant="ghost"
          aria-label="Close board capture panel"
          disabled={props.disabled}
          onClick={props.onClose}
        >
          <Icon name="close" size={16} />
        </Button>
      </header>
      <ol className="lf-place-board__steps" aria-label="Place board progress">
        {STEPS.map((entry, index) => (
          <li
            key={entry.step}
            className="lf-place-board__step"
            data-state={index < current ? 'done' : index === current ? 'current' : 'todo'}
            aria-current={index === current ? 'step' : undefined}
          >
            {entry.label}
          </li>
        ))}
      </ol>
    </>
  );
}
