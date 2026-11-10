// Rolling audit v13 Y3-P1-2 (ADR-441 Amendment 10): Add target to canvas set
// Absolute Coordinates, but the routine Set origin quietly upgraded it to User
// Origin, the rings burned 26-156 mm from where the calibration photo reads
// them, and Job Review said nothing on a first calibration.

import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { addCalibrationTargetToCanvas } from '../camera/calibrate/calibration-actions';
import { DEFAULT_CALIBRATION_SETTINGS } from '../camera/calibrate/camera-calibration-store';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { cameraTargetStartFromWarning, demotedPolicyWarnings } from './start-job-readiness-policy';
import { machineSnapshot } from './start-machine-snapshot';
import { placementAfterSetOrigin, setOriginToast } from './set-origin-placement';

beforeEach(() => {
  localStorage.clear();
  resetStore();
  useStore.setState({ project: createProject() });
});

describe('Set origin with the camera target on the canvas', () => {
  it('keeps Absolute Coordinates, and says so', () => {
    addCalibrationTargetToCanvas(DEFAULT_CALIBRATION_SETTINGS);
    expect(useStore.getState().jobPlacement.startFrom).toBe('absolute');
    const placement = placementAfterSetOrigin(useStore.getState().projectDocumentEpoch);
    expect(placement).toBe('kept-for-camera-target');
    expect(useStore.getState().jobPlacement.startFrom).toBe('absolute');
    expect(setOriginToast(placement)).toContain('Start from stays Absolute Coordinates');
  });

  it('still upgrades Absolute to User Origin for other work, and now says so', () => {
    const placement = placementAfterSetOrigin(useStore.getState().projectDocumentEpoch);
    expect(placement).toBe('user-origin');
    expect(useStore.getState().jobPlacement.startFrom).toBe('user-origin');
    expect(setOriginToast(placement)).toBe(
      'Origin set to current head position (G92). Start from is now User Origin.',
    );
  });

  it('leaves the rings to User Origin once they were moved, as ordinary artwork', () => {
    addCalibrationTargetToCanvas(DEFAULT_CALIBRATION_SETTINGS);
    const { project } = useStore.getState();
    const [first, ...rest] = project.scene.objects;
    if (first === undefined) throw new Error('expected rings');
    useStore.setState({
      project: {
        ...project,
        scene: {
          ...project.scene,
          objects: [
            { ...first, transform: { ...first.transform, x: first.transform.x + 5 } },
            ...rest,
          ],
        },
      },
    });
    expect(placementAfterSetOrigin(useStore.getState().projectDocumentEpoch)).toBe('user-origin');
  });
});

describe('Job Review with the camera target on the canvas', () => {
  it('warns when the rings would burn from another Start from than Absolute', () => {
    addCalibrationTargetToCanvas(DEFAULT_CALIBRATION_SETTINGS);
    const { project } = useStore.getState();
    const snapshot = machineSnapshot(project, useLaserStore.getState(), useCameraStore.getState());
    expect(snapshot.cameraTargetOnCanvas).toBe(true);
    const userOrigin = demotedPolicyWarnings(project, snapshot, {
      startFrom: 'user-origin',
      anchor: 'front-left',
    });
    expect(userOrigin).toContain(
      cameraTargetStartFromWarning({ startFrom: 'user-origin', anchor: 'front-left' }),
    );
    expect(userOrigin.join(' ')).toContain('Choose Absolute Coordinates');
    expect(demotedPolicyWarnings(project, snapshot, undefined).join(' ')).not.toContain(
      "camera calibration target's rings",
    );
  });

  it('says nothing about it for a project without the target', () => {
    const { project } = useStore.getState();
    const snapshot = machineSnapshot(project, useLaserStore.getState(), useCameraStore.getState());
    expect(snapshot.cameraTargetOnCanvas).toBe(false);
  });
});
