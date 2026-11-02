// R6-P2-3 (rolling audit v9): connect names a grblHAL bed widened to the
// whole travel once, with both sizes, and changes it only when asked (ADR-637
// Amendment 5).
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { HomedBedCorrectionOffer, resetAnsweredBedCorrections } from './HomedBedCorrectionOffer';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function connectWithA1ProSettings(): void {
  useLaserStore.setState({
    connection: { kind: 'connected' } as ReturnType<typeof useLaserStore.getState>['connection'],
    controllerSessionEpoch: 7,
    controllerSettingsObservation: { sessionEpoch: 7, observedAt: 0 },
    activeControllerKind: 'grblhal',
    detectedControllerKind: 'grblhal',
    controllerSettings: {
      bedWidth: 363,
      bedHeight: 273,
      homingEnabled: true,
      homingDirectionMask: 3,
      homingForceSetOrigin: true,
      hardLimitsEnabled: true,
      homingPullOffMm: 5,
      softLimitsEnabled: false,
    },
  });
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
async function render(): Promise<void> {
  await act(async () => root.render(<HomedBedCorrectionOffer />));
}
const button = (label: RegExp) =>
  [...host.querySelectorAll('button')].find((candidate) => label.test(candidate.textContent ?? ''));

beforeEach(() => {
  resetStore();
  resetAnsweredBedCorrections();
  useStore.getState().updateDeviceProfile({
    ...FALCON_A1_PRO_GRBLHAL_PROFILE,
    bedWidth: 363,
    bedHeight: 273,
  });
  host = document.createElement('div');
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  useLaserStore.setState({
    connection: { kind: 'disconnected' } as never,
    controllerSettings: null,
  });
  resetStore();
});

describe('HomedBedCorrectionOffer', () => {
  it('names both beds and the move, and corrects only when asked', async () => {
    connectWithA1ProSettings();
    await render();
    expect(host.textContent).toContain("This profile's bed is 363 × 273 mm");
    expect(host.textContent).toContain('Correct the bed from 363 × 273 mm to 358 × 268 mm?');
    expect(host.textContent).toContain('moves 5 mm in machine Y');
    expect(useStore.getState().project.device).toMatchObject({ bedWidth: 363, bedHeight: 273 });
    await act(async () => button(/^Correct bed to 358 × 268 mm$/)?.click());
    expect(useStore.getState().project.device).toMatchObject({ bedWidth: 358, bedHeight: 268 });
    expect(host.textContent).toBe('');
  });

  it('asks once: Not now keeps the bed and is not asked again this run', async () => {
    connectWithA1ProSettings();
    await render();
    await act(async () => button(/^Not now$/)?.click());
    expect(host.textContent).toBe('');
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    expect(host.textContent).toBe('');
    expect(useStore.getState().project.device).toMatchObject({ bedWidth: 363, bedHeight: 273 });
  });

  it('says nothing on the preset bed or a stock GRBL connection', async () => {
    connectWithA1ProSettings();
    useStore.getState().updateDeviceProfile({ bedWidth: 358, bedHeight: 268 });
    await render();
    expect(host.textContent).toBe('');
    useStore.getState().updateDeviceProfile({ bedWidth: 363, bedHeight: 273 });
    await act(async () =>
      useLaserStore.setState({
        activeControllerKind: 'grbl-v1.1',
        detectedControllerKind: 'grbl-v1.1',
      }),
    );
    expect(host.textContent).toBe('');
  });
});
