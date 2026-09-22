import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsMapToRows } from '../../core/controllers/grbl';
import { createProject } from '../../core/scene';
import { inferCurrentMachinePosition } from './infer-machine-position';
import { useLaserStore } from './laser-store';
import {
  connectWith,
  flushConnect,
  makeConnection,
  type FakeConnection,
} from './laser-store-console.test-support';
import { useStore } from './store';

// Audit-only independent coordinate invariants. No real serial connection exists.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  useStore.setState({ project: createProject() });
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    motionOperation: null,
    controllerOperation: null,
    lastWriteError: null,
    safetyNotice: null,
  });
  vi.restoreAllMocks();
});

async function changeReportUnitsWithoutMoving(injectQueuedReports = false) {
  const writes: string[] = [];
  const connection = makeConnection(async (data) => {
    writes.push(data);
  });
  await connectWith(connection);
  useLaserStore.setState({
    controllerSettings: { reportInches: false },
    grblSettingsRows: settingsMapToRows(new Map([[13, '0']])),
    lastSettingsReadAt: Date.now(),
  });
  // Physically stationary at machine (10, 20) mm, with a (5, 10) mm origin.
  connection.emitLine('<Idle|MPos:10.000,20.000,0.000|WCO:5.000,10.000,0.000|FS:0,0>');
  writes.length = 0;
  const action = useLaserStore.getState().writeGrblSetting(13, '1');
  await flushConnect();
  expect(writes).toEqual(['$13=1\n']);
  if (injectQueuedReports) {
    // Poll generated before the setting write, received while that write owns
    // the terminal exchange. It is not a new-unit coordinate observation.
    connection.emitLine('<Idle|MPos:10.000,20.000,0.000|WCO:5.000,10.000,0.000|FS:0,0>');
    expect(useLaserStore.getState().statusReport?.mPos).toBeNull();
    expect(useLaserStore.getState().wcoCache).toBeNull();
  }
  connection.emitLine('ok');
  await flushConnect();
  expect(writes).toEqual(['$13=1\n', '$$\n']);
  if (injectQueuedReports) {
    // A post-write status before $$ completes is also unusable until the
    // reporting contract is verified. Its raw values happen to be in inches.
    connection.emitLine('<Idle|MPos:0.3937,0.7874,0.0000|WCO:0.1969,0.3937,0.0000|FS:0,0>');
    expect(useLaserStore.getState().statusReport?.mPos).toBeNull();
    expect(useLaserStore.getState().wcoCache).toBeNull();
  }
  connection.emitLine('$13=1');
  connection.emitLine('ok');
  await action;
  return { writes, connection };
}

describe('2026-09-21 independent origin/coordinate audit', () => {
  it('does not reinterpret a cached millimetre position as inches after changing $13', async () => {
    await changeReportUnitsWithoutMoving();
    const state = useLaserStore.getState();
    const position = inferCurrentMachinePosition(
      state.statusReport,
      state.wcoCache,
      state.controllerSettings?.reportInches === true,
    );
    // Accept invalidation (null) or a unit-aware preserved value. $13 changes
    // formatting, never physical position, so 254,508 mm is not a valid result.
    expect(position === null || (position.x === 10 && position.y === 20)).toBe(true);
  });

  it('never derives a large wrong-way jog from the previous unit system', async () => {
    const { writes, connection } = await changeReportUnitsWithoutMoving();
    // A normal board-point move from physical (10,20) to (20,20) needs +10mm X.
    // If a fix invalidates the old status, supply the fresh inch report it asks for.
    const move = useLaserStore
      .getState()
      .jogToMachinePosition(20, 20, 1000)
      .then(
        () => null,
        (error: unknown) => error,
      );
    await flushConnect();
    if (writes.includes('?')) {
      connection.emitLine('<Idle|MPos:0.3937,0.7874,0.0000|WCO:0.1969,0.3937,0.0000|FS:0,0>');
    }
    await move;
    expect(writes.filter((line) => line.startsWith('$J='))).not.toContain(
      '$J=G91 G21 X-234.000 Y-488.000 F1000\n',
    );
    connection.emitLine('<Idle|MPos:0.3937,0.7874,0.0000|WCO:0.1969,0.3937,0.0000|FS:0,0>');
    await useLaserStore.getState().jogToMachinePosition(20, 20, 1000);
    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      '$J=G91 G21 X10.000 Y0.000 F1000\n',
    ]);
  });

  it('discards queued reports on either side of the $13 ACK until verified settings finish', async () => {
    await changeReportUnitsWithoutMoving(true);
    const state = useLaserStore.getState();
    expect(state.reportUnitsUnconfirmed).toBe(false);
    expect(state.statusReport).toBeNull();
    expect(state.statusObservation).toBeNull();
    expect(state.wcoCache).toBeNull();
  });

  it('does not repopulate a stale WCO-only report during a unit write', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useLaserStore.setState({
      controllerSettings: { reportInches: true },
      grblSettingsRows: settingsMapToRows(new Map([[13, '1']])),
      lastSettingsReadAt: Date.now(),
    });
    connection.emitLine('<Idle|MPos:1.0000,2.0000,0.0000|WCO:0.5000,1.0000,0.0000|FS:0,0>');
    const action = useLaserStore.getState().writeGrblSetting(13, '0');
    await flushConnect();
    connection.emitLine('ok');
    await flushConnect();
    connection.emitLine('<Idle|WCO:0.5000,1.0000,0.0000|FS:0,0>');
    expect(useLaserStore.getState().wcoCache).toBeNull();
    connection.emitLine('$13=0');
    connection.emitLine('ok');
    await action;
    expect(useLaserStore.getState().statusReport).toBeNull();
    expect(useLaserStore.getState().wcoCache).toBeNull();
    connection.emitLine('<Idle|MPos:25.400,50.800,0.000|WCO:12.700,25.400,0.000|FS:0,0>');
    const state = useLaserStore.getState();
    expect(inferCurrentMachinePosition(state.statusReport, state.wcoCache, false)).toEqual({
      x: 25.4,
      y: 50.8,
      z: 0,
    });
  });

  it.each(['$13=1', '$013=1'])(
    'recovers confirmed console %s through a terminal settings read',
    async (command) => {
      const connection = makeConnection(async () => undefined);
      await connectWith(connection);
      useLaserStore.setState({ controllerSettings: { reportInches: false } });
      connection.emitLine('<Idle|MPos:10.000,20.000,0.000|WCO:5.000,10.000,0.000|FS:0,0>');
      await useLaserStore.getState().sendConsoleCommand(command, { confirmed: true });
      connection.emitLine('ok');
      connection.emitLine('<Idle|MPos:0.3937,0.7874,0.0000|WCO:0.1969,0.3937,0.0000|FS:0,0>');
      expect(useLaserStore.getState().reportUnitsUnconfirmed).toBe(true);
      expect(useLaserStore.getState().statusReport?.mPos).toBeNull();
      const read = useLaserStore.getState().sendConsoleCommand('$$');
      await flushConnect();
      connection.emitLine('$13=1');
      connection.emitLine('ok');
      await read;
      expect(useLaserStore.getState().reportUnitsUnconfirmed).toBe(false);
      expect(useLaserStore.getState().statusReport).toBeNull();
      connection.emitLine('<Idle|MPos:0.3937,0.7874,0.0000|WCO:0.1969,0.3937,0.0000|FS:0,0>');
      expect(useLaserStore.getState().statusReport?.mPos?.x).toBe(0.3937);
    },
  );

  it.each([
    { beforeInches: false, afterInches: true, viaConsole: false },
    { beforeInches: true, afterInches: false, viaConsole: false },
    { beforeInches: true, afterInches: false, viaConsole: true },
    { beforeInches: true, afterInches: true, viaConsole: false },
    { beforeInches: true, afterInches: true, viaConsole: true },
  ])(
    'refresh handles unit contract $beforeInches -> $afterInches, console $viaConsole',
    async ({ beforeInches, afterInches, viaConsole }) => {
      const connection: FakeConnection = makeConnection(async (data) => {
        if (useLaserStore.getState().controllerOperation?.kind !== 'interactive-command') return;
        if (data === '$I\n') {
          connection.emitLine('[VER:1.1h.20190830:test]');
          connection.emitLine('[OPT:VM,15,128]');
          connection.emitLine('ok');
        }
        if (data === '$G\n') {
          connection.emitLine('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
          connection.emitLine('ok');
        }
      });
      await connectWith(connection);
      useLaserStore.setState({ controllerSettings: { reportInches: beforeInches } });
      connection.emitLine('<Idle|MPos:10.000,20.000,0.000|WCO:5.000,10.000,0.000|FS:0,0>');
      const prior = useLaserStore.getState();
      useLaserStore.setState({
        frameVerification: {
          boundsSignature: 'audit-proof',
          wco: { x: 5, y: 10, z: 0 },
          workOriginActive: true,
        },
      });
      const action = viaConsole
        ? useLaserStore.getState().sendConsoleCommand('$$')
        : useLaserStore.getState().readMachineSettings();
      await flushConnect();
      expect(useLaserStore.getState().controllerSettings?.reportInches).toBe(beforeInches);
      connection.emitLine(`$13=${afterInches ? '1' : '0'}`);
      connection.emitLine('ok');
      await action;
      const state = useLaserStore.getState();
      expect(state.controllerSettings?.reportInches).toBe(afterInches);
      if (beforeInches === afterInches) {
        expect(state.statusReport).toBe(prior.statusReport);
        expect(state.statusObservation).toBe(prior.statusObservation);
        expect(state.wcoCache).toEqual(prior.wcoCache);
        expect(state.frameVerification?.boundsSignature).toBe('audit-proof');
      } else {
        expect(state.statusReport).toBeNull();
        expect(state.statusObservation).toBeNull();
        expect(state.wcoCache).toBeNull();
        expect(state.frameVerification).toBeNull();
      }
    },
  );

  it('keeps coordinates unavailable after a rejected unit write until a settings read recovers', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    useLaserStore.setState({
      controllerSettings: { reportInches: false },
      grblSettingsRows: settingsMapToRows(new Map([[13, '0']])),
      lastSettingsReadAt: Date.now(),
    });
    connection.emitLine('<Idle|MPos:10.000,20.000,0.000|WCO:5.000,10.000,0.000|FS:0,0>');
    const action = useLaserStore.getState().writeGrblSetting(13, '1');
    const rejection = expect(action).rejects.toThrow(/error:3/);
    await flushConnect();
    connection.emitLine('error:3');
    await rejection;
    connection.emitLine('<Idle|MPos:10.000,20.000,0.000|WCO:5.000,10.000,0.000|FS:0,0>');
    expect(useLaserStore.getState().statusReport?.mPos).toBeNull();
    expect(useLaserStore.getState().wcoCache).toBeNull();
    const read = useLaserStore.getState().sendConsoleCommand('$$');
    await flushConnect();
    connection.emitLine('$13=0');
    connection.emitLine('ok');
    await read;
    expect(useLaserStore.getState().reportUnitsUnconfirmed).toBe(false);
    expect(useLaserStore.getState().statusReport).toBeNull();
    connection.emitLine('<Idle|MPos:10.000,20.000,0.000|WCO:5.000,10.000,0.000|FS:0,0>');
    expect(useLaserStore.getState().statusReport?.mPos).toEqual({ x: 10, y: 20, z: 0 });
  });
});
