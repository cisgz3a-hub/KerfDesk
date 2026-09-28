// ADR-500: a banner above the workspace while the job is still on the generic
// starter machine. It is not a modal and blocks nothing (F-A1); it offers the
// machine last saved in Machine Setup, or Machine Setup itself. Not now hides it
// until the next launch.

import { useMemo, useState } from 'react';
import type { DeviceProfile } from '../../core/devices';
import { Button } from '../kit';
import { openMachineSetup } from '../laser/device-setup';
import { useMachineSetupDialogStore } from '../laser/device-setup/machine-setup-dialog-store';
import { useStore } from '../state';
import { browserLocalStorage } from '../state/browser-local-storage';
import { loadConfiguredSignatures } from '../state/device-setup-configured-persistence';
import { loadLastMachine } from '../state/last-machine-persistence';
import { machineSetupBannerState } from './machine-setup-banner-state';

export function MachineSetupBanner(): JSX.Element | null {
  const device = useStore((state) => state.project.device);
  const replaceDeviceProfile = useStore((state) => state.replaceDeviceProfile);
  const configuredRevision = useMachineSetupDialogStore((store) => store.configuredRevision);
  const [dismissed, setDismissed] = useState(false);
  const saved = useMemo(() => savedMachines(configuredRevision), [configuredRevision]);
  const banner = useMemo(
    () => machineSetupBannerState({ device, dismissed, ...saved }),
    [device, dismissed, saved],
  );
  if (banner.kind === 'hidden') return null;
  const size = bedSize(device);
  return (
    <section role="status" aria-label="Machine not set up" style={bannerStyle}>
      {banner.kind === 'last-machine' ? (
        <span>
          <strong>Generic {size} machine.</strong> Your last machine was{' '}
          <strong>{banner.machine.name}</strong> ({bedSize(banner.machine)}). The bed, power and
          speeds here are guesses until you pick your machine.
        </span>
      ) : (
        <span>
          <strong>Generic {size} machine.</strong> The bed, power and speeds are guesses until you
          set up your machine. You can design now and set it up later.
        </span>
      )}
      <span style={actionsStyle}>
        {banner.kind === 'last-machine' ? (
          <>
            <Button variant="primary" onClick={() => replaceDeviceProfile(banner.machine)}>
              {`Use ${banner.machine.name}`}
            </Button>
            <Button onClick={() => openMachineSetup()}>Set up another</Button>
          </>
        ) : (
          <Button variant="primary" onClick={() => openMachineSetup()}>
            Set up machine
          </Button>
        )}
        <Button title="Hide this until KerfDesk next starts." onClick={() => setDismissed(true)}>
          Not now
        </Button>
      </span>
    </section>
  );
}

function savedMachines(_revision: number): {
  readonly configured: ReadonlySet<string>;
  readonly lastMachine: DeviceProfile | null;
} {
  const storage = browserLocalStorage();
  if (storage === null) return { configured: new Set(), lastMachine: null };
  return { configured: loadConfiguredSignatures(storage), lastMachine: loadLastMachine(storage) };
}

function bedSize(profile: DeviceProfile): string {
  return `${formatMm(profile.bedWidth)} × ${formatMm(profile.bedHeight)} mm`;
}

function formatMm(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

const bannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '8px 12px',
  borderBottom: '1px solid var(--lf-border)',
  background: 'var(--lf-tint-info)',
  color: 'var(--lf-text)',
  fontSize: 12,
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexShrink: 0,
};
