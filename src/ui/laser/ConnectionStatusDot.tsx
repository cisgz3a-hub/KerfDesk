// The connection pill's status dot: red while the controller is in Alarm or
// halted (UX audit U5-P3-1, U5-P3-6), amber while it is silent or still being
// read, else the connection's own colour.

import { assertNever } from '../../core/scene';
import type { ControllerAttention } from '../state/controller-attention';
import type { ConnectionState } from '../state/laser-store';

export function StatusDot(props: {
  readonly connection: ConnectionState;
  readonly silent: boolean;
  readonly qualifying: boolean;
  readonly attention: ControllerAttention | null;
}): JSX.Element {
  const color =
    props.attention !== null
      ? 'var(--lf-danger)'
      : props.silent || props.qualifying
        ? 'var(--lf-warning)'
        : connectionStatusColor(props.connection);
  return (
    <span
      aria-hidden="true"
      style={{
        flexShrink: 0,
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
