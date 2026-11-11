// Job Review re-prepares at Confirm and accepts only the bytes it showed. A
// variable-text job recompiled with a fresh clock never reproduced a shown
// seconds field ({{time}}, {{datetime}}), so every Confirm showed a "changed"
// review again and the job could not be started (oracle audit O1, O5-P2-2).
// The rebuild now keeps the clock of the program on screen.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../../core/controllers/grbl';
import { createBarcodeObject, defaultBarcodeSpec, type BarcodeShape } from '../../../core/barcode';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import {
  addLayer,
  addObject,
  createArtworkOperation,
  createProject,
  DEFAULT_PROJECT_VARIABLE_DATA,
  type Project,
} from '../../../core/scene';
import { parseVariableTemplateSource } from '../../../core/variables';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { captureLaserModeStartSnapshot } from '../../state/laser-mode-start-evidence';
import { useLaserStore } from '../../state/laser-store';
import { initialLaserState } from '../../state/laser-store-helpers';
import { resetStore } from '../../state/test-helpers';
import { prepareCurrentStartJob } from '../start-job-source';
import { runJobReviewGate } from './job-review-gate';
import { useJobReviewStore } from './job-review-store';
import { captureJobReviewModels } from './testing';

vi.mock('../../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

// In-process stand-in for the output Worker: the call output-preparation.ts
// makes for a snapshot request, with its fixed clock from evaluatedAtIso.
vi.mock('../output-preparation-worker-client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    prepareStartOutputOffThread: async (request: {
      readonly project: Project;
      readonly controllerSettings: never;
      readonly machine: never;
      readonly jobPlacement: never;
      readonly outputScope: never;
      readonly requireFrame: boolean;
      readonly snapshot: { readonly evaluatedAtIso: string };
    }) => {
      const { prepareStartJobSnapshot } = await import('../start-job-readiness');
      const { outputTextRenderer } = await import('../../text/output-text-renderer');
      const stamp = new Date(request.snapshot.evaluatedAtIso).getTime();
      return prepareStartJobSnapshot(
        request.project,
        request.controllerSettings,
        request.machine,
        request.jobPlacement,
        request.outputScope,
        {
          clock: () => new Date(stamp),
          renderVariableText: outputTextRenderer,
          ...request.snapshot,
          requireFrame: request.requireFrame,
        },
      );
    },
  };
});

const CONTROLLER_EPOCH = 7;
const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

async function timeTagProject(source: string): Promise<Project> {
  const parsed = parseVariableTemplateSource(source);
  if (!parsed.ok) throw new Error(parsed.message);
  const spec: BarcodeShape = {
    ...defaultBarcodeSpec('data-matrix'),
    moduleMm: 0.5,
    data: source,
    variableTemplate: parsed.template,
  };
  const created = await createBarcodeObject({
    id: 'tag',
    color: '#000000',
    spec,
    value: 'X',
    renderCaption: () => Promise.reject(new Error('no caption')),
  });
  if (!created.ok) throw new Error(created.message);
  const project = createProject(DEFAULT_DEVICE_PROFILE);
  const bound = createArtworkOperation(project.scene, created.object, { mode: 'fill' });
  return {
    ...project,
    variables: DEFAULT_PROJECT_VARIABLE_DATA,
    scene: addLayer(addObject(project.scene, bound.object), bound.operation),
  };
}

beforeEach(() => {
  resetStore();
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
  });
  useJobReviewStore.getState().close();
});

afterEach(() => {
  useJobReviewStore.getState().close();
  useLaserStore.setState(initialLaserState());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Job Review with a clock-bound variable field', () => {
  it('confirms in one click after the seconds moved, and keeps the shown time', async () => {
    useStore.setState({ project: await timeTagProject('{{time}}') });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T10:00:00.200Z'));
    const app = useStore.getState();
    const laser = useLaserStore.getState();
    const prepared = await prepareCurrentStartJob(
      app,
      laser,
      useCameraStore.getState(),
      undefined,
      false,
    );
    if (!prepared.ok) throw new Error(prepared.messages.join(' / '));
    const capture = captureJobReviewModels();
    const review = runJobReviewGate({
      initial: {
        app,
        project: app.project,
        laser,
        prepared,
        laserModeStartSnapshot: captureLaserModeStartSnapshot(laser),
      },
      completedReceipt: null,
      purpose: 'frame',
    });
    await vi.waitFor(() => expect(capture.models).toHaveLength(1), { timeout: 20_000 });

    // The operator reads the review for three seconds, then confirms.
    vi.setSystemTime(new Date('2026-11-12T10:00:03.400Z'));
    let settled = false;
    void review.then(() => {
      settled = true;
    });
    useJobReviewStore.getState().confirm();
    // Either the job is confirmed, or the review shows itself again as changed.
    await vi.waitFor(() => expect(settled || capture.models.length > 1).toBe(true), {
      timeout: 20_000,
    });
    const reshown = capture.models.length;
    if (!settled) useJobReviewStore.getState().cancel();
    const confirmed = await review;
    capture.stop();

    expect(reshown).toBe(1);
    expect(confirmed).not.toBeNull();
    expect(confirmed?.bundle.prepared.gcode).toBe(prepared.gcode);
  });
});
