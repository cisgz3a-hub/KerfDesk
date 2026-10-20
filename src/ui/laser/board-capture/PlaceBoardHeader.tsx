// PlaceBoardHeader — the Place Board page's title bar (ADR-636), laid out like
// jig mode's: the tool's name, its tutorial, and Done, which returns to the
// main canvas. There is nothing to save: the board, the artwork and the
// settings are already part of the project, with the ordinary Undo.

import { Button } from '../../kit';
import { TutorialButton } from '../../tutorials/TutorialButton';

export function PlaceBoardHeader(props: {
  readonly disabled: boolean;
  readonly onDone: () => void;
}): JSX.Element {
  return (
    <header className="lf-jig-header">
      <strong>Place Board</strong>
      <TutorialButton tutorialId="board" compact label="Place board" />
      <span className="lf-jig-muted">
        Capture the board, place the artwork and burn it, with the machine panel beside you
      </span>
      <div className="lf-jig-actions">
        <Button
          variant="primary"
          disabled={props.disabled}
          title={
            props.disabled
              ? 'Wait for the current capture or move to finish'
              : 'Go back to the main canvas. The board and artwork are already part of the project.'
          }
          onClick={props.onDone}
        >
          Done
        </Button>
      </div>
    </header>
  );
}
