import { afterEach, expect, it } from 'vitest';
import {
  probeFormContextKey,
  probeFormForContext,
  useProbeFormStore,
} from '../laser/probe-form-store';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
import { resetStore } from './test-helpers';

afterEach(() => {
  resetStore();
  useLaserStore.setState({ controllerSessionEpoch: 0 });
  useProbeFormStore.setState({ draftsByContext: {} });
});

function currentProbeContextKey(): string {
  const state = useStore.getState();
  return probeFormContextKey(
    state.projectDocumentEpoch,
    state.probeSetupEpoch,
    useLaserStore.getState().controllerSessionEpoch,
  );
}

it('keeps the probe draft through undo and redo of an ordinary device profile edit', () => {
  useStore.getState().setMachineKind('cnc');
  useStore.getState().replaceDeviceProfile({
    ...useStore.getState().project.device,
    name: 'Current CNC setup',
  });
  const contextKey = currentProbeContextKey();
  useProbeFormStore.getState().setMode(contextKey, 'corner');

  useStore.getState().updateDeviceProfile({
    maxFeed: useStore.getState().project.device.maxFeed + 1,
  });
  expect(currentProbeContextKey()).toBe(contextKey);

  useStore.getState().undo();
  expect(currentProbeContextKey()).toBe(contextKey);
  expect(probeFormForContext(useProbeFormStore.getState(), contextKey).mode).toBe('corner');

  useStore.getState().redo();
  expect(currentProbeContextKey()).toBe(contextKey);
  expect(probeFormForContext(useProbeFormStore.getState(), contextKey).mode).toBe('corner');
});
