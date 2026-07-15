// Step 2: connect with the driver and baud selected on step 1, then run the
// controller's read-only identity/settings commands. No firmware writes occur
// here.

import { selectControllerDriver } from '../../../core/controllers';
import { assertNever } from '../../../core/scene';
import { usePlatform } from '../../app/platform-context';
import { helpProps } from '../../help/help-topics';
import { Button } from '../../kit';
import { useLaserStore, type ConnectionState } from '../../state/laser-store';
import { useToastStore } from '../../state/toast-store';
import { describePatch } from '../DetectedSettingsBanner';
import type { DeviceSetupStepProps } from './device-setup-flow';
import { machineSetupControllerGuide } from './machine-setup-controller-guide';

export function DeviceSetupConnectStep({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  const model = useConnectionStepModel(state);
  if (model.driver.capabilities.transport === 'file-only') {
    return (
      <section style={sectionStyle}>
        <p style={statusStyle}>No live connection is used for this controller.</p>
        <p style={hintStyle}>{model.guide.writeExplanation}</p>
        <CommandContract guide={model.guide} />
      </section>
    );
  }
  return <SerialConnectStep model={model} dispatch={dispatch} />;
}

function useConnectionStepModel(state: DeviceSetupStepProps['state']) {
  const platform = usePlatform();
  const connection = useLaserStore((s) => s.connection);
  const activeControllerKind = useLaserStore((s) => s.activeControllerKind);
  const controllerOperation = useLaserStore((s) => s.controllerOperation);
  const detectedControllerKind = useLaserStore((s) => s.detectedControllerKind);
  const detected = useLaserStore((s) => s.detectedSettings);
  const connect = useLaserStore((s) => s.connect);
  const disconnect = useLaserStore((s) => s.disconnect);
  const readMachineSettings = useLaserStore((s) => s.readMachineSettings);
  const sendConsoleCommand = useLaserStore((s) => s.sendConsoleCommand);
  const pushToast = useToastStore((s) => s.pushToast);
  const controllerKind = state.draft.controllerKind ?? 'grbl-v1.1';
  const driver = selectControllerDriver(controllerKind);
  const guide = machineSetupControllerGuide(controllerKind);
  const connected = connection.kind === 'connected';
  const supportsSerial = platform.serial.isSupported();
  const rows = detected === null ? [] : describePatch(detected, state.baseline);
  const mismatch =
    connected &&
    (activeControllerKind !== controllerKind ||
      (detectedControllerKind !== null && detectedControllerKind !== controllerKind));

  const openConnection = (): Promise<void> =>
    connect(platform, {
      controllerKind,
      baudRate: state.draft.baudRate ?? guide.defaultBaudRate,
    });
  const reconnect = async (): Promise<void> => {
    await disconnect();
    await openConnection();
  };
  const readController = async (): Promise<void> => {
    try {
      for (const command of guide.identityCommands) await sendConsoleCommand(command);
      for (const command of guide.settingsCommands) {
        if (command === driver.commands.settingsQuery) await readMachineSettings();
        else await sendConsoleCommand(command);
      }
      pushToast(
        `${guide.label} read-only checks sent. Review the transcript and values below.`,
        'success',
      );
    } catch (error: unknown) {
      pushToast(error instanceof Error ? error.message : String(error), 'error');
    }
  };
  return {
    activeControllerKind,
    connection,
    controllerOperation,
    controllerKind,
    detected,
    detectedControllerKind,
    driver,
    guide,
    mismatch,
    openConnection,
    pushToast,
    readController,
    reconnect,
    rows,
    state,
    supportsSerial,
  };
}

function SerialConnectStep(props: {
  readonly model: ReturnType<typeof useConnectionStepModel>;
  readonly dispatch: DeviceSetupStepProps['dispatch'];
}): JSX.Element {
  const { model } = props;
  return (
    <section style={sectionStyle}>
      <p style={statusStyle}>{connectionStatusText(model.connection)}</p>
      <p style={hintStyle}>
        KerfDesk will open {model.guide.label} at{' '}
        {model.state.draft.baudRate ?? model.guide.defaultBaudRate} baud. Reading identity and
        settings is non-motion and does not change controller configuration.
      </p>
      {model.mismatch ? <ConnectionMismatch model={model} dispatch={props.dispatch} /> : null}
      <ConnectionActions model={model} dispatch={props.dispatch} />
      {!model.supportsSerial ? (
        <p style={warningStyle}>
          Web Serial is unavailable. Use the desktop app or Chrome/Edge, or continue with manual
          values.
        </p>
      ) : null}
      <DetectedReadback model={model} />
      <CommandContract guide={model.guide} />
    </section>
  );
}

function ConnectionMismatch(props: {
  readonly model: ReturnType<typeof useConnectionStepModel>;
  readonly dispatch: DeviceSetupStepProps['dispatch'];
}): JSX.Element {
  const { model } = props;
  const detectedGuide =
    model.detectedControllerKind === null
      ? null
      : machineSetupControllerGuide(model.detectedControllerKind);
  return (
    <div role="alert" style={warningCardStyle}>
      <strong>Connection does not match the setup draft.</strong>
      <span>
        Active driver: {model.activeControllerKind}; detected firmware:{' '}
        {model.detectedControllerKind ?? 'unknown'}; selected: {model.controllerKind}.
      </span>
      <Button
        variant="primary"
        onClick={() => void model.reconnect().catch(showError(model.pushToast))}
      >
        Reconnect using selected profile
      </Button>
      {detectedGuide !== null && model.detectedControllerKind !== model.controllerKind ? (
        <Button
          onClick={() =>
            props.dispatch({
              kind: 'select-controller',
              controllerKind: detectedGuide.kind,
            })
          }
        >
          Use detected {detectedGuide.label} in draft
        </Button>
      ) : null}
    </div>
  );
}

function ConnectionActions(props: {
  readonly model: ReturnType<typeof useConnectionStepModel>;
  readonly dispatch: DeviceSetupStepProps['dispatch'];
}): JSX.Element {
  const { model } = props;
  const acceptDetected = (): void => {
    const detected = model.detected;
    if (detected === null) return;
    props.dispatch({ kind: 'accept-detected', patch: detected });
  };
  if (model.connection.kind !== 'connected') {
    return (
      <div style={actionsStyle}>
        <Button
          variant="primary"
          onClick={() => void model.openConnection().catch(showError(model.pushToast))}
          disabled={model.connection.kind === 'connecting' || !model.supportsSerial}
          {...helpProps('control:laser.device-setup.connect')}
        >
          Connect…
        </Button>
      </div>
    );
  }
  return (
    <>
      <div style={actionsStyle}>
        <Button
          onClick={() => void model.readController()}
          disabled={model.mismatch || model.controllerOperation !== null}
          {...helpProps('control:laser.device-setup.reread')}
        >
          Run read-only checks
        </Button>
        {model.detected !== null && model.rows.length > 0 ? (
          <Button
            variant="primary"
            onClick={acceptDetected}
            {...helpProps('control:laser.device-setup.apply-detected')}
          >
            Use detected values
          </Button>
        ) : null}
      </div>
      {model.state.detectedApplied ? (
        <p role="status" aria-live="polite" aria-atomic="true" style={confirmationStyle}>
          Detected values applied to this setup draft. Nothing is saved until you complete the final
          Save step.
        </p>
      ) : null}
    </>
  );
}

function DetectedReadback(props: {
  readonly model: ReturnType<typeof useConnectionStepModel>;
}): JSX.Element {
  if (props.model.rows.length === 0) {
    return (
      <p style={hintStyle}>
        No mapped values have been read. You can continue and enter the manufacturer values by hand.
      </p>
    );
  }
  return (
    <div style={readbackStyle}>
      <strong>Detected profile values</strong>
      <ul style={listStyle}>
        {props.model.rows.map((row) => (
          <li key={row.label}>
            {row.label}: <strong>{row.newText}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CommandContract(props: {
  readonly guide: ReturnType<typeof machineSetupControllerGuide>;
}): JSX.Element {
  const { guide } = props;
  return (
    <details style={detailsStyle}>
      <summary
        style={summaryStyle}
        title={`Show the exact read, status, home, and configuration contract for ${guide.label}.`}
      >
        Commands and configuration used for {guide.label}
      </summary>
      <dl style={definitionStyle}>
        <dt>Identify</dt>
        <dd>{commandList(guide.identityCommands)}</dd>
        <dt>Read / settle</dt>
        <dd>{commandList(guide.settingsCommands)}</dd>
        <dt>Status</dt>
        <dd>{guide.statusCommand ?? 'Not available'}</dd>
        <dt>Home</dt>
        <dd>{guide.homeCommand ?? 'Not available'}</dd>
        <dt>Configure in</dt>
        <dd>{guide.configurationSurface}</dd>
      </dl>
    </details>
  );
}

function connectionStatusText(connection: ConnectionState): string {
  switch (connection.kind) {
    case 'disconnected':
      return 'Not connected.';
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return 'Controller connected.';
    case 'failed':
      return `Connection failed: ${connection.error}`;
    default:
      return assertNever(connection);
  }
}

function commandList(commands: ReadonlyArray<string>): string {
  return commands.length === 0 ? 'Not available' : commands.join(', ');
}

function showError(pushToast: (message: string, kind: 'error') => void): (error: unknown) => void {
  return (error) => pushToast(error instanceof Error ? error.message : String(error), 'error');
}

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 };
const statusStyle: React.CSSProperties = { margin: 0, fontWeight: 600 };
const actionsStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
  lineHeight: 1.45,
};
const warningStyle: React.CSSProperties = { margin: 0, fontSize: 12, color: 'var(--lf-warning)' };
const confirmationStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-success-fg)',
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.45,
};
const warningCardStyle: React.CSSProperties = {
  display: 'grid',
  gap: 7,
  border: '1px solid var(--lf-warning)',
  borderRadius: 6,
  padding: 9,
  fontSize: 12,
};
const readbackStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: 8,
  fontSize: 12,
};
const listStyle: React.CSSProperties = { margin: '4px 0 0', paddingLeft: 18, lineHeight: 1.5 };
const detailsStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: 8,
};
const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 12, fontWeight: 600 };
const definitionStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '100px minmax(0, 1fr)',
  gap: '5px 10px',
  margin: '8px 0 0',
  fontSize: 12,
};
