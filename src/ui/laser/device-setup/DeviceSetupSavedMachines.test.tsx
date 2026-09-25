// My machines inside Machine Setup (ADR-374): a saved machine loads verbatim
// into the draft, and saving it is a machine switch that ends the Frame.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../../core/devices/falcon-profiles';
import {
  EMPTY_SAVED_MACHINE_LIST,
  addSavedMachine,
  createSavedMachine,
} from '../../../core/saved-machines/saved-machine-list';
import type { PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { takeFrameExpiryReason } from '../frame-expiry-note';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { initialLaserState } from '../../state/laser-store-helpers';
import { useSavedMachinesStore } from '../../state/saved-machines-store';
import { resetStore } from '../../state/test-helpers';
import { DeviceSetupWizard } from './DeviceSetupWizard';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const FALCON = createSavedMachine({
  id: 'falcon',
  profile: FALCON_A1_PRO_GRBLHAL_PROFILE,
  machineKind: 'laser',
  name: 'Workshop Falcon',
  now: 1,
});

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: vi.fn(async () => []),
  pickFileForSave: vi.fn(async () => null),
  serial: { isSupported: () => true, requestPort: async () => null },
};

let host: HTMLDivElement;
let root: Root;

function button(label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (match === undefined) throw new Error(`Button not rendered: ${label}`);
  return match;
}

beforeEach(async () => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  useSavedMachinesStore.setState({
    list: addSavedMachine(EMPTY_SAVED_MACHINE_LIST, FALCON),
    persistFailed: false,
  });
  takeFrameExpiryReason();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <PlatformProvider adapter={platform}>
        <DeviceSetupWizard onClose={() => undefined} />
      </PlatformProvider>,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetStore();
  useLaserStore.setState(initialLaserState());
  useSavedMachinesStore.setState({ list: EMPTY_SAVED_MACHINE_LIST, persistFailed: false });
  takeFrameExpiryReason();
});

describe('My machines in Machine Setup', () => {
  it('loads a saved machine into the draft and saves it as a machine switch', async () => {
    const card = host.querySelector<HTMLInputElement>(
      'input[aria-label="Use saved machine Workshop Falcon"]',
    );
    if (card === null) throw new Error('saved machine card missing');
    useLaserStore.setState({ frameVerification: { kind: 'fixture' } as never });

    await act(async () => card.click());
    for (const label of ['Check essentials', 'Review setup']) {
      await act(async () => button(label).click());
    }
    await act(async () => button('Save machine setup').click());

    const device = useStore.getState().project.device;
    expect(device.savedMachineId).toBe('falcon');
    expect(device.name).toBe('Workshop Falcon');
    expect(device.bedWidth).toBe(FALCON_A1_PRO_GRBLHAL_PROFILE.bedWidth);
    expect(device.controllerKind).toBe(FALCON_A1_PRO_GRBLHAL_PROFILE.controllerKind);
    expect(useLaserStore.getState().frameVerification).toBeNull();
    expect(takeFrameExpiryReason()).toBe('The machine changed to “Workshop Falcon” after Frame.');
  });
});
