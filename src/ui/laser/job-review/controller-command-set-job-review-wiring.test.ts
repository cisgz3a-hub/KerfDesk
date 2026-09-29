// Job Review rebuilds controller identity warnings from the live session. Live
// commands follow the command set Connect bound from the profile of that moment
// (ADR-322 §4), so the review compares it with the profile's too, and names a
// saved Falcon A1 Pro copy that predates the preset's command set (ADR-375).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../../core/controllers/grbl';
import type { DeviceProfile } from '../../../core/devices';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../../core/devices/falcon-profiles';
import { createLayer, createProject, EMPTY_SCENE } from '../../../core/scene';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { initialLaserState } from '../../state/laser-store-helpers';
import { useLaserStore } from '../../state/laser-store';
import { captureLaserModeStartSnapshot } from '../../state/laser-mode-start-evidence';
import { resetStore, svgObj } from '../../state/test-helpers';
import { prepareCurrentStartJob } from '../start-job-source';
import { runJobReviewGate } from './job-review-gate';
import { useJobReviewStore } from './job-review-store';
import { captureJobReviewModels } from './testing';

const IDLE_STATUS: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};
// An A1 Pro profile saved before #796 has the preset's id but no command set.
const { controllerCommandSet: _dropped, ...LEGACY_FALCON } = FALCON_A1_PRO_GRBLHAL_PROFILE;
const REAPPLY = `Re-apply the ${FALCON_A1_PRO_GRBLHAL_PROFILE.name} preset in Machine Setup, then reconnect.`;

function configureProject(device: DeviceProfile): void {
  useStore.setState({
    project: {
      ...createProject(device),
      device,
      scene: {
        ...EMPTY_SCENE,
        objects: [svgObj('line', ['#ff0000'])],
        layers: [createLayer({ id: 'red', color: '#ff0000' })],
      },
    },
  });
}

async function reviewWarnings(): Promise<string> {
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
  const warnings = capture.models[0]?.warnings.join('\n') ?? '';
  useJobReviewStore.getState().cancel();
  await review;
  capture.stop();
  return warnings;
}

beforeEach(() => {
  resetStore();
  useJobReviewStore.getState().close();
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: IDLE_STATUS,
    activeControllerKind: 'grblhal',
    activeControllerCommandSet: null,
    detectedControllerKind: 'grblhal',
  });
});

afterEach(async () => {
  useJobReviewStore.getState().cancel();
  useJobReviewStore.getState().close();
  useLaserStore.setState(initialLaserState());
  await Promise.resolve();
});

describe('controller command set at Job Review (ADR-375)', () => {
  // The generic grblHAL Frame turns the tool off with M5+M9 just before Start (ADR-323).
  it('names a Falcon profile reviewed on a generic grblHAL connection', async () => {
    configureProject(FALCON_A1_PRO_GRBLHAL_PROFILE);
    const warnings = await reviewWarnings();
    expect(warnings).toContain(
      'Controller identity mismatch: the selected profile uses the Falcon A1 Pro ' +
        '(GRBL-compatible commands), but the active connection uses the generic grblHAL commands.',
    );
    expect(warnings).toContain("Reconnect to use the profile's command set");
  });

  it('stays quiet once the connection uses the profile command set', async () => {
    configureProject(FALCON_A1_PRO_GRBLHAL_PROFILE);
    useLaserStore.setState({ activeControllerCommandSet: 'creality-falcon-a1-pro' });
    expect(await reviewWarnings()).not.toContain('Controller identity');
  });

  // Saved profiles are not migrated (docs/audits/2026-09-19-machine-compatibility-
  // fixes/README.md), so Job Review names the deliberate reapplication instead.
  it('names a saved Falcon copy that predates the preset command set', async () => {
    configureProject(LEGACY_FALCON);
    const warnings = await reviewWarnings();
    expect(warnings).toContain(
      `this machine profile is a copy of the ${FALCON_A1_PRO_GRBLHAL_PROFILE.name} preset ` +
        'saved before the preset had its own command set',
    );
    expect(warnings).toContain('Frame sends M9 just before Start');
    expect(warnings.split(REAPPLY)).toHaveLength(2);
    // The copy connected with the command set it has, so nothing else differs.
    expect(warnings).not.toContain('but the active connection uses');
  });
});
