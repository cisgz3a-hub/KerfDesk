import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../../core/scene';
import { useStore } from '../../state';
import type { FramedRunCandidate } from '../../state/framed-run';
import { useLaserStore } from '../../state/laser-store';
import { initialLaserState } from '../../state/laser-store-helpers';
import { RecoveryRepository } from '../../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../../state/recovery/testing';
import { resetStore } from '../../state/test-helpers';
import { completeFramedRunCandidateForTest } from '../framed-run-testing';
import { useStartBlockerStore } from '../start-blocker-store';
import { runStartJobFlow } from '../start-job-flow';
import { runFrameNow } from '../use-frame-action';
import {
  beforeYouStartFoldedKey,
  CNC_BEFORE_YOU_START,
  LASER_BEFORE_YOU_START,
  remoteReviewAcknowledgement,
} from './before-you-start';
import type { JobReviewModel } from './job-review-model';
import { useJobReviewStore } from './job-review-store';
import { JobReviewDialog } from './JobReviewDialog';

vi.mock('../../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const laserModel: JobReviewModel = {
  machineKind: 'laser',
  stats: [],
  warnings: [],
  resolvedOriginLabel: 'User origin — anchor front left',
  toolPlanLabels: [],
  outputQualityFacts: [],
  effectiveOperations: [],
  acknowledgement: { kind: 'laser-verified' },
};

const cncModel: JobReviewModel = {
  ...laserModel,
  machineKind: 'cnc',
  acknowledgement: { kind: 'cnc', prompt: 'Confirm CNC setup prompt body.' },
};

const lineObject: SceneObject = {
  kind: 'imported-svg',
  id: 'line-object',
  source: 'line.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: [
            { x: 1, y: 1 },
            { x: 9, y: 9 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

const CONTROLLER_EPOCH = 7;
const originalStartJob = useLaserStore.getState().startJob;
const originalFrame = useLaserStore.getState().frame;

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  localStorage.clear();
  resetStore();
  useStore.setState({
    project: {
      ...createProject(DEFAULT_DEVICE_PROFILE),
      scene: {
        ...EMPTY_SCENE,
        objects: [lineObject],
        layers: [createLayer({ id: 'red', color: '#ff0000' })],
      },
    },
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
  });
  useJobReviewStore.getState().close();
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(async () => {
  await unmount();
  host.remove();
  useJobReviewStore.getState().close();
  useLaserStore.setState({
    ...initialLaserState(),
    startJob: originalStartJob,
    frame: originalFrame,
  });
  localStorage.clear();
  resetStore();
  vi.restoreAllMocks();
});

async function render(): Promise<void> {
  root = createRoot(host);
  await act(async () => root?.render(<JobReviewDialog />));
}

async function unmount(): Promise<void> {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
}

function block(): HTMLDetailsElement | null {
  return host.querySelector('section[aria-label="Before you start"] details');
}

function itemTexts(): string[] {
  return [...host.querySelectorAll('section[aria-label="Before you start"] li')].map(
    (item) => item.textContent ?? '',
  );
}

async function toggleBlock(): Promise<void> {
  const summary = block()?.querySelector('summary');
  if (summary === null || summary === undefined) throw new Error('Before you start not shown');
  // The details element fires toggle as a queued task, after the click.
  await act(async () => {
    summary.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function deviceId(): string {
  const device = useStore.getState().project.device;
  return device.profileId ?? device.name;
}

describe('Job Review Before you start (ADR-689)', () => {
  it('shows the laser points open above Start job, even with laser mode verified', async () => {
    useJobReviewStore.getState().open(laserModel);
    await render();
    expect(block()?.open).toBe(true);
    expect(itemTexts()).toEqual(LASER_BEFORE_YOU_START);
    expect(itemTexts().join(' ')).toMatch(/safety glasses/);
    expect(itemTexts().join(' ')).toMatch(/Focus the laser/);
    expect(itemTexts().join(' ')).toMatch(/fire extinguisher/);
    expect(itemTexts().join(' ')).toMatch(/air assist and ventilation/);
  });

  it('shows the CNC points for a CNC review', async () => {
    useJobReviewStore.getState().open(cncModel);
    await render();
    expect(block()?.open).toBe(true);
    expect(itemTexts()).toEqual(CNC_BEFORE_YOU_START);
    expect(itemTexts().join(' ')).toMatch(/eye and ear protection/);
    expect(itemTexts().join(' ')).toMatch(/Clamp/);
    expect(itemTexts().join(' ')).toMatch(/Stay with the machine/);
  });

  it('is not shown on a Frame review, which runs with the tool off', async () => {
    useJobReviewStore.getState().open(laserModel, 'frame');
    await render();
    expect(block()).toBeNull();
  });

  it('remembers a fold for this machine only, and unfolding reopens it', async () => {
    useJobReviewStore.getState().open(laserModel);
    await render();
    await toggleBlock();
    expect(block()?.open).toBe(false);
    expect(localStorage.getItem(beforeYouStartFoldedKey(deviceId()))).toBe('1');

    await unmount();
    await render();
    expect(block()?.open).toBe(false);

    await act(async () =>
      useStore.setState((state) => ({
        project: {
          ...state.project,
          device: { ...state.project.device, profileId: 'other-machine' },
        },
      })),
    );
    expect(block()?.open).toBe(true);

    await act(async () =>
      useStore.setState((state) => ({
        project: { ...state.project, device: DEFAULT_DEVICE_PROFILE },
      })),
    );
    expect(block()?.open).toBe(false);
    await toggleBlock();
    expect(block()?.open).toBe(true);
    expect(localStorage.getItem(beforeYouStartFoldedKey(deviceId()))).toBe('0');
  });

  it('the phone remote gets the same points ahead of any prompt it confirms', () => {
    expect(remoteReviewAcknowledgement({ kind: 'laser-verified' }, 'laser').prompt).toBe(
      `Before you start: ${LASER_BEFORE_YOU_START.join(' ')}`,
    );
    const cnc = remoteReviewAcknowledgement(cncModel.acknowledgement, 'cnc');
    expect(cnc.kind).toBe('cnc');
    expect(cnc.prompt.startsWith(`Before you start: ${CNC_BEFORE_YOU_START[0]}`)).toBe(true);
    expect(cnc.prompt.endsWith('Confirm CNC setup prompt body.')).toBe(true);
  });

  it('starts byte-identical G-code whether the block is open or folded', async () => {
    const open = await startThroughDialog(false);
    const folded = await startThroughDialog(true);
    expect(folded).toBe(open);
    expect(open).not.toMatch(/glasses|Before you start/i);
  });
});

/** Frame, press Start, optionally fold the block in the open dialog, then
 * press Start job; returns the bytes handed to the controller. */
async function startThroughDialog(fold: boolean): Promise<string> {
  const startJob = vi.fn(async () => undefined);
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: idleStatus,
    activeWcs: 'G54',
    wcoCache: { x: 0, y: 0, z: 0 },
    controllerSessionEpoch: CONTROLLER_EPOCH,
    controllerQualification: { kind: 'qualified', epoch: CONTROLLER_EPOCH, settings: 'verified' },
    controllerSettings: {
      maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
      minPowerS: DEFAULT_DEVICE_PROFILE.minPowerS,
      laserModeEnabled: true,
    },
    controllerSettingsObservation: { sessionEpoch: CONTROLLER_EPOCH, observedAt: 1 },
    startJob,
    frame: vi.fn(async (_bounds, _feed, candidate?: FramedRunCandidate) => {
      if (candidate === undefined) throw new Error('Frame candidate was not supplied.');
      completeFramedRunCandidateForTest(candidate);
    }),
  });
  useStartBlockerStore.getState().clear();
  if (root === null) await render();
  await runFrameNow();
  const flow = runStartJobFlow(
    new RecoveryRepository({
      backend: new MemoryRecoveryStorageBackend(),
      generationStore: new MemoryRecoveryGenerationStore(),
      legacyStorage: { read: () => null, clear: () => undefined },
      nowIso: () => '2026-11-03T12:00:00.000Z',
    }),
  );
  await vi.waitFor(() => {
    const state = useJobReviewStore.getState().state;
    expect(state.kind === 'open' && !state.isPreparing).toBe(true);
  });
  await act(async () => undefined);
  if (fold) await toggleBlock();
  expect(block()?.open).toBe(!fold);
  const start = [...host.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Start job',
  );
  if (start === undefined) throw new Error('Start job button not shown');
  await act(async () => start.click());
  await flow;
  expect(startJob).toHaveBeenCalledTimes(1);
  const gcode = (startJob.mock.calls[0] as unknown[] | undefined)?.[0];
  if (typeof gcode !== 'string') throw new Error('Start did not hand G-code to the controller.');
  return gcode;
}
