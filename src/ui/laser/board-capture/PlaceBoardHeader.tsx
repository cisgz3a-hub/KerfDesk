// PlaceBoardHeader — the Place Board page's header (ADR-636), the same full-page
// header as the jig's: Done, the page's name and tutorial, its three steps,
// Undo/Redo and the machine connection. Done returns to the workspace as it
// was; there is nothing to save: the board, the artwork and the settings are
// already part of the project, with the ordinary Undo.

import { ToolPageHeader } from '../../workspace/ToolPageHeader';
import { PLACE_BOARD_STEPS, type PlaceBoardStepId } from './PlaceBoardSidebar';

export function PlaceBoardHeader(props: {
  readonly step: PlaceBoardStepId;
  readonly onStep: (step: PlaceBoardStepId) => void;
  readonly disabled: boolean;
  readonly onDone: () => void;
}): JSX.Element {
  return (
    <ToolPageHeader
      title="Place board"
      tutorialId="board"
      steps={PLACE_BOARD_STEPS}
      stepsLabel="Place board steps"
      step={props.step}
      onStep={props.onStep}
      doneDisabled={props.disabled}
      doneTitle={
        props.disabled
          ? 'Wait for the current capture or move to finish'
          : 'Back to the workspace as you left it. The board and artwork are already part of the project.'
      }
      onDone={props.onDone}
    />
  );
}
