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
    hint: 'Choose a starting point',
    heading: 'Let’s set up your machine.',
    description: 'Choose your machine type, then a profile. You can also enter your own settings.',
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
      <SetupActions {...props} />
    </>
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
        {stage === 'identify' ? (
          <span className="lf-setup-footer-note">You can set up offline</span>
        ) : (
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
            variant="primary"
            onClick={() => props.dispatch({ kind: 'next' })}
            disabled={props.saving}
            {...helpProps('control:laser.device-setup.next')}
          >
            {stage === 'identify' ? 'Check essentials' : 'Review setup'} <Icon name="arrow-right" />
          </Button>
        )}
      </DialogActions>
    </footer>
  );
}

function saveButtonLabel(props: ShellProps): string {
  if (props.saving) return 'Saving and verifying…';
  if (props.firmwareWriteCount === 0) {
    return props.state.machineKind === 'cnc' ? 'Save CNC startup setup' : 'Save machine setup';
  }
  const label = props.state.machineKind === 'cnc' ? 'CNC startup setup' : 'setup';
  return `Save ${label} and write ${props.firmwareWriteCount} setting${props.firmwareWriteCount === 1 ? '' : 's'}`;
}
