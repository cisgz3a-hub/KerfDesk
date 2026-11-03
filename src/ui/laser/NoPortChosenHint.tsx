// The hint after a port picker came back with no port (UX audit U2 KNOWN,
// 2026-07-10 S12-F2). Web Serial cannot tell a Cancel from an empty list, so it
// names both, and the usual cause of an empty list: the USB-serial driver. It
// shows in the toolbar and in Machine Setup's connection strip, each with a
// way to the connection help that works where it is shown.

import type { ConnectionState } from '../state/laser-store';

export const NO_PORT_CHOSEN_HINT =
  'No port was chosen. Don’t see your machine in the list? It may need its USB driver (CH340 or CP210x).';

export function noPortChosen(connection: ConnectionState): boolean {
  return connection.kind === 'disconnected' && connection.noPortChosen === true;
}

export function NoPortChosenHint(props: {
  readonly className?: string;
  readonly onHelp: () => void;
}): JSX.Element {
  return (
    <p className={props.className} role="status">
      {NO_PORT_CHOSEN_HINT}{' '}
      <button
        type="button"
        className="lf-btn lf-btn--ghost lf-btn--sm"
        onClick={props.onHelp}
        title="Show the connection and USB driver troubleshooting steps."
      >
        Can’t connect?
      </button>
    </p>
  );
}
