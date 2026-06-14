// ConnectionBar — "Connect to laser" button + current status indicator.
//
// State-driven button label per F-B1/F-B2:
//   disconnected → "Connect…"
//   connecting   → spinner + "Connecting…" (disabled)
//   connected    → "Disconnect"
//   failed       → "Connect (last error: …)"

import type { ConnectionState } from '../state/laser-store';

type Props = {
  readonly connection: ConnectionState;
  readonly onConnect: () => void;
  readonly onDisconnect: () => void;
  readonly disabled: boolean;
};

export function ConnectionBar(props: Props): JSX.Element {
  const { connection, onConnect, onDisconnect, disabled } = props;
  return (
    <div style={rowStyle}>
      {connection.kind === 'connected' ? (
        <button
          type="button"
          onClick={onDisconnect}
          disabled={disabled}
          title="Close the current laser serial connection."
        >
          Disconnect
        </button>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          disabled={disabled || connection.kind === 'connecting'}
          title="Open the browser serial picker and connect to your laser controller."
        >
          {connection.kind === 'connecting' ? 'Connecting…' : 'Connect…'}
        </button>
      )}
      <StatusDot connection={connection} />
      {connection.kind === 'failed' && <span style={errorStyle}>Failed: {connection.error}</span>}
    </div>
  );
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
const errorStyle: React.CSSProperties = { color: 'var(--lf-danger-fg)', fontSize: 11 };
