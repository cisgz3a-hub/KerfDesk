import { useTutorialStore } from './tutorial-store';
import { Icon } from '../kit/icons';
import './tutorial-button.css';

export function TutorialButton(props: {
  readonly tutorialId?: string;
  readonly label?: string;
  readonly compact?: boolean;
}): JSX.Element {
  const label = props.label ?? 'Tutorial';
  // A compact button has no visible text, so its accessible name starts with
  // "Tutorial:" (the CommandTutorialButton convention). The control it sits
  // beside ("Connect...", "Camera", a rail title) therefore never shares a
  // name prefix with it, and a search for that control matches exactly once.
  const name = props.compact === true ? `Tutorial: ${label}` : label;
  return (
    <button
      type="button"
      className={`lf-tutorial-button${props.compact === true ? ' lf-tutorial-button--compact' : ''}`}
      title={
        props.compact === true
          ? `${name} (open a step-by-step visual lesson)`
          : `${label}: open a step-by-step visual lesson`
      }
      aria-label={props.compact === true ? name : undefined}
      data-tutorial-id={props.tutorialId ?? 'library'}
      data-dialog-secondary-focus=""
      onClick={() => useTutorialStore.getState().openTutorial(props.tutorialId)}
    >
      <TutorialIcon />
      {props.compact === true ? null : <span>{label}</span>}
    </button>
  );
}

export function TutorialIcon(): JSX.Element {
  return <Icon name="tutorial" size={16} />;
}
