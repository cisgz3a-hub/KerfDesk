// RotaryModeSwitch — the Rotary on/off switch beside Frame/Start (ADR-373),
// LightBurn's "Show rotary enable in main window" made permanent once a
// rotary has been set up. It edits the same profile setup Rotary Setup
// edits and names the attachment and size, so the operator sees which
// mapping the next Frame and Start use. Switching changes the job's Y
// mapping, so a completed Frame expires with it like any other device edit.

import { useState } from 'react';
import {
  isRotaryActive,
  rotaryMeasurementsValid,
  type RotarySetup,
} from '../../core/devices/rotary';
import { Button } from '../kit';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { jobControlsBusy } from './job-controls-busy';
import { rotaryAttachmentSummary, rotaryMappingSummary } from './rotary-summary';
import { RotarySetupHost } from './RotarySetupHost';

export function RotaryModeSwitch(): JSX.Element | null {
  const rotary = useStore((s) => s.project.device.rotary);
  const machineKind = useStore((s) => s.project.machine?.kind ?? 'laser');
  const updateDeviceProfile = useStore((s) => s.updateDeviceProfile);
  const busy = useLaserStore((s) =>
    jobControlsBusy(s.streamer?.status, s.motionOperation, s.controllerOperation),
  );
  const [setupOpen, setSetupOpen] = useState(false);
  // CNC output never applies the rotary mapping (ADR-127).
  if (rotary === undefined || machineKind === 'cnc') return null;
  const active = isRotaryActive(rotary);
  const valid = rotaryMeasurementsValid(rotary);
  const summary = rotaryAttachmentSummary(rotary);
  // A setup whose measurements cannot map Y opens Rotary Setup instead.
  const toggle = (): void => {
    if (valid) updateDeviceProfile({ rotary: { ...rotary, enabled: !active } });
    else setSetupOpen(true);
  };
  return (
    <div role="group" aria-label="Rotary" style={rowStyle}>
      <Button
        pressed={active}
        disabled={busy}
        title={switchTitle(rotary, active, valid, busy)}
        onClick={toggle}
      >
        Rotary
      </Button>
      <span style={summaryStyle} title={summary}>
        {active ? summary : `Off · ${summary}`}
      </span>
      <Button variant="ghost" onClick={() => setSetupOpen(true)}>
        Setup…
      </Button>
      {setupOpen ? <RotarySetupHost onClose={() => setSetupOpen(false)} /> : null}
    </div>
  );
}

function switchTitle(rotary: RotarySetup, active: boolean, valid: boolean, busy: boolean): string {
  if (busy) return 'Wait for the current job or motion to finish before switching the rotary.';
  if (!valid) return 'Rotary Setup needs measurements greater than zero. Click to open it.';
  if (active) return `Rotary on: ${rotaryMappingSummary(rotary)}. Click to turn it off.`;
  return 'Rotary off: jobs use the flat bed. Click to turn the rotary on.';
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  fontSize: 'var(--lf-text-sm)',
};
const summaryStyle: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'var(--lf-text-muted)',
};
