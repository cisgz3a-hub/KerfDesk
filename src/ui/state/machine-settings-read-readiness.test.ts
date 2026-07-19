import { describe, expect, it } from 'vitest';
import type { LaserState } from './laser-store';
import { useLaserStore } from './laser-store';
import { FIRE_ACTIVE_COMMAND_MESSAGE } from './laser-store-helpers';
import { machineSettingsReadBlockReason } from './machine-settings-read-readiness';

function state(overrides: Partial<LaserState> = {}): LaserState {
  return {
    ...useLaserStore.getState(),
    connection: { kind: 'connected' },
    statusReport: { state: 'Idle' } as LaserState['statusReport'],
    fireActive: false,
    streamer: null,
    motionOperation: null,
    controllerOperation: null,
    autofocusBusy: false,
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
    ...overrides,
  };
}

describe('machineSettingsReadBlockReason', () => {
  it('allows a settled, connected Idle controller', () => {
    expect(machineSettingsReadBlockReason(state())).toBeNull();
  });

  it('requires a connection and a reported Idle state', () => {
    expect(machineSettingsReadBlockReason(state({ connection: { kind: 'disconnected' } }))).toBe(
      'Connect to the laser first.',
    );
    expect(machineSettingsReadBlockReason(state({ statusReport: null }))).toBe(
      'Controller must report Idle before reading machine settings.',
    );
    expect(
      machineSettingsReadBlockReason(
        state({ statusReport: { state: 'Run' } as LaserState['statusReport'] }),
      ),
    ).toBe('Controller must report Idle before reading machine settings.');
  });

  it('waits for fire and queued writes without dispatching anything', () => {
    expect(machineSettingsReadBlockReason(state({ fireActive: true }))).toBe(
      FIRE_ACTIVE_COMMAND_MESSAGE,
    );
    expect(machineSettingsReadBlockReason(state({ pendingUntrackedAcks: 1 }))).toContain(
      'previous controller write',
    );
    expect(machineSettingsReadBlockReason(state({ pendingTransportWrites: 1 }))).toContain(
      'previous controller write',
    );
  });

  it('includes the non-observable settings collector at the store boundary', () => {
    expect(machineSettingsReadBlockReason(state(), { settingsCollectionActive: true })).toContain(
      'already being read',
    );
  });
});
