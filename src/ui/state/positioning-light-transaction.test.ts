import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectControllerDriver } from '../../core/controllers';
import { parseStatusReport } from '../../core/controllers/grbl';
import type { ControllerKind } from '../../core/devices/device-profile';
import { positioningLightActions } from './positioning-light-actions';
import {
  positioningLightStatus,
  type PositioningLightTransaction,
} from './positioning-light-transaction';
import {
  cancelFreshControllerStatusWait,
  observeFreshControllerStatus,
  waitForFreshControllerStatus,
} from './laser-controller-status-wait';
import { consumeControllerCommandResponse } from './laser-interactive-command';
import { initialLaserState } from './laser-store-helpers';
import { useLaserStore, type LaserState, type LiveRefs } from './laser-store';
import type { SafeWrite } from './laser-safe-write';
import { useStore } from './store';

const originalProject = useStore.getState().project;
afterEach(() => useStore.setState({ project: originalProject }));

function fixture(kind: ControllerKind) {
  const driver = selectControllerDriver(kind);
  const report = parseStatusReport('<Idle|MPos:0,0,0|WCO:0,0,0>')!;
  let state: LaserState = {
    ...useLaserStore.getState(),
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: report,
    controllerSessionEpoch: 3,
    statusSequence: 5,
  };
  const refs = {
    driver,
    connection: {},
    writeEpoch: 1,
    controllerCommand: null,
    controllerIdleWait: null,
    controllerStatusWait: null,
  } as unknown as LiveRefs;
  const set = vi.fn(
    (patch: Partial<LaserState> | ((current: LaserState) => Partial<LaserState>)) => {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
    },
  );
  const fresh = () => {
    state = { ...state, statusSequence: state.statusSequence + 1 };
    observeFreshControllerStatus(
      refs,
      { sessionEpoch: state.controllerSessionEpoch, sequence: state.statusSequence },
      report,
    );
  };
  const context = (write: SafeWrite): PositioningLightTransaction => ({
    refs,
    get: () => state,
    write,
    assertCurrent: () => undefined,
  });
  const incumbent = () => {
    const result = waitForFreshControllerStatus(refs, {
      after: { sessionEpoch: state.controllerSessionEpoch, sequence: state.statusSequence },
      accept: () => true,
      timeoutMs: 1_000,
      timeoutMessage: 'Incumbent status timed out.',
    }).then(
      (value) => ({ report: value }),
      (error: unknown) => ({ error }),
    );
    return { result, owner: refs.controllerStatusWait };
  };
  return { refs, report, set, get: () => state, fresh, context, incumbent };
}

const families = ['grbl-v1.1', 'marlin'] as const;
describe('positioning light fresh-status ownership', () => {
  it.each(families)('leaves an incumbent status wait untouched on %s', async (kind) => {
    const h = fixture(kind);
    const incumbent = h.incumbent();
    const write = vi.fn<SafeWrite>(async () => undefined);
    try {
      await expect(positioningLightStatus(h.context(write))).rejects.toThrow(/already active/);
      expect(h.refs.controllerStatusWait).toBe(incumbent.owner);
      expect(write).not.toHaveBeenCalled();
      h.fresh();
      await expect(incumbent.result).resolves.toEqual({ report: h.report });
    } finally {
      cancelFreshControllerStatusWait(h.refs);
    }
  });

  it.each(['centre', 'off'] as const)(
    'refuses %s before claiming an operation while a readiness wait is pending',
    async (action) => {
      const h = fixture('grbl-v1.1');
      useStore.setState({
        project: {
          ...originalProject,
          machine: { kind: 'laser' },
          device: {
            ...originalProject.device,
            controllerKind: 'grbl-v1.1',
            positioningLight: {
              onCommand: 'M64 P0',
              offCommand: 'M65 P0',
              offsetXmm: 0,
              offsetYmm: 0,
            },
          },
        },
      });
      const incumbent = h.incumbent();
      const write = vi.fn<SafeWrite>(async () => undefined);
      const actions = positioningLightActions(h.set, h.get, h.refs, write);
      try {
        await expect(
          action === 'centre'
            ? actions.centrePositioningLight(10, 15, 1000)
            : actions.setPositioningLightEnabled(false),
        ).rejects.toThrow(/current controller command/);
        expect(h.refs.controllerStatusWait).toBe(incumbent.owner);
        expect(write).not.toHaveBeenCalled();
        expect(h.set).not.toHaveBeenCalled();
        expect(h.get().controllerOperation).toBeNull();
        h.fresh();
        await expect(incumbent.result).resolves.toEqual({ report: h.report });
      } finally {
        cancelFreshControllerStatusWait(h.refs);
      }
    },
  );

  it.each(families)('registers its own wait before a synchronous %s response', async (kind) => {
    const h = fixture(kind);
    const write = vi.fn<SafeWrite>(async () => {
      expect(h.refs.controllerStatusWait).not.toBeNull();
      h.fresh();
      if (kind === 'marlin') consumeControllerCommandResponse(h.refs, { kind: 'ok' }, 'ok');
    });
    await expect(positioningLightStatus(h.context(write))).resolves.toBe(h.report);
    expect(write).toHaveBeenCalledOnce();
    expect(h.refs.controllerStatusWait).toBeNull();
    expect(h.refs.controllerCommand).toBeNull();
  });
});
