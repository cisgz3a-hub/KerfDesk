// Rolling audit v13 Y1-P2-1 / Y1-P3-1 / Y1-P3-6 (ADR-441 Amendment 9): with
// the default part-bed sheet the grade said "Accurate enough for placing
// artwork by eye" while the far bed was millimetres off, the settings row
// dropped the caveat, the advice asked for a smaller margin, and nothing at
// Start or on the canvas said where the picture was only estimated.

import { beforeAll, describe, expect, it } from 'vitest';
import {
  brownWebcam,
  calibrateTruthCamera,
  type TruthCalibration,
} from '../../../core/camera/model/extrapolation-fixtures';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../../core/scene';
import { mountControl } from '../../image-editor/control-audit-test-support';
import { cameraOffTargetWarning } from '../../laser/camera-off-target-warning';
import { frameVerificationForProject } from '../../laser/frame-verification-testing';
import { prepareStartJob } from '../../laser/start-job-readiness';
import { computeView } from '../../workspace/view-transform';
import { CameraEstimatedArea } from '../accuracy/CameraEstimatedArea';
import { calibrationFailureMessage, calibrationGrade } from './calibration-result';

let offCentre: TruthCalibration;
let wholeBed: TruthCalibration;

beforeAll(() => {
  // A strong webcam lens 100 mm right of the bed's centre line, on the default 300 × 200 sheet.
  offCentre = calibrateTruthCamera(brownWebcam({ k1: -0.31, k2: 0.1, k3: -0.012, centreX: 300 }));
  // The same kind of camera on a sheet over the whole bed.
  wholeBed = calibrateTruthCamera(brownWebcam(), { width: 400, height: 400 });
}, 120_000);

describe('the grade covers the whole bed the camera sees', () => {
  it('is not "Accurate enough" when the bed beyond the target is millimetres off, and says how far', () => {
    const grade = calibrationGrade(offCentre.record);
    expect(offCentre.record.accuracy.rmsErrorMm).toBeLessThan(0.25);
    expect(grade.tone).toBe('fair');
    expect(grade.headline).toMatch(
      /^Accurate on the target; elsewhere on the bed up to about \d+(\.\d)? mm off\.$/,
    );
    expect(grade.advice).toMatch(
      /may be up to about \d+(\.\d)? mm off near the [a-z-]+ (corner|edge) of the bed/,
    );
    expect(grade.advice).toContain('Engrave the target on a larger sheet');
    expect(grade.advice).not.toContain('smaller margin');
  });

  it('stays good for a sheet over the whole bed', () => {
    expect(calibrationGrade(wholeBed.record)).toMatchObject({
      tone: 'good',
      headline: 'Accurate enough for placing artwork by eye.',
    });
  });

  it('no longer prescribes a smaller margin when the lens folds', () => {
    expect(calibrationFailureMessage('lens-folds')).not.toContain('smaller margin');
    expect(calibrationFailureMessage('lens-folds')).toContain('on a larger sheet');
  });
});

describe('Job Review says when artwork sits where the picture is estimated', () => {
  const ABSOLUTE = undefined;

  it('warns for a job in the far corner, and not for one on the target', () => {
    const corner = cameraOffTargetWarning({
      cameraPlacementActive: true,
      model: offCentre.record,
      jobOrigin: ABSOLUTE,
      jobBounds: { minX: 5, minY: 5, maxX: 40, maxY: 40 },
    });
    expect(corner).toMatch(/may be up to about \d+(\.\d)? mm off/);
    expect(
      cameraOffTargetWarning({
        cameraPlacementActive: true,
        model: offCentre.record,
        jobOrigin: ABSOLUTE,
        jobBounds: { minX: 190, minY: 190, maxX: 210, maxY: 210 },
      }),
    ).toBeNull();
  });

  it('says nothing without camera placement, or for a relative Start from (advised elsewhere)', () => {
    const corner = { minX: 5, minY: 5, maxX: 40, maxY: 40 };
    expect(
      cameraOffTargetWarning({
        cameraPlacementActive: false,
        model: offCentre.record,
        jobOrigin: ABSOLUTE,
        jobBounds: corner,
      }),
    ).toBeNull();
    expect(
      cameraOffTargetWarning({
        cameraPlacementActive: true,
        model: offCentre.record,
        jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
        jobBounds: corner,
      }),
    ).toBeNull();
  });

  it('reaches the warnings of Start through the real preparation', () => {
    const base = createProject();
    const project: Project = {
      ...base,
      device: { ...base.device, homing: { ...base.device.homing, enabled: true } },
      scene: {
        ...EMPTY_SCENE,
        layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), power: 10 }],
        objects: [
          {
            kind: 'imported-svg',
            id: 'corner-part',
            source: 'corner.svg',
            bounds: { minX: 10, minY: 10, maxX: 30, maxY: 30 },
            transform: IDENTITY_TRANSFORM,
            paths: [
              {
                color: '#ff0000',
                polylines: [
                  {
                    closed: false,
                    points: [
                      { x: 10, y: 10 },
                      { x: 30, y: 30 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const result = prepareStartJob(
      project,
      { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true },
      {
        statusReport: {
          state: 'Idle',
          subState: null,
          mPos: { x: 0, y: 0, z: 0 },
          wPos: null,
          feed: 0,
          spindle: 0,
          wco: null,
        },
        alarmCode: null,
        hasActiveStreamer: false,
        homingState: 'confirmed',
        cameraPlacementActive: true,
        cameraCalibration: offCentre.record,
        frameVerification: frameVerificationForProject(project),
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toContainEqual(
        expect.stringContaining('part of this job lies where the camera calibration is estimated'),
      );
    }
  });
});

describe('the canvas tints where the picture is estimated', () => {
  const view = computeView(800, 600, 400, 400, { zoomFactor: 1, panX: 0, panY: 0 });

  it('tints the cells past the limit, with how far off they may be', async () => {
    const host = await mountControl(
      <CameraEstimatedArea model={offCentre.record} view={view} width={800} height={600} />,
    );
    expect(
      host.querySelectorAll('[data-testid="camera-estimated-area"] rect').length,
    ).toBeGreaterThan(0);
    expect(host.textContent).toMatch(
      /estimated here, not measured, and may be up to about \d+(\.\d)? mm off/,
    );
  });

  it('draws nothing for a calibration good over the whole bed', async () => {
    const host = await mountControl(
      <CameraEstimatedArea model={wholeBed.record} view={view} width={800} height={600} />,
    );
    expect(host.textContent).toBe('');
  });
});
