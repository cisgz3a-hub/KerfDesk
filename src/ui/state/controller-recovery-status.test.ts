import { describe, expect, it } from 'vitest';
import { controllerReconnectRecommended, controllerWentSilent } from './controller-recovery-status';

type RecoveryStatus = Parameters<typeof controllerWentSilent>[0];

const now = 20_000;

function state(overrides: Partial<RecoveryStatus> = {}): RecoveryStatus {
  return {
    connection: { kind: 'connected' },
    capabilities: { statusQuery: 'realtime-report' } as RecoveryStatus['capabilities'],
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

describe('a controller that went silent (ADR-611 Amendment 1)', () => {
  const silent = (overrides: Partial<RecoveryStatus> = {}) =>
    state({
      controllerQualification: { kind: 'qualified', epoch: 4, settings: 'verified' },
      statusObservation: {
        sessionEpoch: 4,
        positionEpoch: 1,
        sequence: 7,
        observedAt: now - 9_000,
      },
      ...overrides,
    });

  it('reads silent once a controller that answered this session stops answering', () => {
    expect(controllerWentSilent(silent(), now)).toBe(true);
    expect(
      controllerWentSilent(
        silent({
          statusObservation: {
            sessionEpoch: 4,
            positionEpoch: 1,
            sequence: 7,
            observedAt: now - 500,
          },
        }),
        now,
      ),
    ).toBe(false);
  });

  it('counts Alarm and Sleep replies as answers', () => {
    expect(
      controllerWentSilent(
        silent({ statusResponseObservation: { sessionEpoch: 4, observedAt: now - 500 } }),
        now,
      ),
    ).toBe(false);
  });

  it('says nothing before the first reply of a session, while homing, or for a queued-poll controller', () => {
    expect(controllerWentSilent(silent({ statusObservation: null }), now)).toBe(false);
    expect(controllerWentSilent(silent({ controllerSessionEpoch: 5 }), now)).toBe(false);
    expect(
      controllerWentSilent(
        silent({ controllerOperation: { kind: 'home', phase: 'homing' } as never }),
        now,
      ),
    ).toBe(false);
    expect(
      controllerWentSilent(
        silent({ capabilities: { statusQuery: 'queued-poll' } as RecoveryStatus['capabilities'] }),
        now,
      ),
    ).toBe(false);
    expect(controllerWentSilent(silent({ connection: { kind: 'disconnected' } }), now)).toBe(false);
  });
});

describe('silence measured on the status poll schedule (ADR-356, ADR-611 Amendment 1)', () => {
  const quiet = (): RecoveryStatus =>
    state({
      controllerQualification: { kind: 'qualified', epoch: 4, settings: 'verified' },
      statusObservation: {
        sessionEpoch: 4,
        positionEpoch: 1,
        sequence: 7,
        observedAt: now - 9_000,
      },
    });

  it('does not read silent on the first tick after a hidden or sleeping page resumes', () => {
    expect(controllerWentSilent(quiet(), now, { lastTickAt: now, resumedAt: now })).toBe(false);
  });

  it('does not read silent while the page is not running the poll', () => {
    expect(controllerWentSilent(quiet(), now, { lastTickAt: now - 5_000, resumedAt: 0 })).toBe(
      false,
    );
  });

  it('reads silent after the window of on-schedule polling without a reply', () => {
    expect(
      controllerWentSilent(quiet(), now, { lastTickAt: now - 250, resumedAt: now - 30_000 }),
    ).toBe(true);
    expect(
      controllerWentSilent(quiet(), now, { lastTickAt: now - 250, resumedAt: now - 3_000 }),
    ).toBe(false);
  });
});

describe('a line still owed its reply (Console $H homing)', () => {
  it('does not read silent while GRBL may be busy with a line it has not answered', () => {
    const homing = state({
      controllerQualification: { kind: 'qualified', epoch: 4, settings: 'verified' },
      pendingUntrackedAcks: 1,
      statusObservation: {
        sessionEpoch: 4,
        positionEpoch: 1,
        sequence: 7,
        observedAt: now - 30_000,
      },
    });
    expect(controllerWentSilent(homing, now)).toBe(false);
    expect(controllerWentSilent({ ...homing, pendingUntrackedAcks: 0 }, now)).toBe(true);
  });
});

describe('any controller line restarts the silence window', () => {
  it('does not flip to silent when the reply that ends a Console $H arrives', () => {
    const afterHoming = state({
      controllerQualification: { kind: 'qualified', epoch: 4, settings: 'verified' },
      // The last status report is from before homing; the `$H` reply just arrived.
      statusObservation: {
        sessionEpoch: 4,
        positionEpoch: 1,
        sequence: 7,
        observedAt: now - 30_000,
      },
      transcript: [
        {
          id: 1,
          at: now - 30_000,
          direction: 'in',
          raw: '<Idle>',
          kind: 'status',
          source: 'controller',
        },
        {
          id: 2,
          at: now - 29_000,
          direction: 'out',
          raw: '$H',
          kind: 'command',
          source: 'console',
        },
        { id: 3, at: now - 200, direction: 'in', raw: 'ok', kind: 'ok', source: 'controller' },
      ] as never,
    });
    expect(controllerWentSilent(afterHoming, now)).toBe(false);
    // Eight seconds after that reply, with no status since, it is silent.
    expect(controllerWentSilent(afterHoming, now + 8_000)).toBe(true);
  });
});
