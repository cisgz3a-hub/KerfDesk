import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStreamer,
  DEFAULT_Z_PROBE_PARAMS,
  pause as pauseStreamer,
  settingsMapToRows,
  step,
} from '../../core/controllers/grbl';
import { createProject } from '../../core/scene';
import { useExperimentalLaserFeatures } from './experimental-laser-features';
import { useLaserStore } from './laser-store';
import {
  connectWith,
  makeConnection,
  type FakeConnection,
} from './laser-store-console.test-support';
import { useStore } from './store';

const MACRO_PROVENANCE = {
  kind: 'user-macro' as const,
  macroName: 'MPG matrix motion',
  macroTemplate: 'G0 X{{distance}}',
};

let writes: string[];
let connection: FakeConnection;

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  writes = [];
  connection = makeConnection(
    async (data) => {
      writes.push(data);
    },
    { autoRespondToStatusQuery: false },
  );
  useStore.setState({ project: createProject() });
  useStore.getState().updateDeviceProfile({
    airAssistCommand: 'M8',
    capabilities: ['low-power-fire'],
    fireControl: { enabled: true, maxPowerPercent: 2 },
    maxPowerS: 1000,
  });
  useExperimentalLaserFeatures.getState().resetFeatures();
  useExperimentalLaserFeatures.getState().setFeature('lowPowerFire', true);
  await connectWith(connection);
  useLaserStore.setState({
    mpgActive: true,
    statusReport: {
      ...useLaserStore.getState().statusReport,
      state: 'Idle',
      mPos: { x: 0, y: 0, z: 0 },
      spindle: 0,
    } as NonNullable<ReturnType<typeof useLaserStore.getState>['statusReport']>,
  });
  writes.length = 0;
});

afterEach(async () => {
  useLaserStore.setState({ fireActive: false, airAssistOn: false });
  await useLaserStore.getState().disconnect();
  useExperimentalLaserFeatures.getState().resetFeatures();
  useStore.setState({ project: createProject() });
  vi.restoreAllMocks();
});

async function flush(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

describe('latched grblHAL MPG machine-command ownership', () => {
  const rejectingCases: ReadonlyArray<{
    readonly label: string;
    readonly invoke: () => Promise<unknown>;
  }> = [
    { label: 'Home', invoke: () => useLaserStore.getState().home() },
    { label: 'Set Origin', invoke: () => useLaserStore.getState().setOriginHere() },
    {
      label: 'modal Console motion',
      invoke: () => useLaserStore.getState().sendConsoleCommand('G0 X1'),
    },
    {
      label: 'modal Console macro',
      invoke: () =>
        useLaserStore.getState().sendConsoleCommand('G0 X2', { provenance: MACRO_PROVENANCE }),
    },
    {
      label: 'Machine Settings read',
      invoke: () => useLaserStore.getState().readMachineSettings(),
    },
    {
      label: 'Machine Settings write',
      invoke: () => {
        useLaserStore.setState({
          grblSettingsRows: settingsMapToRows(new Map([[30, '900']])),
          lastSettingsReadAt: Date.now(),
        });
        return useLaserStore.getState().writeGrblSetting(30, '1000');
      },
    },
    { label: 'manual Air on', invoke: () => useLaserStore.getState().setAirAssistEnabled(true) },
    { label: 'low-power Fire on', invoke: () => useLaserStore.getState().setFireActive(true) },
    {
      label: 'realtime feed override',
      invoke: () => useLaserStore.getState().sendRealtimeOverride('\x90'),
    },
  ];

  it.each(rejectingCases)('$label writes nothing', async ({ invoke }) => {
    await expect(invoke()).rejects.toThrow(/MPG mode active/i);
    expect(writes).toEqual([]);
  });

  it('Probe and Autofocus return a zero-write preflight failure', async () => {
    const probe = await useLaserStore.getState().probe({
      kind: 'z',
      params: DEFAULT_Z_PROBE_PARAMS,
    });
    const autofocus = await useLaserStore.getState().autofocus('$HZ1');

    expect(probe).toEqual({
      kind: 'preflight-failed',
      reason: expect.stringMatching(/MPG mode active/i),
    });
    expect(autofocus).toEqual({
      kind: 'preflight-failed',
      reason: expect.stringMatching(/MPG mode active/i),
    });
    expect(writes).toEqual([]);
  });

  it.each([
    ['realtime status', '?', '?'],
    ['GRBL unlock', '$X', '$X\n'],
    ['spindle/coolant fail-off', 'M5 M9', 'M5 M9\n'],
  ] as const)('keeps %s Console traffic available', async (_label, command, wire) => {
    await useLaserStore.getState().sendConsoleCommand(command);
    expect(writes).toEqual([wire]);
  });

  it.each(['Run', 'Jog'] as const)(
    'keeps exact spindle/coolant fail-off Console traffic available from %s',
    async (state) => {
      useLaserStore.setState({
        statusReport: {
          ...useLaserStore.getState().statusReport,
          state,
        } as NonNullable<ReturnType<typeof useLaserStore.getState>['statusReport']>,
      });

      await useLaserStore.getState().sendConsoleCommand('M5 M9');

      expect(writes).toEqual(['M5 M9\n']);
    },
  );

  it('keeps dedicated unlock, Fire-off, and manual Air-off fail-off paths available', async () => {
    useLaserStore.setState({ fireActive: true });
    await useLaserStore.getState().setFireActive(false);
    expect(writes).toEqual(['M5\n']);

    connection.emitLine('ok');
    writes.length = 0;
    useLaserStore.setState({ airAssistOn: true });
    await useLaserStore.getState().setAirAssistEnabled(false);
    expect(writes).toEqual(['M9\n']);

    connection.emitLine('ok');
    writes.length = 0;
    await useLaserStore.getState().unlockAlarm();
    expect(writes).toEqual(['$X\n']);
  });

  it('keeps the dedicated soft-reset recovery path available', async () => {
    const recovery = useLaserStore.getState().wakeController();
    await flush();
    expect(writes).toEqual(['\x18']);

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>');
    await recovery;
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });

  it('blocks Resume and tool-change Continue without hiding Pause or Abort', async () => {
    const initial = step(createStreamer('G1 X1\nG1 X2\n', { streamingMode: 'ping-pong' })).state;
    useLaserStore.setState({
      streamer: pauseStreamer(initial),
      activeJobMachineKind: 'laser',
    });

    await expect(useLaserStore.getState().resumeJob()).rejects.toThrow(/MPG mode active/i);
    expect(writes).toEqual([]);

    const held = step(createStreamer('M0\nG1 X3\n', { toolChangePause: true })).state;
    useLaserStore.setState({
      streamer: held,
      toolChangeIdleSeen: true,
      workZZeroEvidence: {
        source: 'manual-zero',
        referenceEpoch: useLaserStore.getState().workZReferenceEpoch,
      },
    });
    await useLaserStore.getState().continueToolChange();
    expect(writes).toEqual([]);
    expect(useLaserStore.getState().lastWriteError).toMatch(/MPG mode active/i);
  });

  it('freezes an active stream on MPG takeover and never refills from later acknowledgements', async () => {
    const staged = step(createStreamer('G1 X1\nG1 X2\n', { streamingMode: 'ping-pong' })).state;
    useLaserStore.setState({
      mpgActive: false,
      streamer: staged,
      activeJobMachineKind: 'laser',
    });
    writes.length = 0;

    connection.emitLine('<Run|MPos:0.000,0.000,0.000|FS:500,0|MPG:1>');
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
    connection.emitLine('ok');
    await flush();

    expect(writes).toEqual([]);
    expect(useLaserStore.getState().streamer).toMatchObject({
      status: 'paused',
      completed: 1,
      queueIndex: 1,
    });
  });

  it('emits no persistent-origin continuation after MPG takeover', async () => {
    useLaserStore.setState({ mpgActive: false });
    const action = useLaserStore.getState().setPersistentOriginHere();
    await flush();
    expect(writes).toEqual(['G54 G92.1\n']);

    connection.emitLine('<Idle|MPos:12.000,34.000,0.000|FS:0,0|MPG:1>');
    connection.emitLine('ok');

    await expect(action).rejects.toThrow(/MPG|pulse generator/i);
    expect(writes).toEqual(['G54 G92.1\n']);
    expect(useLaserStore.getState().workOriginSource).toBe('unknown');
  });

  it.each(['Alarm', 'Sleep'] as const)(
    'keeps the active MPG latch across sparse %s reports until explicit release',
    (state) => {
      connection.emitLine(`<${state}|MPos:0.000,0.000,0.000|FS:0,0>`);
      expect(useLaserStore.getState().mpgActive).toBe(true);

      connection.emitLine(`<${state}|MPos:0.000,0.000,0.000|FS:0,0|MPG:0>`);
      expect(useLaserStore.getState().mpgActive).toBe(false);
    },
  );

  it('keeps the active MPG latch across a numbered Alarm line', () => {
    connection.emitLine('ALARM:1');

    expect(useLaserStore.getState().alarmCode).toBe(1);
    expect(useLaserStore.getState().statusReport).toBeNull();
    expect(useLaserStore.getState().mpgActive).toBe(true);
  });

  it('uses a numbered Alarm as Home recovery evidence after a prior Run report', async () => {
    useLaserStore.setState({
      mpgActive: false,
      statusReport: {
        ...useLaserStore.getState().statusReport,
        state: 'Run',
      } as NonNullable<ReturnType<typeof useLaserStore.getState>['statusReport']>,
    });
    connection.emitLine('ALARM:1');

    const homing = useLaserStore.getState().home();
    await flush();
    expect(writes).toEqual(['$H\n']);
    connection.emitLine('error:8');
    await expect(homing).rejects.toThrow();
  });

  it('releases the exact Home owner when MPG takeover invalidates pending Home', async () => {
    useLaserStore.setState({ mpgActive: false });
    const homing = useLaserStore.getState().home();
    await flush();
    expect(writes).toEqual(['$H\n']);

    connection.emitLine('<Home|MPos:0.000,0.000,0.000|FS:0,0|MPG:1>');
    connection.emitLine('ok');
    await expect(homing).rejects.toThrow(/invalidated/i);
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|MPG:0>');

    expect(writes).toEqual(['$H\n']);
    expect(useLaserStore.getState()).toMatchObject({
      controllerOperation: null,
      homingState: 'unknown',
      homingProof: null,
      mpgActive: false,
    });
  });

  it.each(['Alarm', 'Sleep'] as const)(
    'latches a first explicit MPG acquisition from a %s report',
    (state) => {
      const trustedPositionEpoch = useLaserStore.getState().trustedPositionEpoch ?? 0;
      useLaserStore.setState({ mpgActive: null });

      connection.emitLine(`<${state}|MPos:0.000,0.000,0.000|FS:0,0|MPG:1>`);

      expect(useLaserStore.getState().mpgActive).toBe(true);
      expect(useLaserStore.getState().trustedPositionEpoch).toBe(trustedPositionEpoch + 1);
    },
  );

  it('keeps exact Console and dedicated fail-off traffic available during an active takeover', async () => {
    const active = step(createStreamer('G1 X1\nG1 X2\n', { streamingMode: 'ping-pong' })).state;
    useLaserStore.setState({
      streamer: pauseStreamer(active),
      activeJobMachineKind: 'laser',
      fireActive: true,
      airAssistOn: true,
      mpgActive: true,
    });

    await useLaserStore.getState().sendConsoleCommand('M5 M9');
    connection.emitLine('ok');
    await useLaserStore.getState().setFireActive(false);
    connection.emitLine('ok');
    await useLaserStore.getState().setAirAssistEnabled(false);
    connection.emitLine('ok');
    await flush();

    expect(writes).toEqual(['M5 M9\n', 'M5\n', 'M9\n']);
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
  });

  it('retains normal active-job blocking when no MPG takeover paused refill', async () => {
    const active = step(createStreamer('G1 X1\nG1 X2\n', { streamingMode: 'ping-pong' })).state;
    useLaserStore.setState({
      streamer: active,
      activeJobMachineKind: 'laser',
      airAssistOn: true,
      mpgActive: false,
    });

    await expect(useLaserStore.getState().sendConsoleCommand('M5 M9')).rejects.toThrow(
      /job is active/i,
    );
    await expect(useLaserStore.getState().setAirAssistEnabled(false)).rejects.toThrow(
      /job is active/i,
    );

    expect(writes).toEqual([]);
    expect(useLaserStore.getState().airAssistOn).toBe(true);
  });
});

describe('Console fresh Idle ownership', () => {
  it.each([
    ['Idle', true],
    ['Run', false],
  ] as const)('queries before modal dispatch and handles fresh %s', async (state, dispatches) => {
    useLaserStore.setState({
      mpgActive: false,
      statusObservation: {
        ...useLaserStore.getState().statusObservation,
        observedAt: 0,
      } as NonNullable<ReturnType<typeof useLaserStore.getState>['statusObservation']>,
    });

    const command = useLaserStore.getState().sendConsoleCommand('G0 X3');
    await flush();
    expect(writes).toEqual(['?']);

    connection.emitLine(`<${state}|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>`);
    if (dispatches) {
      await command;
      expect(writes).toEqual(['?', 'G0 X3\n']);
    } else {
      await expect(command).rejects.toThrow(/fresh Idle report.*Run/i);
      expect(writes).toEqual(['?']);
    }
  });
});
