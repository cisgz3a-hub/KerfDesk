import { useStore } from '../state';
import { describeAutofocusResult, useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { gridFullRowStyle } from './JobControls.styles';

type Props = {
  readonly disabled: boolean;
  readonly streaming: boolean;
  readonly onConfigureAutofocus: () => void;
  readonly onConfigureHoming: () => void;
  readonly compact?: boolean;
};

/** Home and autofocus remain in the machine panel when job actions move to the dock. */
export function JobSetupControls(props: Props): JSX.Element {
  const autofocusCommand = useStore((s) => s.project.device.autofocusCommand);
  const machineKind = useStore((s) => s.project.machine?.kind ?? 'laser');
  const homingEnabled = useStore((s) => s.project.device.homing.enabled);
  const home = useLaserStore((s) => s.home);
  const onAutofocus = useAutofocusAction();
  const busy = props.disabled || props.streaming;
  return (
    <>
      <HomeButton
        onHome={() => void home()}
        onConfigureHoming={props.onConfigureHoming}
        busy={busy}
        streaming={props.streaming}
        homingEnabled={homingEnabled}
      />
      {machineKind !== 'cnc' && (
        <AutofocusButton
          needsSetup={autofocusCommand.trim() === ''}
          busy={busy}
          streaming={props.streaming}
          onConfigure={props.onConfigureAutofocus}
          onRun={onAutofocus}
          compact={props.compact}
        />
      )}
    </>
  );
}

function HomeButton(props: {
  readonly onHome: () => void;
  readonly onConfigureHoming: () => void;
  readonly busy: boolean;
  readonly streaming: boolean;
  readonly homingEnabled: boolean;
}): JSX.Element {
  if (!props.homingEnabled) {
    return (
      <button
        type="button"
        className="lf-btn"
        onClick={props.onConfigureHoming}
        disabled={props.streaming}
        title="Homing is off for this machine. Open Machine Setup to turn on $H homing."
      >
        Set up homing
      </button>
    );
  }
  return (
    <button
      type="button"
      className="lf-btn"
      onClick={props.onHome}
      disabled={props.busy}
      title="Send $H — home all axes"
    >
      Home
    </button>
  );
}

function AutofocusButton(props: {
  readonly needsSetup: boolean;
  readonly busy: boolean;
  readonly streaming: boolean;
  readonly onConfigure: () => void;
  readonly onRun: () => void;
  readonly compact: boolean | undefined;
}): JSX.Element {
  return (
    <button
      type="button"
      className="lf-btn"
      style={props.compact ? undefined : gridFullRowStyle}
      onClick={props.needsSetup ? props.onConfigure : props.onRun}
      disabled={props.needsSetup ? props.streaming : props.busy}
      title={
        props.needsSetup
          ? 'Open Machine Setup at Auto-focus setup.'
          : 'Run the auto-focus command configured in Machine Setup.'
      }
    >
      {props.needsSetup ? 'Set up auto-focus' : 'Auto-focus'}
    </button>
  );
}

function useAutofocusAction(): () => void {
  const autofocusCommand = useStore((s) => s.project.device.autofocusCommand);
  const autofocus = useLaserStore((s) => s.autofocus);
  const pushToast = useToastStore((s) => s.pushToast);
  return () => {
    if (autofocusCommand.trim() === '') {
      pushToast('No autofocus command configured. Set it in Device settings.', 'warning');
      return;
    }
    void autofocus(autofocusCommand).then((result) => {
      const t = describeAutofocusResult(result);
      pushToast(t.message, t.variant);
    });
  };
}
