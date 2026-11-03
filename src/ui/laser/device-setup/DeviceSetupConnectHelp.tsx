// "Can't connect?" inside Machine Setup's connection strip (UX audit U2-P3-6).
// The window is modal, so Help > Can't connect? behind it could not be
// clicked; the strip opens the same help over the setup window. After a port
// picker came back empty or cancelled it says so and names the USB driver
// (2026-07-10 S12-F2).

import { useState } from 'react';
import { ConnectionHelpDialog } from '../../help/ConnectionHelpDialog';
import type { ConnectionState } from '../../state/laser-store';
import { NoPortChosenHint, noPortChosen } from '../NoPortChosenHint';
import type { FindMachinePhaseKind } from './find-machine-phase';

// The phases where the machine has not answered yet.
const HELP_PHASES: ReadonlySet<FindMachinePhaseKind> = new Set(['idle', 'failed', 'silent']);

export function DeviceSetupConnectHelp(props: {
  readonly connection: ConnectionState;
  readonly phase: FindMachinePhaseKind;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (!HELP_PHASES.has(props.phase) && !open) return null;
  const show = (): void => setOpen(true);
  return (
    <>
      {noPortChosen(props.connection) ? (
        <NoPortChosenHint onHelp={show} />
      ) : (
        <p>
          <button
            type="button"
            className="lf-btn lf-btn--ghost lf-btn--sm"
            onClick={show}
            title="Show the connection and USB driver troubleshooting steps."
          >
            Can’t connect?
          </button>
        </p>
      )}
      {open ? <ConnectionHelpDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
