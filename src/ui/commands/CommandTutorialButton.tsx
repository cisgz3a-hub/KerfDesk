import type { AppCommand } from './command-types';
import { COMMAND_TUTORIALS } from '../tutorials/command-tutorials';
import { TutorialIcon } from '../tutorials/TutorialButton';
import { useTutorialStore } from '../tutorials/tutorial-store';

export function CommandTutorialButton(props: {
  readonly command: AppCommand;
  readonly onOpen: () => void;
}): JSX.Element | null {
  const id = COMMAND_TUTORIALS[props.command.id];
  if (typeof id !== 'string') return null;
  return (
    <button
      type="button"
      role="menuitem"
      className="lf-tutorial-button lf-tutorial-button--compact"
      style={{ alignSelf: 'center', marginRight: 5 }}
      title={`Tutorial: ${props.command.label}`}
      aria-label={`Tutorial: ${props.command.label}`}
      data-tutorial-id={id}
      onClick={(event) => {
        // A menu row unmounts on open. Give focus a stable return target first.
        event.currentTarget.closest('details')?.querySelector('summary')?.focus();
        props.onOpen();
        useTutorialStore.getState().openTutorial(id);
      }}
    >
      <TutorialIcon />
    </button>
  );
}
