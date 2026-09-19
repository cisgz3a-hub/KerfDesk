import { useTutorialStore } from './tutorial-store';
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
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5C9 3 5 3 2 4v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-3-1-7-1-10 1v15" />
      <path d="M6 8h2M6 12h2m8-4h2m-2 4h2" />
    </svg>
  );
}
