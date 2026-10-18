import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import type { Origin } from '../../core/devices';
import type { JobStartMode } from '../../core/job';
import { createRegistrationLayer } from '../../core/scene';
import { createRegistrationBox } from '../../core/shapes';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { framedRunStartHandoffIssue } from '../state/framed-run';
import { inferCurrentMachinePosition } from '../state/infer-machine-position';
import { disconnectOnTestClock } from '../state/laser-disconnect-testing';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { nativeBedCaptureFrameKey, resolveNativeBedFrame } from '../state/native-bed-frame';
import { stockNativeEvidence } from '../state/native-bed-frame.test-support';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { centreSelectionLight } from './centre-selection-light';
import { prepareFramedStartReview } from './framed-start-preparation';
import {
  connectedFixture,
  expectProgramSentOnce,
  startReviewedFrameOnClock,
} from './frame-artwork-centre-led.test-support';
import type * as OutputPreparationWorker from './output-preparation-worker-client';
import { centreLightAfterCleanFrame, runFrameNow } from './use-frame-action';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));
vi.mock('./output-preparation-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof OutputPreparationWorker>()),
  prepareStartOutputOffThread: async (
    request: Parameters<typeof prepareOutputRequestForTest>[0],
  ) => {
    const response = await prepareOutputRequestForTest(request);
    if (response.kind !== 'start') throw new Error('Expected start preparation');
    return response.result;
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetStore();
  useLaserStore.setState(initialLaserState());
  useToastStore.setState({ toasts: [] });
  usePrintCutSessionStore.getState().clear();
  useExperimentalLaserFeatures.getState().resetFeatures();
});
afterEach(async () => {
  await disconnectOnTestClock();
  resetStore();
  usePrintCutSessionStore.getState().clear();
  useExperimentalLaserFeatures.getState().resetFeatures();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function frame() {
  const pending = runFrameNow();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await pending, JSON.stringify(useToastStore.getState().toasts)).toBe(true);
  const permit = useLaserStore.getState().framedRun;
  expect(permit).not.toBeNull();
  return permit!;
}

async function centre(ids: ReadonlyArray<string>) {
  const pending = centreSelectionLight(ids);
  await vi.advanceTimersByTimeAsync(5_000);
  await pending;
}

function nativeHead() {
  const laser = useLaserStore.getState();
  return inferCurrentMachinePosition(laser.statusReport, laser.wcoCache);
}

const modes = ['absolute', 'user-origin', 'verified-origin', 'current-position'] as const;
const origins = ['front-left', 'front-right', 'rear-left', 'rear-right', 'center'] as const;

// Independent physical arithmetic for the fixture's chosen 20x10 artwork.
// It is centred at scene (40,45), 10 right and 25 back from the whole job's
// physical front-left anchor; WCO is (100,50), captured work origin (75,45).
function expectedHead(mode: JobStartMode, origin: Origin, width: number, height: number) {
  const sx = origin.endsWith('right') ? -1 : 1;
  const sy = origin.startsWith('rear') ? 1 : -1;
  const x =
    mode === 'absolute'
      ? origin === 'center'
        ? 40 - width / 2
        : sx === -1
          ? width - 40
          : 40
      : 100 + (mode === 'current-position' ? 75 : 0) + sx * 10;
  const y =
    mode === 'absolute'
      ? origin === 'center'
        ? height / 2 - 45
        : sy === -1
          ? height - 45
          : 45
      : 50 + (mode === 'current-position' ? 45 : 0) - sy * 25;
  return { x: x - sx * 7, y: y + sy * 4 };
}

describe('explicit selected artwork centre in the completed Frame placement', () => {
  it.each(modes.flatMap((mode) => origins.map((origin) => ({ mode, origin }))))(
    '$mode / $origin points at the chosen subset without re-anchoring the whole job',
    async ({ mode, origin }) => {
      const { project, sim } = await connectedFixture('grbl-v1.1', mode, origin);
      const before = await frame();
      const firstWrite = sim.outbound().length;
      await centre(['selected']);
      expect(nativeHead()).toMatchObject(
        expectedHead(mode, origin, project.device.bedWidth, project.device.bedHeight),
      );
      const laser = useLaserStore.getState();
      expect(laser.positioningLightEnabled).toBe(true);
      expect(laser.framedRun?.candidate).toBe(before.candidate);
      expect(framedRunStartHandoffIssue(laser.framedRun!, laser)).toBeNull();
      const review = await prepareFramedStartReview(laser.framedRun!);
      expect(review?.prepared.jobOrigin).toEqual(before.candidate.preparedStart.jobOrigin);
      expect(review?.prepared.metrics.frameJobBounds).toEqual(
        before.candidate.preparedStart.metrics.frameJobBounds,
      );
      const wire = sim.outbound().slice(firstWrite).join('');
      expect(wire).toContain('M7\n');
      expect(wire).not.toMatch(/\bM[34]\b/);
    },
  );

  it.each(['grbl-v1.1', 'grblhal', 'fluidnc', 'marlin', 'smoothieware'] as const)(
    '%s retains Current Position through automatic centre, chosen centre and actual Start',
    async (kind) => {
      const { sim } = await connectedFixture(kind, 'current-position');
      const before = await frame();
      const automatic = centreLightAfterCleanFrame(true);
      await vi.advanceTimersByTimeAsync(5_000);
      await automatic;
      expect(nativeHead()).toMatchObject({ x: 193, y: 106 });
      await centre(['selected']);
      expect(nativeHead()).toMatchObject({ x: 178, y: 116 });
      const permit = useLaserStore.getState().framedRun!;
      expect(permit.candidate).toBe(before.candidate);
      const review = await prepareFramedStartReview(permit);
      expect(review?.prepared.jobOrigin).toMatchObject({ currentPosition: { x: 75, y: 45 } });
      const from = sim.outbound().length;
      const repository = await startReviewedFrameOnClock();
      expectProgramSentOnce(sim.outbound().slice(from), review!.prepared.gcode);
      const archive = repository.getSnapshot();
      expect((archive.lastCompletedReceipt ?? archive.activeRun)?.artifact.jobOrigin).toMatchObject(
        {
          startFrom: 'current-position',
          currentPosition: { x: 75, y: 45 },
        },
      );
      expect(useLaserStore.getState().lastWriteError).toBeNull();
    },
  );

  it('uses work-only Verified Origin for automatic and chosen centres then preserves Start', async () => {
    const { sim } = await connectedFixture('marlin', 'verified-origin');
    useLaserStore.setState({ wcoCache: null, workOriginSource: 'unknown', workOriginActive: true });
    const before = await frame();
    expect(useLaserStore.getState().wcoCache).toBeNull();
    expect(nativeHead()).toBeNull();
    const automatic = centreLightAfterCleanFrame(true);
    await vi.advanceTimersByTimeAsync(5_000);
    await automatic;
    expect(useLaserStore.getState().positioningLightEnabled).toBe(true);
    expect(useLaserStore.getState().statusReport?.wPos).toMatchObject({ x: 18, y: 11 });
    await centre(['selected']);
    const laser = useLaserStore.getState();
    expect(laser.statusReport?.wPos).toMatchObject({ x: 3, y: 21 });
    expect(laser.wcoCache).toBeNull();
    expect(laser.framedRun?.candidate).toBe(before.candidate);
    expect(framedRunStartHandoffIssue(laser.framedRun!, laser)).toBeNull();
    const review = await prepareFramedStartReview(laser.framedRun!);
    const first = sim.outbound().length;
    await startReviewedFrameOnClock();
    expectProgramSentOnce(sim.outbound().slice(first), review!.prepared.gcode);
    expect(useLaserStore.getState().lastWriteError).toBeNull();
  });

  it('allows choosing another artwork after Frame without changing whole-job placement', async () => {
    await connectedFixture('grbl-v1.1', 'user-origin');
    const before = await frame();
    useStore.setState({ selectedObjectId: 'also-output', additionalSelectedIds: new Set() });
    await centre(['also-output']);
    expect(nativeHead()).toMatchObject({ x: 133, y: 51 });
    expect(useLaserStore.getState().framedRun?.candidate).toBe(before.candidate);
  });

  it('uses the combined bounds of an explicitly chosen group', async () => {
    await connectedFixture('grbl-v1.1', 'user-origin');
    await frame();
    useStore.setState({ additionalSelectedIds: new Set(['also-output', 'disabled']) });
    await centre(['selected', 'also-output']);
    expect(nativeHead()).toMatchObject({ x: 118, y: 61 });
  });

  it('uses the prepared Print-and-Cut artwork geometry before applying placement', async () => {
    const { project } = await connectedFixture('grbl-v1.1', 'absolute');
    useExperimentalLaserFeatures.getState().setFeature('printAndCut', true);
    const registered = {
      ...project,
      printAndCutTargets: { first: { x: 0, y: 0 }, second: { x: 10, y: 0 } },
    };
    useStore.setState({ project: registered });
    const laser = useLaserStore.getState();
    const key = nativeBedCaptureFrameKey(registered.device, laser);
    // Rotate 90 degrees, then translate (200,100). Selected centre becomes (155,140).
    usePrintCutSessionStore
      .getState()
      .capture('first', { x: 200, y: 100 }, laser.trustedPositionEpoch ?? 0, key);
    usePrintCutSessionStore
      .getState()
      .capture('second', { x: 200, y: 110 }, laser.trustedPositionEpoch ?? 0, key);
    await frame();
    await centre(['selected']);
    expect(nativeHead()).toMatchObject({ x: 148, y: project.device.bedHeight - 144 });
  });

  it('maps verified negative native bed coordinates once, with nonzero WCO', async () => {
    const { project } = await connectedFixture('grbl-v1.1', 'absolute');
    const device = { ...project.device, homing: { ...project.device.homing, enabled: true } };
    useStore.setState({ project: { ...project, device } });
    const epoch = useLaserStore.getState().controllerSessionEpoch;
    useLaserStore.setState({
      ...stockNativeEvidence(device),
      controllerSessionEpoch: epoch,
      controllerSettingsObservation: { sessionEpoch: epoch, observedAt: 1 },
      controllerBuildInfoObservation: { sessionEpoch: epoch, observedAt: 1 },
    });
    expect(resolveNativeBedFrame(device, useLaserStore.getState())).not.toBeNull();
    const before = await frame();
    expect(before.candidate.preparedStart.prepared.jobOriginOffset).toEqual({
      x: -device.bedWidth - 100,
      y: -device.bedHeight - 50,
    });
    await centre(['selected']);
    expect(nativeHead()).toMatchObject({ x: 33 - device.bedWidth, y: -49 });
  });

  it.each(['output-scope', 'work-offset'] as const)(
    'checks %s again inside the owned positioning transaction',
    async (drift) => {
      const { sim } = await connectedFixture('grbl-v1.1', 'current-position');
      await frame();
      const from = sim.outbound().length;
      vi.spyOn(useLaserStore.getState(), 'centrePositioningLight').mockImplementationOnce(
        async (_x, _y, _feed, assertTargetCurrent) => {
          expect(assertTargetCurrent).toBeTypeOf('function');
          if (drift === 'output-scope')
            useStore.setState({
              outputScopeSettings: { cutSelectedGraphics: true, useSelectionOrigin: false },
            });
          else useLaserStore.setState({ wcoCache: { x: 101, y: 50, z: 0 } });
          assertTargetCurrent?.();
        },
      );
      await expect(centreSelectionLight(['selected'])).rejects.toThrow(/changed|origin|Frame/);
      expect(sim.outbound().slice(from).join('')).not.toMatch(/M7|\$J|G[01] /);
    },
  );

  it('allows process-only edits while the final Frame acknowledgement is pending', async () => {
    const { project } = await connectedFixture('grbl-v1.1', 'current-position');
    const before = await frame();
    useLaserStore.setState({ pendingUntrackedAcks: 1 });
    const pending = centreSelectionLight(['selected']);
    useStore.setState({
      project: {
        ...project,
        scene: {
          ...project.scene,
          layers: project.scene.layers.map((layer) => ({
            ...layer,
            name: 'Updated process',
            power: 25,
            speed: 1500,
          })),
        },
      },
    });
    useLaserStore.setState({ pendingUntrackedAcks: 0 });
    await vi.advanceTimersByTimeAsync(5_000);
    await pending;
    expect(nativeHead()).toMatchObject({ x: 178, y: 116 });
    expect(useLaserStore.getState().positioningLightEnabled).toBe(true);
    expect(useLaserStore.getState().framedRun?.candidate).toBe(before.candidate);
  });

  it.each(['user-origin', 'verified-origin', 'current-position'] as const)(
    '%s retains the jig anchor while targeting artwork inside its board outline',
    async (mode) => {
      const { project } = await connectedFixture('grbl-v1.1', mode);
      useStore.setState({
        project: {
          ...project,
          scene: {
            ...project.scene,
            layers: [...project.scene.layers, { ...createRegistrationLayer(), output: false }],
            objects: [
              ...project.scene.objects,
              createRegistrationBox({ x: 10, y: 20, widthMm: 200, heightMm: 100 }),
            ],
          },
        },
      });
      const before = await frame();
      await centre(['selected']);
      expect(nativeHead()).toMatchObject({
        x: 123 + (mode === 'current-position' ? 75 : 0),
        y: 121 + (mode === 'current-position' ? 45 : 0),
      });
      expect(useLaserStore.getState().framedRun?.candidate).toBe(before.candidate);
    },
  );

  it.each(['selection', 'deleted', 'placement', 'session', 'cancel', 'document'] as const)(
    'does not dispatch a chosen target after %s changes during the final Frame fence',
    async (drift) => {
      const { sim } = await connectedFixture('grbl-v1.1', 'current-position');
      await frame();
      useLaserStore.setState({ pendingUntrackedAcks: 1 });
      const from = sim.outbound().length;
      const pending = centreSelectionLight(['selected']);
      const rejected = expect(pending).rejects.toThrow();
      if (drift === 'selection') useStore.setState({ selectedObjectId: 'also-output' });
      if (drift === 'document')
        useStore.setState((app) => ({ projectDocumentEpoch: app.projectDocumentEpoch + 1 }));
      if (drift === 'deleted')
        useStore.setState((app) => ({
          project: {
            ...app.project,
            scene: {
              ...app.project.scene,
              objects: app.project.scene.objects.filter((object) => object.id !== 'selected'),
            },
          },
        }));
      if (drift === 'placement')
        useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'center' } });
      if (drift === 'session')
        useLaserStore.setState((laser) => ({
          controllerSessionEpoch: laser.controllerSessionEpoch + 1,
        }));
      if (drift === 'cancel')
        useLaserStore.setState((laser) => ({
          manualMotionCancelEpoch: laser.manualMotionCancelEpoch + 1,
        }));
      useLaserStore.setState({ pendingUntrackedAcks: 0 });
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      expect(sim.outbound().slice(from).join('')).not.toMatch(/M7|\$J|G[01] /);
    },
  );

  it.each(['user-origin', 'verified-origin', 'current-position'] as const)(
    'requires a captured Frame before a %s selected target can move',
    async (mode) => {
      const { sim } = await connectedFixture('grbl-v1.1', mode);
      const from = sim.outbound().length;
      await expect(centreSelectionLight(['selected'])).rejects.toThrow(/Frame/);
      expect(sim.outbound().slice(from).join('')).not.toMatch(/M7|\$J|G[01] /);
    },
  );

  it('retains the existing Absolute selection move when there is no Frame', async () => {
    const { project } = await connectedFixture('grbl-v1.1', 'absolute');
    await centre(['selected']);
    expect(nativeHead()).toMatchObject({ x: 33, y: project.device.bedHeight - 49 });
  });

  it.each([{ ids: [] }, { ids: ['missing'] }, { ids: ['also-output'] }])(
    'rejects absent or unselected IDs $ids',
    async ({ ids }) => {
      const { sim } = await connectedFixture('grbl-v1.1', 'absolute');
      const from = sim.outbound().length;
      await expect(centreSelectionLight(ids)).rejects.toThrow(/Select/);
      expect(sim.outbound().slice(from).join('')).not.toMatch(/M7|\$J|G[01] /);
    },
  );
});
