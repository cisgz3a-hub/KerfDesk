import { afterEach, describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { createProject } from '../../core/scene';
import { useCameraStore } from '../state/camera-store';
import { resolveCameraSafeFramePlacement } from './camera-frame-placement';

const originalCamera = useCameraStore.getState();

function idleStatus(): StatusReport {
  // Placement reads position fields only; state is enough for these cases.
  return { state: 'Idle', mPos: { x: 0, y: 0, z: 0 } } as unknown as StatusReport;
}

function homingProject(): ReturnType<typeof createProject> {
  const project = createProject();
  return {
    ...project,
    device: { ...project.device, homing: { ...project.device.homing, enabled: true } },
  };
}

afterEach(() => {
  useCameraStore.setState({
    placementActive: originalCamera.placementActive,
    confirmedPositionEpoch: originalCamera.confirmedPositionEpoch,
  });
});

describe('resolveCameraSafeFramePlacement', () => {
  // The absolute-home gate must not block Frame: the beam-off trace is how an
  // operator checks placement before homing, and Start offers Home in place.
  it('resolves an unhomed Absolute Coordinates frame so the trace can run', () => {
    useCameraStore.setState({ placementActive: false });
    const placement = resolveCameraSafeFramePlacement(
      homingProject(),
      { startFrom: 'absolute', anchor: 'front-left' },
      {
        statusReport: idleStatus(),
        workOriginActive: false,
        wcoCache: null,
        homingState: 'unknown',
        trustedPositionEpoch: 0,
        reportInches: false,
      },
    );
    expect(placement.ok).toBe(true);
  });

  it('allows a watched tool-off Frame while camera placement is active without position proof', () => {
    useCameraStore.setState({ placementActive: true, confirmedPositionEpoch: null });
    const placement = resolveCameraSafeFramePlacement(
      homingProject(),
      { startFrom: 'absolute', anchor: 'front-left' },
      {
        statusReport: idleStatus(),
        workOriginActive: false,
        wcoCache: null,
        homingState: 'unknown',
        trustedPositionEpoch: 0,
        reportInches: false,
      },
    );
    expect(placement.ok).toBe(true);
  });
});
