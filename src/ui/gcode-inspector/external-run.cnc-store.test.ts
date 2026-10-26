// External CNC pauses belong to the controller, not the project's bit-change
// workflow. Exercise the real Start/store boundary and its received bytes.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { connectWith, makeConnection } from '../state/laser-store-motion-operation.test-support';
import { resetStore } from '../state/test-helpers';
import { startExternalProgram } from './external-run';

beforeEach(() => {
  resetStore();
  useStore.setState({ project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG } });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
  resetStore();
});

it.each(['M0', 'M1'])(
  'streams an external CNC %s exactly without entering a project tool change',
  async (pause) => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
      if (data === 'G4 P0.01\n') setTimeout(() => connection.emitLine('ok'), 0);
      if (data === '?') {
        setTimeout(() => connection.emitLine('<Idle|MPos:0,0,0|FS:0,0|Ov:100,100,100>'), 0);
      }
    });
    await connectWith(connection);
    const gcode = `G21 G90\nG1 X1 F600\n${pause}\nG1 X2\nM5\n`;
    const verification = { boundsSignature: 'external:cnc', wco: null, workOriginActive: false };
    useLaserStore.setState({ frameVerification: verification });
    const frame = {
      run: {
        name: 'external.nc',
        gcode,
        envelope: { minX: 0, minY: 0, maxX: 2, maxY: 0 },
        start: { x: 0, y: 0, z: 0 },
      },
      machineKind: 'cnc' as const,
      verification,
      controller: useLaserStore.getState(),
    };
    writes.length = 0;
    await expect(startExternalProgram(frame)).resolves.toBe(true);
    expect(writes.join('')).toContain(gcode);
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
    expect(useLaserStore.getState().streamer?.toolChangePause).toBe(false);
    expect(useLaserStore.getState().pendingToolLabel).toBeNull();
  },
);
