import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseStatusReport } from '../../core/controllers/grbl/status-parser';
import { createProject } from '../../core/scene';
import * as frameAction from '../laser/use-frame-action';
import { useStore } from '../state';
import type { FrameVerification } from '../state/frame-verification';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import {
  EXTERNAL_FRAME_CHANGED,
  EXTERNAL_FRAME_FIRST,
  EXTERNAL_HEAD_MOVED,
  EXTERNAL_MODE_CHANGED,
  externalStartIssue,
  frameExternalProgram,
  startExternalProgram,
  waitForExternalFrame,
  type ExternalFrame,
} from './external-run';

const RUN = {
  name: 'part.nc',
  gcode: 'G21 G90\nG0 X0 Y0\nM4 S500\nG1 X10 F600\nM5\n',
  envelope: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
  start: { x: 0, y: 0, z: 0 },
};

function idleAt(x: number): void {
  const report = parseStatusReport(`<Idle|MPos:${x.toFixed(3)},0.000,0.000|FS:0,0>`);
  useLaserStore.setState({ connection: { kind: 'connected' }, statusReport: report });
}

function framed(): ExternalFrame {
  const verification: FrameVerification = {
    boundsSignature: 'external-program:test',
    wco: null,
    workOriginActive: false,
  };
  useLaserStore.setState({ frameVerification: verification });
  return {
    run: RUN,
    machineKind: 'laser',
    verification,
    controller: useLaserStore.getState(),
  };
}

beforeEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  useStore.setState({ project: createProject() });
  idleAt(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  useLaserStore.setState(initialLaserState());
  resetStore();
});

describe('external run Start checks (ADR-630)', () => {
  it('needs this program’s own clean Frame', () => {
    expect(externalStartIssue(null)).toBe(EXTERNAL_FRAME_FIRST);
    const frame = framed();
    expect(externalStartIssue(frame)).toBeNull();
    useLaserStore.setState({
      frameVerification: { boundsSignature: 'other', wco: null, workOriginActive: false },
    });
    expect(externalStartIssue(frame)).toBe(EXTERNAL_FRAME_FIRST);
  });

  it('expires when the head moves or the machine mode changes', () => {
    const frame = framed();
    idleAt(5);
    expect(externalStartIssue(frame)).toBe(EXTERNAL_FRAME_CHANGED);
    idleAt(0);
    expect(externalStartIssue(frame)).toBeNull();
    const project = useStore.getState().project;
    useStore.setState({
      project: { ...project, machine: { kind: 'cnc', params: { safeZMm: 5 } } as never },
    });
    expect(externalStartIssue(frame)).toBe(EXTERNAL_MODE_CHANGED);
  });

  it('refuses when the head is not where the program was read from', () => {
    // A Frame that ended away from the program's start: the session and
    // position still match the record, but the program starts elsewhere.
    idleAt(5);
    expect(externalStartIssue(framed())).toBe(EXTERNAL_HEAD_MOVED);
  });

  it('will not Frame from a spot other than the one the program was read from', async () => {
    vi.spyOn(frameAction, 'prepareTransientFrameController').mockResolvedValue({
      laser: useLaserStore.getState(),
    } as never);
    const frame = vi.fn(async () => undefined);
    useLaserStore.setState({ frame });
    idleAt(5);
    await expect(frameExternalProgram(RUN)).rejects.toThrow(EXTERNAL_HEAD_MOVED);
    expect(frame).not.toHaveBeenCalled();
  });

  it('rejects a program interpreted for a different connected controller at Frame and Start', async () => {
    vi.spyOn(frameAction, 'prepareTransientFrameController').mockResolvedValue({
      laser: useLaserStore.getState(),
    } as never);
    const run = { ...RUN, controllerKind: 'marlin' as const };
    const frame = vi.fn(async () => undefined);
    useLaserStore.setState({ frame });
    await expect(frameExternalProgram(run)).rejects.toThrow(EXTERNAL_FRAME_CHANGED);
    expect(frame).not.toHaveBeenCalled();
    expect(externalStartIssue({ ...framed(), run })).toBe(EXTERNAL_FRAME_CHANGED);
  });

  // A CNC Frame begun below work Z0 leaves the bit at safe Z rather than
  // plunging back into the stock (ADR-192). Comparing Z with where the program
  // was read from kept Start locked for good.
  it('starts a CNC program from the height its Frame left the bit at', async () => {
    const project = useStore.getState().project;
    useStore.setState({
      project: { ...project, machine: { kind: 'cnc', params: { safeZMm: 5 } } as never },
    });
    const at = (z: number) => parseStatusReport(`<Idle|MPos:0.000,0.000,${z.toFixed(3)}|FS:0,0>`);
    useLaserStore.setState({ connection: { kind: 'connected' }, statusReport: at(-1) });
    const frame = vi.fn(async (...args: ReadonlyArray<unknown>): Promise<void> => {
      const external = args[5] as { verification: FrameVerification };
      useLaserStore.setState({ motionOperation: { kind: 'frame' } as never });
      useLaserStore.setState({
        motionOperation: null,
        statusReport: at(5),
        frameVerification: external.verification,
      });
    });
    useLaserStore.setState({ frame });
    vi.spyOn(frameAction, 'prepareTransientFrameController').mockResolvedValue({
      laser: useLaserStore.getState(),
    } as never);
    const run = { ...RUN, start: { x: 0, y: 0, z: -1 } };
    const framed = await frameExternalProgram(run);
    expect(framed?.run.start).toEqual({ x: 0, y: 0, z: 5 });
    expect(framed?.run.gcode).toBe(RUN.gcode);
    expect(externalStartIssue(framed)).toBeNull();
  });

  it('streams exactly the framed program once, as a laser job', async () => {
    // Without a $32 reading the laser-mode acknowledgement asks first.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });
    const frame = framed();
    await expect(startExternalProgram(frame)).resolves.toBe(true);
    expect(startJob).toHaveBeenCalledTimes(1);
    const [gcode, options] = startJob.mock.calls[0] as unknown as [
      string,
      { machineKind: string; assertFinalStartAuthorized: () => void },
    ];
    expect(gcode).toBe(RUN.gcode);
    expect(options.machineKind).toBe('laser');
    expect(() => options.assertFinalStartAuthorized()).not.toThrow();
    idleAt(3);
    expect(() => options.assertFinalStartAuthorized()).toThrow(EXTERNAL_FRAME_CHANGED);
    idleAt(0);
    // The Laser/CNC switch stays usable while Start arms.
    const project = useStore.getState().project;
    useStore.setState({
      project: { ...project, machine: { kind: 'cnc', params: { safeZMm: 5 } } as never },
    });
    expect(() => options.assertFinalStartAuthorized()).toThrow(EXTERNAL_MODE_CHANGED);
    expect(options).toHaveProperty('laserModeStartEvidence');
    confirm.mockRestore();
  });

  it('sends nothing when the operator declines the laser-mode question', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });
    await expect(startExternalProgram(framed())).resolves.toBe(false);
    expect(startJob).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('refuses to start without a current Frame and sends nothing', async () => {
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });
    const frame = framed();
    idleAt(1);
    await expect(startExternalProgram(frame)).rejects.toThrow(EXTERNAL_FRAME_CHANGED);
    expect(startJob).not.toHaveBeenCalled();
  });
});

describe('waiting for an external Frame (ADR-630)', () => {
  const verification: FrameVerification = {
    boundsSignature: 'external-program:wait',
    wco: null,
    workOriginActive: false,
  };

  it('resolves with the controller state that recorded the Frame', async () => {
    const wait = waitForExternalFrame(verification);
    useLaserStore.setState({ motionOperation: { kind: 'frame' } as never });
    useLaserStore.setState({ motionOperation: null, frameVerification: verification });
    await expect(wait.promise).resolves.toMatchObject({ frameVerification: verification });
  });

  it('resolves null when the Frame motion ends without the record', async () => {
    const wait = waitForExternalFrame(verification);
    useLaserStore.setState({ motionOperation: { kind: 'frame' } as never });
    useLaserStore.setState({ motionOperation: null });
    await expect(wait.promise).resolves.toBeNull();
  });
});
