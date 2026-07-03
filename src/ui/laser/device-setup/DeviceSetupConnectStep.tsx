// Step 1 of the Device Setup wizard: show the connection, let the operator
// connect or re-read $$, and summarize what the controller reported so they
// can copy it into the working draft.

import { usePlatform } from '../../app/platform-context';
import { helpProps } from '../../help/help-topics';
import { Button } from '../../kit';
import { assertNever } from '../../../core/scene';
import { useLaserStore, type ConnectionState } from '../../state/laser-store';
import { describePatch } from '../DetectedSettingsBanner';
import type { DeviceSetupStepProps } from './device-setup-flow';

export function DeviceSetupConnectStep({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  const platform = usePlatform();
  const connection = useLaserStore((s) => s.connection);
  const detected = useLaserStore((s) => s.detectedSettings);
  const connect = useLaserStore((s) => s.connect);
  const readMachineSettings = useLaserStore((s) => s.readMachineSettings);
  const connected = connection.kind === 'connected';
  const supportsSerial = platform.serial.isSupported();
  const rows = detected === null ? [] : describePatch(detected, state.baseline);
  return (
    <section style={sectionStyle}>
      <p style={statusStyle}>{connectionStatusText(connection)}</p>
      {connected ? (
        <div style={actionsStyle}>
          <Button
            onClick={() => void readMachineSettings().catch(() => undefined)}
            {...helpProps('control:laser.device-setup.reread')}
          >
            Re-read ($$)
          </Button>
          {detected !== null && rows.length > 0 ? (
            <Button
              variant="primary"
              onClick={() => {
                dispatch({ kind: 'accept-detected', patch: detected });
                dispatch({ kind: 'go', step: 'confirm' });
              }}
              {...helpProps('control:laser.device-setup.apply-detected')}
            >
              Apply detected
            </Button>
          ) : null}
        </div>
      ) : (
        <Button
          variant="primary"
          // Bind the draft profile's firmware + baud, exactly like the rail's
          // ConnectionBar: a bare connect() selects the GRBL driver at 115200
          // and drives Marlin/Smoothie boxes with the wrong protocol.
          onClick={() =>
            void connect(platform, {
              controllerKind: state.draft.controllerKind,
              baudRate: state.draft.baudRate,
            }).catch(() => undefined)
          }
          disabled={connection.kind === 'connecting' || !supportsSerial}
          {...helpProps('control:laser.device-setup.connect')}
        >
          Connect…
        </Button>
      )}
      {!supportsSerial && (
        <p style={hintStyle}>
          Web Serial is not supported in this browser — use Chrome or Edge to connect, or
          continue and enter settings by hand.
        </p>
      )}
      {rows.length > 0 ? (
        <ul style={listStyle}>
          {rows.map((row) => (
            <li key={row.label}>
              {row.label}: <strong>{row.newText}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p style={hintStyle}>
          {connected
            ? 'No settings have been read yet. Use Re-read ($$), or enter values on the next steps.'
            : 'Connect to read your machine settings automatically, or continue to enter them by hand.'}
        </p>
      )}
    </section>
  );
}

function connectionStatusText(connection: ConnectionState): string {
  switch (connection.kind) {
    case 'disconnected':
      return 'Not connected.';
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return 'Connected to the controller.';
    case 'failed':
      return `Connection failed: ${connection.error}`;
    default:
      return assertNever(connection);
  }
}

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const statusStyle: React.CSSProperties = { margin: 0, fontWeight: 600 };
const actionsStyle: React.CSSProperties = { display: 'flex', gap: 8 };
const listStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  fontSize: 12,
  lineHeight: 1.5,
};
const hintStyle: React.CSSProperties = { margin: 0, fontSize: 12, color: 'var(--lf-text-muted)' };
