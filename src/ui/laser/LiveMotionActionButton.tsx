import { useFreshKeyActivation } from '../common/use-fresh-key-activation';
import { controllerActionFailureHandler } from './report-controller-action-failure';

type Action = () => Promise<void>;

type ActionButtonProps = {
  readonly label: string;
  readonly title: string;
  readonly disabled?: boolean;
  readonly onClick: Action;
};

// Props, not components: every state of the primary action must render the
// same LiveMotionActionButton, so React keeps one button that flips (Pause →
// Pausing… → Resume) and it keeps focus (UX audit U7-P3-1). A wrapper
// component of its own type was a different element, remounted each flip.
export function pendingPauseResumeButton(props: {
  readonly action: 'pause' | 'resume';
  readonly pauseJob: Action;
  readonly resumeJob: Action;
}): ActionButtonProps {
  const pausing = props.action === 'pause';
  return {
    label: pausing ? 'Pausing…' : 'Resuming…',
    title: `Waiting for ${pausing ? 'Pause' : 'Resume'} to complete`,
    disabled: true,
    onClick: pausing ? props.pauseJob : props.resumeJob,
  };
}

/** Pause and lift is moving the bit (ADR-411): the control waits it out. */
export function pendingCncLiftButton(props: {
  readonly phase: 'lifting' | 'entering';
  readonly title: string;
  readonly resumeJob: Action;
}): ActionButtonProps {
  return {
    label: props.phase === 'lifting' ? 'Lifting…' : 'Returning…',
    title: props.title,
    disabled: true,
    onClick: props.resumeJob,
  };
}

export function LiveMotionActionButton(props: ActionButtonProps): JSX.Element {
  // One focused button flips Pause → Resume, so a held Enter must not press
  // what it became (rolling audit v10 V8-P2-1, ADR-207 Amendment 3).
  const keys = useFreshKeyActivation(`${props.label}|${props.disabled === true ? 'off' : 'on'}`);
  return (
    <button
      type="button"
      className="lf-btn lf-btn--primary"
      style={LIVE_MOTION_ACTION_BUTTON_STYLE}
      title={props.title}
      // aria-disabled, not disabled: Pause becomes Pausing… then Resume in the
      // same button, and a disabled button drops its focus to the page.
      aria-disabled={props.disabled === true ? 'true' : undefined}
      {...keys}
      onClick={() => {
        if (props.disabled === true) return;
        void props.onClick().catch(controllerActionFailureHandler(props.label));
      }}
    >
      {props.label}
    </button>
  );
}

export const LIVE_MOTION_ACTION_BUTTON_STYLE: React.CSSProperties = {
  minWidth: 128,
  minHeight: 48,
  fontSize: 16,
  fontWeight: 700,
};
