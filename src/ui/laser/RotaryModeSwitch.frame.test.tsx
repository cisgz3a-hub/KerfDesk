// Frame-first (ADR-228/232, ADR-373): the rotary switch changes the job's Y
// mapping, so a completed Frame cannot authorize Start after it moves.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { stockNativeEvidence } from '../state/native-bed-frame.test-support';
import { resetStore } from '../state/test-helpers';
import { ensureFramedRunInvalidationSubscriptions } from './framed-run-invalidation';
import {
  idleControllerStatusForFrameTest,
  installReviewPendingFramedRunPermitForCurrentState,
} from './framed-run-testing';
import { RotaryModeSwitch } from './RotaryModeSwitch';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const lineObject: SceneObject = {
  kind: 'imported-svg',
  id: 'rotary-switch-line',
  source: 'rotary-switch-line.svg',
  bounds: { minX: 10, minY: 20, maxX: 110, maxY: 20 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: [
            { x: 10, y: 20 },
            { x: 110, y: 20 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetStore();
  useStore.setState({
    project: {
      ...createProject({
        ...DEFAULT_DEVICE_PROFILE,
        homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
        rotary: { enabled: false, type: 'chuck', mmPerRotation: 360, objectDiameterMm: 60 },
      }),
      scene: {
        ...EMPTY_SCENE,
        objects: [lineObject],
        layers: [createLayer({ id: 'red', color: '#ff0000' })],
      },
    },
    jobPlacement: { startFrom: 'absolute', anchor: 'front-left' },
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
  });
  useCameraStore.setState({
    placementActive: false,
    confirmedPositionEpoch: null,
    surfaceHeightMm: 0,
  });
  const evidence = stockNativeEvidence(useStore.getState().project.device, true);
  useLaserStore.setState({
    ...initialLaserState(),
    ...evidence,
    connection: { kind: 'connected' },
    statusReport: idleControllerStatusForFrameTest(),
    controllerSessionEpoch: 7,
    trustedPositionEpoch: 3,
    activeControllerKind: 'grbl-v1.1',
    detectedControllerKind: 'grbl-v1.1',
    controllerSettings: { ...evidence.controllerSettings, reportInches: false },
    controllerSettingsObservation: { sessionEpoch: 7, observedAt: 1 },
  });
  ensureFramedRunInvalidationSubscriptions();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetStore();
  useLaserStore.setState(initialLaserState());
});

it('expires a completed Frame when the rotary is switched on', async () => {
  const permit = await installReviewPendingFramedRunPermitForCurrentState();
  act(() => root.render(<RotaryModeSwitch />));
  expect(useLaserStore.getState().framedRun).toBe(permit);

  const rotary = [...host.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === 'Rotary',
  );
  if (rotary === undefined) throw new Error('Missing Rotary switch');
  act(() => rotary.click());

  expect(useStore.getState().project.device.rotary?.enabled).toBe(true);
  expect(useLaserStore.getState().framedRun).toBeNull();
  expect(useLaserStore.getState().frameVerification).toBeNull();
});
