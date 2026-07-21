// ConnectionBar — machine connect button + current status indicator.
//
// State-driven button label per F-B1/F-B2:
//   disconnected → "Connect…"
//   connecting   → spinner + "Connecting…" (disabled)
//   connected    → "Disconnect"
//   failed       → "Connect (last error: …)"
//
// machineNoun keeps the hover copy machine-aware ("laser" / "router",
// ADR-101 §7) while this component stays presentational.

import { assertNever } from '../../core/scene';
import type { ControllerQualification } from '../state/laser-controller-qualification';
import type { ConnectionState } from '../state/laser-store';

type Props = {
  readonly connection: ConnectionState;
  readonly machineNoun: string;
  readonly onConnect: () => void;
  readonly onDisconnect: () => void;
  readonly onForget: () => void;
  readonly disabled: boolean;
  readonly qualification?: ControllerQualification;
  readonly onRetryQualification?: () => void;
  readonly onReconnectQualification?: () => void;
};

export function ConnectionBar(props: Props): JSX.Element {
  const { connection, machineNoun, onConnect, onDisconnect, onForget, disabled } = props;
  return (
    <div style={containerStyle}>
      <div style={rowStyle}>
        <ConnectionActions
          connection={connection}
          machineNoun={machineNoun}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onForget={onForget}
          disabled={disabled}
        />
        <StatusDot connection={connection} />
        {connection.kind === 'failed' && <span style={errorStyle}>Failed: {connection.error}</span>}
      </div>
      <QualificationNotice
        qualification={props.qualification}
        onRetry={props.onRetryQualification}
        onReconnect={props.onReconnectQualification}
        disabled={disabled}
      />
    </div>
  );
}

function ConnectionActions(props: Props): JSX.Element {
  switch (props.connection.kind) {
    case 'connected':
      return (
        <>
          <button
            type="button"
            onClick={props.onDisconnect}
            disabled={props.disabled}
            title={`Close the current ${props.machineNoun} serial connection but keep device permission.`}
          >
            Disconnect
          </button>
          <button
            type="button"
            onClick={props.onForget}
            disabled={props.disabled}
            title={`Disconnect and remove this ${props.machineNoun} from the browser's permitted devices.`}
          >
            Forget Controller
          </button>
        </>
      );
    case 'connecting':
      return connectButton(props, 'Connecting…', true);
    case 'disconnected':
    case 'failed':
      return connectButton(props, 'Connect…', props.disabled);
    default:
      return assertNever(props.connection, 'ConnectionState');
  }
}

function connectButton(props: Props, label: string, disabled: boolean): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onConnect}
      disabled={disabled}
      title={`Open the browser serial picker and connect to your ${props.machineNoun} controller.`}
    >
      {label}
    </button>
  );
}

function QualificationNotice(props: {
  readonly qualification: ControllerQualification | undefined;
  readonly onRetry: (() => void) | undefined;
  readonly onReconnect: (() => void) | undefined;
  readonly disabled: boolean;
}): JSX.Element | null {
  const qualification = props.qualification;
  if (qualification === undefined || qualification.kind === 'disconnected') return null;
  if (qualification.kind === 'qualified') return null;
  if (qualification.kind === 'qualifying') {
    return (
      <div role="status" style={qualificationStyle}>
        {qualificationMessage(qualification.phase)}
      </div>
    );
  }
  return (
    <div role="alert" className="lf-banner lf-banner--warning" style={qualificationErrorStyle}>
      <strong style={qualificationTitleStyle}>Controller qualification failed</strong>
      <p style={qualificationMessageStyle}>{qualification.message}</p>
      <div style={qualificationActionsStyle}>
        {props.onRetry !== undefined && (
          <button
            type="button"
            className="lf-btn"
            onClick={props.onRetry}
            disabled={props.disabled}
            title="Retry the owned controller settings read for this connection."
          >
            Retry reading controller settings
          </button>
        )}
        {props.onReconnect !== undefined && (
          <button
            type="button"
            className="lf-btn"
            onClick={props.onReconnect}
            disabled={props.disabled}
            title="Close this controller connection and reconnect for fresh qualification."
          >
            Reconnect controller
          </button>
        )}
      </div>
    </div>
  );
}

function qualificationMessage(
  phase: Extract<ControllerQualification, { readonly kind: 'qualifying' }>['phase'],
): string {
  switch (phase) {
    case 'controller-response':
      return 'Waiting for controller response…';
    case 'reset-cleanup':
      return 'Controller reset detected. Waiting for fresh Idle before reading settings…';
    case 'settings-read':
      return 'Reading controller settings…';
    default:
      return assertNever(phase, 'ControllerQualificationPhase');
  }
}

function StatusDot({ connection }: { readonly connection: ConnectionState }): JSX.Element {
  const color = connectionStatusColor(connection);
  return (
    <span
      title={connection.kind}
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: 5,
        background: color,
      }}
    />
  );
}

function connectionStatusColor(connection: ConnectionState): string {
  switch (connection.kind) {
    case 'connected':
      return 'var(--lf-success)';
    case 'connecting':
      return 'var(--lf-warning)';
    case 'failed':
      return 'var(--lf-danger)';
    case 'disconnected':
      return 'var(--lf-text-faint)';
    default:
      return assertNever(connection, 'ConnectionState');
  }
}

const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
const containerStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const errorStyle: React.CSSProperties = { color: 'var(--lf-danger-fg)', fontSize: 11 };
const qualificationStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 11,
};
// A failed qualification is recoverable in place, so it wears the shared
// warning banner rather than raw red text with bare inline buttons.
const qualificationErrorStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  fontSize: 11,
};
const qualificationTitleStyle: React.CSSProperties = { fontSize: 12 };
const qualificationMessageStyle: React.CSSProperties = { margin: 0, lineHeight: 1.45 };
const qualificationActionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
};
