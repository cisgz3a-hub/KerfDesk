import { connectWith, makeConnection, flushConnect } from './laser-store-console-harness';
import { useLaserStore } from './laser-store';
import { useStore } from './store';

type SurfaceSimulatorOptions = {
  readonly inches?: boolean;
  readonly failContact?: boolean;
  readonly rotate?: boolean;
  readonly pauseFirstContact?: boolean;
  readonly contactWorkZ?: number;
  readonly failContactAt?: number;
  readonly pauseContactAt?: number;
};

export async function surfaceSimulator(options: SurfaceSimulatorOptions = {}) {
  const writes: string[] = [];
  let x = 100;
  let y = 200;
  let z = 5;
  const scale = options.inches === true ? 25.4 : 1;
  let started = false;
  let contacts = 0;
  const connection = makeConnection(async (data) => {
    if (!started) return;
    writes.push(data);
    const emit = connection.emitLine;
    if (data === '\x18') {
      emit('Grbl 1.1f');
      return;
    }
    if (data === '?') {
      emit(
        `<Idle|MPos:${x / scale},${y / scale},${z / scale}|WCO:${100 / scale},${200 / scale},${-5 / scale}|FS:0,0>`,
      );
      return;
    }
    emitCoordinateContext(data, emit, scale, options.rotate === true);
    const xy = /^G90 G1 X(-?[\d.]+) Y(-?[\d.]+)/.exec(data);
    if (xy !== null) {
      x = 100 + Number(xy[1]);
      y = 200 + Number(xy[2]);
    }
    const absoluteZ = /^G90 G1 Z(-?[\d.]+)/.exec(data);
    if (absoluteZ !== null) z = -5 + Number(absoluteZ[1]);
    if (/^G9[01] G38\.2/.test(data)) {
      contacts += 1;
      const outcome = contactOutcome(options, contacts);
      if (outcome === 'pause') return;
      if (outcome === 'fail') {
        emit('ALARM:5');
        return;
      }
      z = -5 + (options.contactWorkZ ?? (x - 100) / 100 + (y - 200) / 200);
      emit(`[PRB:${x / scale},${y / scale},${z / scale}:1]`);
    }
    if (data.endsWith('\n')) emit('ok');
  });
  await connectWith(connection);
  useStore.setState((state) => ({
    project: {
      ...state.project,
      device: { ...state.project.device, capabilities: ['z-axis'], zProbePresent: true },
    },
  }));
  useLaserStore.setState((state) => ({
    controllerSettings: { reportInches: options.inches === true },
    controllerSettingsObservation: {
      sessionEpoch: state.controllerSessionEpoch,
      observedAt: Date.now(),
    },
  }));
  started = true;
  connection.emitLine(
    `<Idle|MPos:${x / scale},${y / scale},${z / scale}|WCO:${100 / scale},${200 / scale},${-5 / scale}|FS:0,0>`,
  );
  await flushConnect();
  return { connection, writes };
}

function contactOutcome(
  options: SurfaceSimulatorOptions,
  contact: number,
): 'pause' | 'fail' | 'ok' {
  if ((options.pauseFirstContact === true && contact === 1) || options.pauseContactAt === contact)
    return 'pause';
  return options.failContact === true || options.failContactAt === contact ? 'fail' : 'ok';
}

function emitCoordinateContext(
  data: string,
  emit: (line: string) => void,
  scale: number,
  rotated: boolean,
): void {
  if (data === '$G\n') emit('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
  if (data === '$#\n')
    emit(`[G54:${100 / scale},${200 / scale},${-5 / scale}${rotated ? ':10' : ''}]`);
}
