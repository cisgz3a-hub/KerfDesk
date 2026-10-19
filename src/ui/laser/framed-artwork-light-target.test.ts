import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFramedRunPermit, framedRunControllerSnapshot } from '../state/framed-run';
import type { FramedRunCandidate } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { centreLightAfterFrameWanted, centreLightOnFramedArtwork } from './centre-selection-light';
import { useJogControlPreferences } from './jog-control-preferences';

const originalLaser = useLaserStore.getState();
const originalPreferences = useJogControlPreferences.getState();
const move = vi.fn(async () => undefined);

beforeEach(() => {
  resetStore();
  move.mockClear();
  useStore.setState((app) => ({
    project: {
      ...app.project,
      machine: { kind: 'laser' },
      device: {
        ...app.project.device,
        origin: 'front-right',
        bedWidth: 400,
        bedHeight: 300,
        positioningLight: {
          onCommand: 'M64 P0',
          offCommand: 'M65 P0',
          offsetXmm: 7,
          offsetYmm: -4,
          afterFrame: true,
        },
      },
    },
    selectedObjectId: null,
    jobPlacement: { startFrom: 'absolute', anchor: 'front-left' },
  }));
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    wcoCache: { x: 100, y: -20, z: 0 },
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 150, y: 30, z: 0 },
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
    },
    centrePositioningLight: move,
  });
  useJogControlPreferences.setState({ requestedFeedMmPerMin: 1200 });
  const laser = useLaserStore.getState();
  const candidate = {
    preparedStart: {
      // Deliberately asymmetric motion runway: use the artwork bounds, not its middle.
      metrics: {
        frameJobBounds: { minX: 20, maxX: 60, minY: 30, maxY: 50 },
        frameMotionBounds: { minX: 0, maxX: 70, minY: 20, maxY: 50 },
      },
    },
    controllerBeforeFrame: framedRunControllerSnapshot(laser),
  } as unknown as FramedRunCandidate;
  const frame = createFramedRunPermit(candidate, laser);
  useLaserStore.setState({ framedRun: frame, completedFrame: frame });
});

afterEach(() => {
  vi.useRealTimers();
  useLaserStore.setState(originalLaser, true);
  useJogControlPreferences.setState(originalPreferences, true);
  resetStore();
});

describe('placed artwork centre after Frame', () => {
  it.each(['absolute', 'user-origin', 'verified-origin', 'current-position'] as const)(
    'uses the completed artwork bounds and pointer offset in %s',
    async (startFrom) => {
      useStore.setState({ jobPlacement: { startFrom, anchor: 'front-left' } });
      expect(centreLightAfterFrameWanted()).toBe(true);
      await centreLightOnFramedArtwork();
      // Native artwork centre = work (40,40) + WCO (100,-20) = (140,20).
      // Both bed axes reverse: subtracting pointer (+7,-4) moves native head (+7,-4).
      expect(move).toHaveBeenCalledExactlyOnceWith(147, 16, 1200, expect.any(Function));
    },
  );

  it.each([
    ['front-left', 33, 36],
    ['front-right', 47, 36],
    ['rear-left', 33, 44],
    ['rear-right', 47, 44],
    ['center', 33, 36],
  ] as const)('centres Verified Origin with an unreported offset at %s', async (origin, x, y) => {
    useStore.setState((app) => ({
      project: { ...app.project, device: { ...app.project.device, origin } },
      jobPlacement: { startFrom: 'verified-origin', anchor: 'front-left' },
    }));
    const candidate = useLaserStore.getState().framedRun!.candidate;
    useLaserStore.setState((laser) => ({
      wcoCache: null,
      workOriginActive: true,
      workOriginSource: 'unknown',
      statusReport: { ...laser.statusReport!, mPos: null, wPos: { x: 75, y: 45, z: 0 } },
    }));
    const frame = createFramedRunPermit(
      {
        ...candidate,
        preparedStart: {
          ...candidate.preparedStart,
          prepared: { ...candidate.preparedStart.prepared, project: useStore.getState().project },
          jobOrigin: { startFrom: 'verified-origin', anchor: 'front-left' },
        },
      },
      useLaserStore.getState(),
    );
    useLaserStore.setState({ framedRun: frame, completedFrame: frame });
    expect(centreLightAfterFrameWanted()).toBe(true);
    await centreLightOnFramedArtwork();
    expect(move).toHaveBeenCalledExactlyOnceWith(x, y, 1200, expect.any(Function), 'work');
  });

  it.each(
    (['absolute', 'current-position'] as const).flatMap((mode) =>
      (['machine', 'work'] as const).flatMap((report) =>
        (
          [
            ['front-left', 33, 36],
            ['front-right', 47, 36],
            ['rear-left', 33, 44],
            ['rear-right', 47, 44],
            ['center', 33, 36],
          ] as const
        ).map(([origin, x, y]) => ({ mode, report, origin, x, y })),
      ),
    ),
  )(
    'retains captured assumed-zero $mode with $report reports at $origin',
    async ({ mode, report, origin, x, y }) => {
      useStore.setState((app) => ({
        project: { ...app.project, device: { ...app.project.device, origin } },
        jobPlacement: { startFrom: mode, anchor: 'front-left' },
      }));
      const candidate = useLaserStore.getState().framedRun!.candidate;
      useLaserStore.setState((laser) => ({
        wcoCache: null,
        workOriginActive: false,
        workOriginSource: 'none',
        statusReport: {
          ...laser.statusReport!,
          mPos: report === 'machine' ? { x: 75, y: 45, z: 0 } : null,
          wPos: report === 'work' ? { x: 75, y: 45, z: 0 } : null,
        },
      }));
      const frame = createFramedRunPermit(
        {
          ...candidate,
          preparedStart: {
            ...candidate.preparedStart,
            prepared: { ...candidate.preparedStart.prepared, project: useStore.getState().project },
            ...(mode === 'current-position'
              ? {
                  jobOrigin: {
                    startFrom: mode,
                    anchor: 'front-left',
                    currentPosition: { x: 75, y: 45 },
                  },
                }
              : {}),
          },
        },
        useLaserStore.getState(),
      );
      useLaserStore.setState({ framedRun: frame, completedFrame: frame });
      await centreLightOnFramedArtwork();
      expect(move).toHaveBeenCalledExactlyOnceWith(x, y, 1200, expect.any(Function), report);
      expect(useLaserStore.getState().wcoCache).toBeNull();
    },
  );
  it('keeps explicit automatic-centre opt-out', () => {
    useStore.setState((app) => ({
      project: {
        ...app.project,
        device: {
          ...app.project.device,
          positioningLight: { ...app.project.device.positioningLight!, afterFrame: false },
        },
      },
    }));
    expect(centreLightAfterFrameWanted()).toBe(false);
  });

  it('does not use stale Frame coordinates after a work-offset change', async () => {
    useLaserStore.setState({ wcoCache: { x: 200, y: -20, z: 0 } });
    await expect(centreLightOnFramedArtwork()).rejects.toThrow(/origin|Frame/);
    expect(move).not.toHaveBeenCalled();
  });

  it('does not guess a physical location without the controller work offset', async () => {
    useLaserStore.setState({ wcoCache: null });
    await expect(centreLightOnFramedArtwork()).rejects.toThrow();
    expect(move).not.toHaveBeenCalled();
  });

  it('does not move on a replacement controller session', async () => {
    useLaserStore.setState((laser) => ({
      controllerSessionEpoch: laser.controllerSessionEpoch + 1,
    }));
    await expect(centreLightOnFramedArtwork()).rejects.toThrow(/session/);
    expect(move).not.toHaveBeenCalled();
  });

  it('does not move without a completed Frame', async () => {
    useLaserStore.setState({ framedRun: null, completedFrame: null });
    await expect(centreLightOnFramedArtwork()).rejects.toThrow(/Frame/);
    expect(move).not.toHaveBeenCalled();
  });

  it('waits for the final Frame acknowledgement before issuing the LED move', async () => {
    vi.useFakeTimers();
    useLaserStore.setState({ pendingUntrackedAcks: 1 });
    const pending = centreLightOnFramedArtwork();
    await vi.advanceTimersByTimeAsync(100);
    expect(move).not.toHaveBeenCalled();
    useLaserStore.setState({ pendingUntrackedAcks: 0 });
    await vi.advanceTimersByTimeAsync(25);
    await pending;
    expect(move).toHaveBeenCalledExactlyOnceWith(147, 16, 1200, expect.any(Function));
  });

  it('never adopts a replacement Frame while waiting for its final reply', async () => {
    vi.useFakeTimers();
    useLaserStore.setState({ pendingUntrackedAcks: 1 });
    const pending = centreLightOnFramedArtwork();
    const rejected = expect(pending).rejects.toThrow(/changed/);
    useLaserStore.setState((laser) => ({
      pendingUntrackedAcks: 0,
      framedRun: { ...laser.framedRun! },
    }));
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(move).not.toHaveBeenCalled();
  });

  it('leaves the LED off when the final reply never arrives', async () => {
    vi.useFakeTimers();
    useLaserStore.setState({ pendingUntrackedAcks: 1 });
    const pending = centreLightOnFramedArtwork();
    const rejected = expect(pending).rejects.toThrow(/reply is still missing/);
    await vi.advanceTimersByTimeAsync(1600);
    await rejected;
    expect(move).not.toHaveBeenCalled();
  });
});
