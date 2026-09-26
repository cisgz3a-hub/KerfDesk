import { controllerActionFailureHandler } from './report-controller-action-failure';

type Action = () => Promise<void>;

export function PendingPauseResumeAction(props: {
  readonly action: 'pause' | 'resume';
  readonly pauseJob: Action;
  readonly resumeJob: Action;
}): JSX.Element {
  const pausing = props.action === 'pause';
  return (
    <LiveMotionActionButton
      label={pausing ? 'Pausing…' : 'Resuming…'}
      title={`Waiting for ${pausing ? 'Pause' : 'Resume'} to complete`}
      disabled
      onClick={pausing ? props.pauseJob : props.resumeJob}
    />
  );
}

/** Pause and lift is moving the bit (ADR-401): the control waits it out. */
export function PendingCncLiftAction(props: {
  readonly phase: 'lifting' | 'entering';
  readonly title: string;
  readonly resumeJob: Action;
}): JSX.Element {
  return (
    <LiveMotionActionButton
      label={props.phase === 'lifting' ? 'Lifting…' : 'Returning…'}
      title={props.title}
      disabled
      onClick={props.resumeJob}
    />
  );
}

export function LiveMotionActionButton(props: {
  readonly label: string;
  readonly title: string;
  readonly disabled?: boolean;
  readonly onClick: Action;
}): JSX.Element {
  return (
    <button
      type="button"
      className="lf-btn lf-btn--primary"
      style={LIVE_MOTION_ACTION_BUTTON_STYLE}
      title={props.title}
      disabled={props.disabled}
      onClick={() => void props.onClick().catch(controllerActionFailureHandler(props.label))}
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
