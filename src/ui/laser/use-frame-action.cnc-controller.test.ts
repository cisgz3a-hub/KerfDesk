// CN-2 (2026-09-25 controller audit): a CNC Frame on a controller that cannot
// run KerfDesk CNC jobs (Marlin, Smoothieware) is refused with that reason
// first. Before, the operator was sent to set Work Z zero (and `G92 Z0` was
// written) for a Frame that could never be built, and then told the retract
// was missing. Same refusal, earlier and in the right words; no new gate.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers/grbl/driver';
import { marlinDriver } from '../../core/controllers/marlin/driver';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
} from '../../core/scene';
import { useStore } from '../state';
import {
  CNC_FRAME_REQUIRES_GRBL_MESSAGE,
  CNC_FRAME_WORK_Z_REQUIRED_MESSAGE,
} from '../state/cnc-frame-lines';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { idleControllerStatusForFrameTest } from './framed-run-testing';
import { useStartBlockerStore } from './start-blocker-store';
import { runFrameNow } from './use-frame-action';

const dialogs = vi.hoisted(() => ({ confirm: vi.fn((_message: string) => false) }));

vi.mock('../state/job-aware-dialogs', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, jobAwareConfirm: dialogs.confirm };
});

const original = useLaserStore.getState();

function installCncProject(): void {
  const base = createProject();
  useStore.setState({
    project: {
      ...base,
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: {
        ...EMPTY_SCENE,
        layers: [
          { ...createLayer({ id: 'L1', color: '#ff0000' }), cnc: DEFAULT_CNC_LAYER_SETTINGS },
        ],
        objects: [
          {
            kind: 'imported-svg',
            id: 'O1',
            source: 'cn-frame.svg',
            bounds: { minX: 10, minY: 10, maxX: 60, maxY: 60 },
            transform: IDENTITY_TRANSFORM,
            paths: [
              {
                color: '#ff0000',
                polylines: [
                  {
                    closed: true,
                    points: [
                      { x: 10, y: 10 },
                      { x: 60, y: 10 },
                      { x: 60, y: 60 },
                      { x: 10, y: 60 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    jobPlacement: { startFrom: 'absolute', anchor: 'front-left' },
  });
}

beforeEach(() => {
  installCncProject();
  dialogs.confirm.mockClear();
  useToastStore.setState({ toasts: [] });
  useStartBlockerStore.getState().clear();
  useLaserStore.setState({
    streamer: null,
    statusReport: idleControllerStatusForFrameTest(),
    motionOperation: null,
    controllerOperation: null,
    // A named WCS other than G54, so Frame preparation would normalize it.
    activeWcs: 'G55',
    workZZeroEvidence: null,
    framedRun: null,
    frameVerification: null,
  });
});

afterEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState({
    capabilities: original.capabilities,
    selectPrimaryWcsForFrame: original.selectPrimaryWcsForFrame,
    zeroZHere: original.zeroZHere,
    frame: original.frame,
    activeWcs: original.activeWcs,
    statusReport: null,
    framedRun: null,
  });
  vi.restoreAllMocks();
});

function spyOnControllerActions() {
  const selectPrimaryWcsForFrame = vi.fn(async () => undefined);
  const zeroZHere = vi.fn(async () => undefined);
  const frame = vi.fn(async () => undefined);
  useLaserStore.setState({ selectPrimaryWcsForFrame, zeroZHere, frame });
  return { selectPrimaryWcsForFrame, zeroZHere, frame };
}

describe('CNC Frame on a controller that cannot run KerfDesk CNC jobs (CN-2)', () => {
  it('refuses with the GRBL-family reason before WCS normalization or the Zero-Z prompt', async () => {
    useLaserStore.setState({ capabilities: marlinDriver.capabilities });
    const actions = spyOnControllerActions();

    await expect(runFrameNow()).resolves.toBe(false);

    const errors = useToastStore.getState().toasts.filter((toast) => toast.variant === 'error');
    expect(errors.map((toast) => toast.message)).toEqual([CNC_FRAME_REQUIRES_GRBL_MESSAGE]);
    expect(dialogs.confirm).not.toHaveBeenCalled();
    expect(actions.selectPrimaryWcsForFrame).not.toHaveBeenCalled();
    expect(actions.zeroZHere).not.toHaveBeenCalled();
    expect(actions.frame).not.toHaveBeenCalled();
  });

  it('still asks a GRBL-family controller for work Z before a CNC Frame', async () => {
    useLaserStore.setState({ capabilities: grblDriver.capabilities, activeWcs: 'G54' });
    const actions = spyOnControllerActions();

    await expect(runFrameNow()).resolves.toBe(false);

    expect(dialogs.confirm).toHaveBeenCalledTimes(1);
    expect(dialogs.confirm.mock.calls[0]?.[0]).toContain(CNC_FRAME_WORK_Z_REQUIRED_MESSAGE);
    expect(actions.zeroZHere).not.toHaveBeenCalled();
  });
});
