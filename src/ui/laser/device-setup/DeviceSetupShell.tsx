import { useEffect, useRef } from 'react';
import { helpProps } from '../../help/help-topics';
import { Button, DialogActions } from '../../kit';
import { Icon } from '../../kit/icons';
import { machineSetupValidationIssues, type DeviceSetupStepProps } from './device-setup-flow';
import {
  DEVICE_SETUP_STEP_ORDER,
  deviceSetupStage,
  type DeviceSetupStage,
} from './device-setup-steps';
import { DeviceSetupStages, type DeviceSetupStagesProps } from './DeviceSetupStages';
import { DeviceSetupSummary } from './DeviceSetupSummary';

const STAGES: Record<
  DeviceSetupStage,
  { title: string; hint: string; heading: string; description: string }
> = {
  identify: {
    title: 'Machine',
    hint: 'Find it or choose it',
    heading: 'Let’s set up your machine.',
    description:
      'Connect it and KerfDesk fills in what the controller reports, or choose the type and a profile yourself.',
  },
  confirm: {
    title: 'Essentials',
    hint: 'Check the key settings',
    heading: 'Make it match your machine.',
    description:
      'Check the work area, origin and output. Open the extra options only when you need them.',
  },
  review: {
    title: 'Review & save',
    hint: 'One final look',
    heading: 'Your setup, at a glance.',
    description: 'Review your choices below. You can go back and change anything before saving.',
  },
};

type ShellProps = DeviceSetupStagesProps & {
  readonly onClose: () => void;
  /** Escape and the header close button: asks first when the draft changed. */
  readonly onRequestClose: () => void;
  readonly confirmingDiscard: boolean;
  readonly onKeepEditing: () => void;
  readonly onSave: () => void;
  readonly saving: boolean;
  readonly firmwareWriteCount: number;
};

export function DeviceSetupShell(props: ShellProps): JSX.Element {
  const stage = deviceSetupStage(props.state.step);
  const stageInfo = STAGES[stage];
  const content = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStage = useRef(stage);
  useEffect(() => {
    if (stage === previousStage.current) return;
    previousStage.current = stage;
    content.current?.scrollTo?.({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [stage]);
  return (
    <>
      <div className="lf-setup-layout">
        <aside className="lf-setup-sidebar">
          <SetupStepper {...props} />
          <DeviceSetupSummary state={props.state} />
          <p className="lf-setup-draft-note">Your changes stay in this draft until you save.</p>
        </aside>
        <div className="lf-setup-content" ref={content}>
          <header className="lf-setup-intro">
            <p className="lf-setup-eyebrow">
              Step {DEVICE_SETUP_STEP_ORDER.indexOf(stage) + 1} of 3
            </p>
            <h3 tabIndex={-1} ref={heading}>
              {stageInfo.heading}
            </h3>
            <p>{stageInfo.description}</p>
          </header>
          <fieldset
            className="lf-setup-editor"
            disabled={props.saving}
            aria-label={stageInfo.title}
          >
            <DeviceSetupStages {...props} />
          </fieldset>
        </div>
      </div>
      {props.confirmingDiscard ? <DiscardConfirm {...props} /> : <SetupActions {...props} />}
      {/* Last in the DOM so the dialog still opens on its first setup control;
          positioned at the header's right edge. */}
      <button
        type="button"
        className="lf-btn lf-btn--ghost lf-setup-close"
        aria-label="Close Machine Setup"
        title="Close Machine Setup. If you changed anything, you are asked before it is discarded."
        disabled={props.saving}
        onClick={props.onRequestClose}
      >
        <Icon name="close" size={16} />
      </button>
    </>
  );
}

function DiscardConfirm(props: ShellProps): JSX.Element {
  const actions = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    actions.current?.querySelector('button')?.focus();
    return () => {
      if (previous?.isConnected === true) previous.focus();
    };
  }, []);
  return (
    <footer className="lf-setup-footer" data-confirming="discard">
      <p role="alert" className="lf-setup-discard-message">
        <strong>Discard your changes to this setup?</strong>
        <span>Nothing has been saved to the project yet.</span>
      </p>
      <div ref={actions}>
        <DialogActions>
          <Button variant="primary" onClick={props.onKeepEditing}>
            Keep editing
          </Button>
          <Button variant="danger" onClick={props.onClose}>
            Discard changes
          </Button>
        </DialogActions>
      </div>
    </footer>
  );
}

function SetupStepper({
  state,
  dispatch,
  saving,
}: DeviceSetupStepProps & { readonly saving: boolean }): JSX.Element {
  const active = deviceSetupStage(state.step);
  return (
    <nav className="lf-setup-stepper" aria-label="Machine Setup steps">
      {DEVICE_SETUP_STEP_ORDER.map((step, index) => (
        <button
          key={step}
          type="button"
          disabled={saving}
          onClick={() => dispatch({ kind: 'go', step })}
          aria-current={step === active ? 'step' : undefined}
          aria-label={`Go to step ${index + 1}: ${STAGES[step].title}`}
          title={`Open ${STAGES[step].title}`}
        >
          <span className="lf-setup-step-number">{index + 1}</span>
          <span>
            <strong>{STAGES[step].title}</strong>
            <small>{STAGES[step].hint}</small>
          </span>
          <Icon name="chevron-right" />
        </button>
      ))}
    </nav>
  );
}

function SetupActions(props: ShellProps): JSX.Element {
  const stage = deviceSetupStage(props.state.step);
  const ready = machineSetupValidationIssues(props.state).length === 0;
  return (
    <footer className="lf-setup-footer">
      <Button
        onClick={props.onClose}
        disabled={props.saving}
        variant="ghost"
        {...helpProps('control:laser.device-setup.cancel')}
      >
        Cancel without saving
      </Button>
      <DialogActions>
        {stage === 'identify' ? null : (
          <Button
            onClick={() => props.dispatch({ kind: 'back' })}
            disabled={props.saving}
            {...helpProps('control:laser.device-setup.back')}
          >
            <Icon name="arrow-left" /> Back
          </Button>
        )}
        {stage === 'review' ? (
          <Button
            variant="primary"
            onClick={props.onSave}
            disabled={!ready || props.saving}
            {...helpProps(
              'control:laser.device-setup.finish',
              ready ? undefined : 'Resolve the flagged configuration items before saving.',
            )}
          >
            {saveButtonLabel(props)}
          </Button>
        ) : (
          <Button
            variant={stage === 'identify' ? 'default' : 'primary'}
            onClick={() => props.dispatch({ kind: 'next' })}
            disabled={props.saving}
            {...helpProps('control:laser.device-setup.next')}
          >
            {stage === 'identify' ? 'Check essentials' : 'Review setup'} <Icon name="arrow-right" />
          </Button>
        )}
        {stage === 'identify' ? (
          <Button
            variant="primary"
            onClick={() => props.dispatch({ kind: 'go', step: 'review' })}
            disabled={props.saving}
            title="Go straight to the review of your selected profile. Nothing is saved until you press Save there."
          >
            Review setup <Icon name="arrow-right" />
          </Button>
        ) : null}
      </DialogActions>
    </footer>
  );
}

function saveButtonLabel(props: ShellProps): string {
  if (props.saving) return 'Saving and verifying…';
  if (props.firmwareWriteCount === 0) {
    return props.state.machineKind === 'cnc' ? 'Save CNC machine setup' : 'Save machine setup';
  }
  const label = props.state.machineKind === 'cnc' ? 'CNC machine setup' : 'setup';
  return `Save ${label} and write ${props.firmwareWriteCount} setting${props.firmwareWriteCount === 1 ? '' : 's'}`;
}
