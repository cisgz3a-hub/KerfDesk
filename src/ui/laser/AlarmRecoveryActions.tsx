// The Alarm banner's recovery buttons. Labels and tooltips name the commands
// the active driver really sends: the banner used to hard-code GRBL's `$H` and
// `$X` even on Smoothieware (M999 unlock) and the Falcon ($HX then $HY), which
// misled anyone cross-checking the Console (audit ui-panel-8). GRBL, grblHAL
// and FluidNC keep their exact labels.

import { selectControllerDriver } from '../../core/controllers';
import { useLaserStore } from '../state/laser-store';

export function AlarmRecoveryActions(props: {
  readonly homingEnabled: boolean;
  // False on a driver whose Home cannot run in Alarm (a halted Smoothieware
  // board refuses it until M999): the banner then offers Unlock first
  // (controller audit 2026-09-25 CG-4). Omitted means true.
  readonly homeFromAlarm?: boolean;
  readonly canUnlock: boolean;
  readonly onHome: () => void;
  readonly onConfigureHoming: () => void;
  readonly onUnlock: () => void;
}): JSX.Element {
  const commands = useActiveDriverCommands();
  const home = commandLabels(commands.home ?? '$H');
  const unlock = commands.unlock ?? '$X';
  if (props.homingEnabled && props.homeFromAlarm === false) {
    return (
      <>
        {props.canUnlock && (
          <button
            type="button"
            onClick={props.onUnlock}
            title={`Send ${unlock} to clear the halt after you have confirmed the machine is safe. Home once it reports Idle.`}
          >
            {`${unlock} — Unlock`}
          </button>
        )}
        <span style={alarmHintStyle}>Unlock first: this controller cannot home while halted.</span>
      </>
    );
  }
  return (
    <>
      {props.homingEnabled ? (
        <button
          type="button"
          onClick={props.onHome}
          title={`Send ${home.sequence}. Use this only when the machine has working homing switches.`}
        >
          {home.label}
        </button>
      ) : (
        <button
          type="button"
          onClick={props.onConfigureHoming}
          title="Homing is off for this machine. Open Machine Setup to turn on homing."
        >
          Set up homing
        </button>
      )}
      {!props.homingEnabled && (
        <span style={alarmHintStyle}>
          Turn on homing in Machine Setup if this machine has homing switches.
        </span>
      )}
      {props.canUnlock && (
        <button
          type="button"
          onClick={props.onUnlock}
          title={`Send ${unlock} to unlock the controller after you have confirmed the machine is safe.`}
        >
          {`${unlock} — Unlock`}
        </button>
      )}
    </>
  );
}

function useActiveDriverCommands(): ReturnType<typeof selectControllerDriver>['commands'] {
  const kind = useLaserStore((state) => state.activeControllerKind);
  const commandSet = useLaserStore((state) => state.activeControllerCommandSet);
  return selectControllerDriver(kind, commandSet ?? undefined).commands;
}

/** A one-line command is named on the button; a multi-line sequence (the
 *  Falcon's `$HX` then `$HY`) is spelled out in the tooltip. */
function commandLabels(command: string): { readonly label: string; readonly sequence: string } {
  const lines = command.split(/\r?\n/).filter((line) => line.trim() !== '');
  return lines.length === 1
    ? { label: `Home (${command})`, sequence: command }
    : { label: 'Home', sequence: lines.join(' then ') };
}

const alarmHintStyle: React.CSSProperties = { display: 'block', fontSize: 11, lineHeight: 1.3 };
