// The real review gate on the machine 1.0.29 made from a stock-GRBL laser
// (rolling audit v10 V2-P2-2, ADR-637 Amendment 8): the program it reviews is
// the spindle program (`M3 S12000`, `G4 P3`), and Start cannot be confirmed
// until the operator answers whether the machine is a laser.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../../core/controllers/grbl';
import { createProject } from '../../../core/scene';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import {
  CONVERTED_LASER_ANSWER_STORAGE_KEY,
  useConvertedLaserAnswerStore,
} from '../../state/converted-laser-question';
import { loadLastMachineSelection } from '../../state/last-machine-persistence';
import { captureLaserModeStartSnapshot } from '../../state/laser-mode-start-evidence';
import { initialLaserState } from '../../state/laser-store-helpers';
import { useLaserStore } from '../../state/laser-store';
import { resolveProjectMachineCapability } from '../../state/project-machine-capability';
import { resetStore, svgObj } from '../../state/test-helpers';
import { prepareCurrentStartJob } from '../start-job-source';
import { runJobReviewGate } from './job-review-gate';
import { useJobReviewStore } from './job-review-store';
import { captureJobReviewModels } from './testing';

const SAVED_BY_1_0_29 = readFileSync(
  resolve('src/__fixtures__/returning-user/1.0.29-laser-made-cnc-last-machine.json'),
  'utf8',
);
const IDLE_STATUS: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

function restoreThe1029Machine(): void {
  const selection = loadLastMachineSelection({
    getItem: () => SAVED_BY_1_0_29,
    setItem: () => undefined,
  });
  if (selection === null) throw new Error('The 1.0.29 last machine did not load');
  const project = resolveProjectMachineCapability(
    createProject(selection.profile),
    [],
    selection.machineKind,
  ).project;
  // createStartupProject's project is the store's first one, not an Open.
  useStore.setState({ project });
  const square = svgObj('square', ['#000000']);
  useStore.getState().importSvgFragment({
    source: 'square.svg',
    bounds: square.bounds,
    objects: [square],
  });
  useStore.setState({ jobPlacement: { startFrom: 'current-position', anchor: 'front-left' } });
}

async function openReview() {
  const app = useStore.getState();
  const laser = useLaserStore.getState();
  const prepared = await prepareCurrentStartJob(
    app,
    laser,
    useCameraStore.getState(),
    undefined,
    false,
  );
  if (!prepared.ok) throw new Error(`Preparation failed: ${prepared.messages.join(' / ')}`);
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
    purpose: 'start',
  });
  await vi.waitFor(() => expect(capture.models).toHaveLength(1));
  return { review, capture, gcode: prepared.gcode };
}

beforeEach(() => {
  resetStore();
  useJobReviewStore.getState().close();
  useConvertedLaserAnswerStore.setState({ routerAnswered: false });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: IDLE_STATUS,
    // A stock GRBL 1.1h diode's `$$`.
    detectedSettings: { laserModeEnabled: false, maxPowerS: 1000, minPowerS: 0 },
  });
});

afterEach(async () => {
  useJobReviewStore.getState().cancel();
  useJobReviewStore.getState().close();
  useLaserStore.setState(initialLaserState());
  useConvertedLaserAnswerStore.setState({ routerAnswered: false });
  try {
    window.localStorage.removeItem(CONVERTED_LASER_ANSWER_STORAGE_KEY);
  } catch {
    // Node 25's own localStorage may stand in for jsdom's here.
  }
  await Promise.resolve();
});

describe('Job Review on the CNC 1.0.29 made from a laser', () => {
  it('reviews the spindle program but holds Start until the operator answers', async () => {
    restoreThe1029Machine();
    const { review, capture, gcode } = await openReview();
    // The burn the question exists for: full power, held still.
    expect(gcode).toContain('M3 S12000');
    expect(gcode).toContain('G4 P3.000');
    expect(capture.models[0]?.convertedLaser).toEqual({
      hints: [
        { kind: 'laser-mode', enabled: false },
        { kind: 'laser-power-scale', maxPowerS: 1000 },
      ],
    });

    useJobReviewStore.getState().confirm();
    expect(useJobReviewStore.getState().pendingSignal).toBeNull();
    expect(useJobReviewStore.getState().state.kind).toBe('open');

    // The answer rebuilds the review without the question. (This harness has
    // no completed Frame, so the rebuild then waits on the frame-first gate.)
    useConvertedLaserAnswerStore.getState().answerRouter();
    useJobReviewStore.getState().requestRebuild();
    await vi.waitFor(() => expect(capture.models.at(-1)?.convertedLaser).toBeUndefined());
    expect(capture.models.length).toBeGreaterThan(1);

    useJobReviewStore.getState().cancel();
    expect(await review).toBeNull();
    capture.stop();
  });

  it('asks nothing of a router whose spindle was set up', async () => {
    restoreThe1029Machine();
    const machine = useStore.getState().project.machine;
    if (machine?.kind !== 'cnc') throw new Error('expected the CNC');
    useStore.setState({
      project: {
        ...useStore.getState().project,
        machine: { ...machine, params: { ...machine.params, spindleMaxRpm: 24000 } },
      },
    });
    const { review, capture } = await openReview();
    expect(capture.models[0]?.convertedLaser).toBeUndefined();
    useJobReviewStore.getState().cancel();
    await review;
    capture.stop();
  });
});
