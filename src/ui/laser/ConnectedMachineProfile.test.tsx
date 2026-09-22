import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { ConnectedMachineProfile } from './ConnectedMachineProfile';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalLaserState = useLaserStore.getState();
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useLaserStore.setState(originalLaserState, true);
  resetStore();
});

describe('ConnectedMachineProfile', () => {
  it('keeps the displayed controller contract tied to the active connection when the saved profile changes', () => {
    useStore.getState().replaceDeviceProfile(FALCON_A1_PRO_GRBLHAL_PROFILE);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      activeControllerKind: 'grblhal',
      activeControllerCommandSet: 'creality-falcon-a1-pro',
    });
    act(() => root.render(<ConnectedMachineProfile />));
    expect(host.querySelector('.lf-connected-profile-detail')?.textContent).toBe(
      '358 × 268 mm · Falcon A1 Pro (GRBL-compatible commands)',
    );

    // Saving another profile does not reselect the driver in an open session.
    act(() => useStore.getState().replaceDeviceProfile(DEFAULT_DEVICE_PROFILE));
    expect(host.querySelector('.lf-connected-profile-name')?.textContent).toBe(
      DEFAULT_DEVICE_PROFILE.name,
    );
    expect(host.querySelector('.lf-connected-profile-detail')?.textContent).toBe(
      '400 × 400 mm · Falcon A1 Pro (GRBL-compatible commands)',
    );

    // Reconnecting with the generic family changes the displayed contract even
    // when the family itself stays grblHAL.
    act(() => useLaserStore.setState({ activeControllerCommandSet: null }));
    expect(host.querySelector('.lf-connected-profile-detail')?.textContent).toBe(
      '400 × 400 mm · grblHAL',
    );
    act(() => useLaserStore.setState({ connection: { kind: 'disconnected' } }));
    expect(host.querySelector('[aria-label="Connected machine profile"]')).toBeNull();
  });
});
