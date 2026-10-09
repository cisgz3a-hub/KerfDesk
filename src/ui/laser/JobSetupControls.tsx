import { selectControllerDriver } from '../../core/controllers';
import { Icon } from '../kit';
import { useStore } from '../state';
import { describeAutofocusResult, useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { gridFullRowStyle } from './JobControls.styles';
import { controllerActionFailureHandler } from './report-controller-action-failure';

type Props = {
  readonly disabled: boolean;
  readonly streaming: boolean;
  readonly onConfigureAutofocus: () => void;
  readonly onConfigureHoming: () => void;
  readonly compact?: boolean;
  readonly jog?: boolean;
  readonly actions?: 'all' | 'home' | 'autofocus';
};

/** Shared Home and autofocus actions for the jog column and standalone job controls. */
export function JobSetupControls(props: Props): JSX.Element {
  const autofocusCommand = useStore((s) => s.project.device.autofocusCommand);
  const machineKind = useStore((s) => s.project.machine?.kind ?? 'laser');
  const homingEnabled = useStore((s) => s.project.device.homing.enabled);
  const home = useLaserStore((s) => s.home);
  const homeCommand = useHomeCommand();
  const onAutofocus = useAutofocusAction();
  const busy = props.disabled || props.streaming;
  return (
    <>
      {props.actions !== 'autofocus' && (
        <HomeButton
          onHome={() => void home().catch(controllerActionFailureHandler('Home'))}
          onConfigureHoming={props.onConfigureHoming}
          busy={busy}
          streaming={props.streaming}
          homingEnabled={homingEnabled}
          command={homeCommand}
          jog={props.jog}
        />
      )}
      {props.actions !== 'home' && machineKind !== 'cnc' && (
        <AutofocusButton
          needsSetup={autofocusCommand.trim() === ''}
          busy={busy}
          streaming={props.streaming}
          onConfigure={props.onConfigureAutofocus}
          onRun={onAutofocus}
          compact={props.compact}
          jog={props.jog}
        />
      )}
    </>
  );
}

function useHomeCommand(): string | null {
  const device = useStore((state) => state.project.device);
  const connected = useLaserStore((state) => state.connection.kind === 'connected');
  const activeKind = useLaserStore((state) => state.activeControllerKind);
  const activeCommandSet = useLaserStore((state) => state.activeControllerCommandSet);
  return selectControllerDriver(
    connected ? activeKind : device.controllerKind,
    connected ? (activeCommandSet ?? undefined) : device.controllerCommandSet,
  ).commands.home;
}

function HomeButton(props: {
  readonly onHome: () => void;
  readonly onConfigureHoming: () => void;
  readonly busy: boolean;
  readonly streaming: boolean;
  readonly homingEnabled: boolean;
  readonly command: string | null;
  readonly jog: boolean | undefined;
}): JSX.Element {
  if (!props.homingEnabled) {
    return (
      <button
        type="button"
        className={props.jog ? 'lf-btn lf-jog-home' : 'lf-btn'}
        onClick={props.onConfigureHoming}
        disabled={props.streaming}
        title="Homing is off for this machine. Open Machine Setup to configure Home."
      >
        <HomeLabel jog={props.jog} label="Set up homing" />
      </button>
    );
  }
  return (
    <button
      type="button"
      className={props.jog ? 'lf-btn lf-jog-home' : 'lf-btn'}
      onClick={props.onHome}
      disabled={props.busy}
      title={
        props.command === null
          ? 'This controller has no homing command.'
          : `Run ${props.command.split(/\r?\n/).join(' then ')} to establish the machine reference. Set the workpiece origin separately.`
      }
    >
      <HomeLabel jog={props.jog} label="Home" />
    </button>
  );
}

function HomeLabel(props: {
  readonly jog: boolean | undefined;
  readonly label: string;
}): JSX.Element {
  if (!props.jog) return <>{props.label}</>;
  return (
    <>
      <Icon name="home" size={18} />
      <span className="lf-jog-home-label">{props.label}</span>
    </>
  );
}

function AutofocusButton(props: {
  readonly needsSetup: boolean;
  readonly busy: boolean;
  readonly streaming: boolean;
  readonly onConfigure: () => void;
  readonly onRun: () => void;
  readonly compact: boolean | undefined;
  readonly jog: boolean | undefined;
}): JSX.Element {
  return (
    <button
      type="button"
      className={props.jog ? 'lf-btn lf-jog-autofocus' : 'lf-btn'}
      style={props.compact || props.jog ? undefined : gridFullRowStyle}
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
