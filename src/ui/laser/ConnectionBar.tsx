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

import type { ConnectionState } from '../state/laser-store';
import type { ControllerQualification } from '../state/laser-controller-qualification';

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
        {connection.kind === 'connected' ? (
          <>
            <button
              type="button"
              onClick={onDisconnect}
              disabled={disabled}
              title={`Close the current ${machineNoun} serial connection but keep device permission.`}
            >
              Disconnect
            </button>
            <button
              type="button"
              onClick={onForget}
              disabled={disabled}
              title={`Disconnect and remove this ${machineNoun} from the browser's permitted devices.`}
            >
              Forget Controller
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            disabled={disabled || connection.kind === 'connecting'}
            title={`Open the browser serial picker and connect to your ${machineNoun} controller.`}
          >
            {connection.kind === 'connecting' ? 'Connecting…' : 'Connect…'}
          </button>
        )}
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
    <div role="alert" style={qualificationErrorStyle}>
      <strong>Controller qualification failed.</strong> {qualification.message}{' '}
      {props.onRetry !== undefined && (
        <button type="button" onClick={props.onRetry} disabled={props.disabled}>
          Retry reading controller settings
        </button>
      )}
      {props.onReconnect !== undefined && (
        <button type="button" onClick={props.onReconnect} disabled={props.disabled}>
          Reconnect controller
        </button>
      )}
    </div>
  );
}

function qualificationMessage(
  phase: Extract<ControllerQualification, { readonly kind: 'qualifying' }>['phase'],
): string {
  if (phase === 'controller-response') return 'Waiting for controller response…';
  if (phase === 'reset-cleanup') {
    return 'Controller reset detected. Waiting for fresh Idle before reading settings…';
  }
  return 'Reading controller settings…';
}

function StatusDot({ connection }: { readonly connection: ConnectionState }): JSX.Element {
  const color =
    connection.kind === 'connected'
      ? 'var(--lf-success)'
      : connection.kind === 'connecting'
        ? 'var(--lf-warning)'
        : connection.kind === 'failed'
          ? 'var(--lf-danger)'
          : 'var(--lf-text-faint)';
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

const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
const containerStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const errorStyle: React.CSSProperties = { color: 'var(--lf-danger-fg)', fontSize: 11 };
const qualificationStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 11,
};
const qualificationErrorStyle: React.CSSProperties = {
  color: 'var(--lf-danger-fg)',
  fontSize: 11,
};
