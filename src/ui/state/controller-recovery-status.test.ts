import { describe, expect, it } from 'vitest';
import { controllerReconnectRecommended } from './controller-recovery-status';

type RecoveryStatus = Parameters<typeof controllerReconnectRecommended>[0];

const now = 20_000;

function state(overrides: Partial<RecoveryStatus> = {}): RecoveryStatus {
  return {
    connection: { kind: 'connected' },
    controllerSessionEpoch: 4,
    controllerQualification: { kind: 'failed', epoch: 4, message: 'Empty settings response.' },
    controllerOperation: null,
    motionOperation: null,
    streamer: null,
    fireActive: false,
    autofocusBusy: false,
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
    statusObservation: { sessionEpoch: 4, positionEpoch: 1, sequence: 7, observedAt: now - 500 },
    ...overrides,
  };
}

describe('current controller reconnect recommendation', () => {
  it('keeps a responsive, settled connection when controller information is missing', () => {
    expect(controllerReconnectRecommended(state(), now)).toBe(false);
  });

  it('keeps a responsive Alarm or Sleep connection without promoting position authority', () => {
    expect(
      controllerReconnectRecommended(
        state({
          statusObservation: null,
          statusResponseObservation: { sessionEpoch: 4, observedAt: now - 500 },
        }),
        now,
      ),
    ).toBe(false);
  });

  it.each([
    null,
    { sessionEpoch: 3, observedAt: now - 500 },
    { sessionEpoch: 4, observedAt: now - 8_000 },
  ])(
    'recognises missing, old-session or stale communication independently of position (%j)',
    (statusResponseObservation) => {
      expect(controllerReconnectRecommended(state({ statusResponseObservation }), now)).toBe(true);
    },
  );

  it('offers replacement for a lost or failed connection, but not a picker already opening', () => {
    expect(
      controllerReconnectRecommended(state({ connection: { kind: 'disconnected' } }), now),
    ).toBe(true);
    expect(
      controllerReconnectRecommended(
        state({ connection: { kind: 'failed', error: 'USB lost' } }),
        now,
      ),
    ).toBe(true);
    expect(controllerReconnectRecommended(state({ connection: { kind: 'connecting' } }), now)).toBe(
      false,
    );
  });

  it('offers recovery from a failed response that still owns an acknowledgement', () => {
    expect(controllerReconnectRecommended(state({ pendingUntrackedAcks: 1 }), now)).toBe(true);
  });

  it('offers replacement for a failed write still in transport despite fresh status and no ACK reservation', () => {
    expect(controllerReconnectRecommended(state({ pendingTransportWrites: 1 }), now)).toBe(true);
  });

  it('waits for an active owner instead of interrupting its current response', () => {
    expect(
      controllerReconnectRecommended(
        state({
          pendingUntrackedAcks: 1,
          pendingTransportWrites: 1,
          controllerOperation: {
            kind: 'interactive-command',
            phase: 'command',
            label: 'Reading controller build information',
          },
        }),
        now,
      ),
    ).toBe(false);
  });

  it('preserves manual Home ownership despite a failed qualification and pending transport', () => {
    expect(
      controllerReconnectRecommended(
        state({
          pendingTransportWrites: 1,
          controllerOperation: {
            kind: 'home',
            phase: 'awaiting-idle',
            idleReports: 0,
            operationId: 1,
          },
        }),
        now,
      ),
    ).toBe(false);
  });

  it('offers replacement for an unresolved failed reset even after anonymous replies drain', () => {
    expect(
      controllerReconnectRecommended(
        state({ controllerOperation: { kind: 'recovery', phase: 'reset', idleReports: 0 } }),
        now,
      ),
    ).toBe(true);
  });

  it('lets an active reset recover before offering a replacement', () => {
    expect(
      controllerReconnectRecommended(
        state({
          controllerOperation: { kind: 'recovery', phase: 'reset', idleReports: 0 },
          controllerQualification: { kind: 'qualifying', epoch: 4, phase: 'reset-cleanup' },
        }),
        now,
      ),
    ).toBe(false);
  });

  it.each([
    null,
    { sessionEpoch: 3, positionEpoch: 1, sequence: 7, observedAt: now - 500 },
    { sessionEpoch: 4, positionEpoch: 1, sequence: 7, observedAt: now - 8_000 },
  ])(
    'offers replacement after failed recovery without current recent status (%j)',
    (statusObservation) => {
      expect(controllerReconnectRecommended(state({ statusObservation }), now)).toBe(true);
    },
  );

  it('removes the reconnect recommendation once recovery has qualified the current session', () => {
    expect(
      controllerReconnectRecommended(
        state({
          controllerQualification: { kind: 'qualified', epoch: 4, settings: 'verified' },
          pendingTransportWrites: 1,
        }),
        now,
      ),
    ).toBe(false);
  });

  it('does not use a failed record from an earlier session to replace the current connection', () => {
    expect(
      controllerReconnectRecommended(
        state({
          controllerQualification: { kind: 'failed', epoch: 3, message: 'Earlier failure' },
          statusObservation: null,
        }),
        now,
      ),
    ).toBe(false);
  });
});
