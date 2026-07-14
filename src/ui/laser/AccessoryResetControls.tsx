import { useState } from 'react';
import type { StatusReport } from '../../core/controllers/grbl';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';

type Accessories = NonNullable<StatusReport['accessories']>;

export function AccessoryResetControls({
  accessories,
  controlsBusy,
  controllerState,
  disabled,
  machineKind,
}: {
  readonly accessories: Accessories | null;
  readonly controlsBusy: boolean;
  readonly controllerState: StatusReport['state'] | null;
  readonly disabled: boolean;
  readonly machineKind: 'laser' | 'cnc';
}): JSX.Element | null {
  const sendConsoleCommand = useLaserStore((state) => state.sendConsoleCommand);
  const [busy, setBusy] = useState(false);
  if (!shouldShow(controlsBusy, controllerState, machineKind, accessories)) return null;
  const active = activeAccessoryLabels(accessories).join(', ');
  return (
    <div style={containerStyle} role="alert" aria-label="Active spindle or coolant">
      <span>
        Controller reports active: <strong>{active}</strong>. CNC Start remains blocked until a
        fresh status report confirms spindle and coolant off.
      </span>
      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => {
          if (jobAwareConfirm(STOP_ACCESSORIES_CONFIRMATION)) {
            void stopAccessories(sendConsoleCommand, setBusy);
          }
        }}
        title="Send one acknowledged GRBL block containing M5 (spindle off) and M9 (coolant off)."
      >
        {busy ? 'Stopping…' : 'Stop spindle & coolant'}
      </button>
    </div>
  );
}

const STOP_ACCESSORIES_CONFIRMATION =
  'Stopping a spindle while the cutter is embedded can bind or damage the tool and work. ' +
  'Confirm the cutter is clear of material and stopping spindle/coolant is safe. ' +
  'Otherwise use your machine-specific recovery procedure.';

function shouldShow(
  controlsBusy: boolean,
  controllerState: StatusReport['state'] | null,
  machineKind: 'laser' | 'cnc',
  accessories: Accessories | null,
): accessories is Accessories {
  return (
    !controlsBusy &&
    controllerState === 'Idle' &&
    machineKind === 'cnc' &&
    accessories !== null &&
    accessories.secondarySpindlePresent !== true &&
    (accessories.spindleCw || accessories.spindleCcw || accessories.flood || accessories.mist)
  );
}

async function stopAccessories(
  sendConsoleCommand: (command: string) => Promise<void>,
  setBusy: (busy: boolean) => void,
): Promise<void> {
  setBusy(true);
  try {
    // One GRBL block is intentional. Sending M5 first through the guarded
    // console path invalidates cached Idle, which would correctly block a
    // second standalone M9 until a fresh status report arrives.
    await sendConsoleCommand('M5 M9');
  } catch {
    // The store already records and surfaces serial-write/command blockers.
    // Swallow here so the fire-and-forget click handler cannot leak a rejected
    // promise into the browser event loop.
  } finally {
    setBusy(false);
  }
}

function activeAccessoryLabels(accessories: Accessories): string[] {
  const active: string[] = [];
  if (accessories.spindleCw) active.push('clockwise spindle');
  if (accessories.spindleCcw) active.push('counter-clockwise spindle');
  if (accessories.flood) active.push('flood coolant');
  if (accessories.mist) active.push('mist coolant');
  return active;
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  border: '1px solid var(--lf-warning)',
  borderRadius: 4,
  padding: '6px 8px',
  color: 'var(--lf-warning-fg)',
  fontSize: 11,
};
