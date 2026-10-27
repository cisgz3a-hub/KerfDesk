import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { frameVerificationForProject } from './frame-verification-testing';
import { prepareStartJob } from './start-job-readiness';
import { demotedPolicyWarnings, PLACE_BOARD_ABSOLUTE_WARNING } from './start-job-readiness-policy';

const READY_CONTROLLER = { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true };
const IDLE_STATUS = {
  state: 'Idle' as const,
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};
const READY_MACHINE = { statusReport: IDLE_STATUS, alarmCode: null, hasActiveStreamer: false };

function cameraProject(homingEnabled: boolean): Project {
  const base = createProject();
  return {
    ...base,
    device: { ...base.device, homing: { ...base.device.homing, enabled: homingEnabled } },
    scene: {
      ...EMPTY_SCENE,
      layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), power: 10 }],
      objects: [
        {
          kind: 'imported-svg',
          id: 'camera-part',
          source: 'camera-part.svg',
          bounds: { minX: 10, minY: 10, maxX: 20, maxY: 20 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 10, y: 10 },
                    { x: 20, y: 20 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

// Frame-first (ADR-228): the camera Start gates (absolute-mode requirement,
// home / position-epoch proof) are deleted; the watched Frame trace is the
// placement proof. ADR-228 Amendment (camera placement start-from): a relative
// Start from is said in Job Review, because the camera picture shows absolute
// bed positions, and it still never refuses.
describe('Start camera-placement integration', () => {
  it('starts a camera-placed job on a relative origin once framed, and says where it burns', () => {
    const project = cameraProject(true);
    const wco = { x: 15, y: 25, z: 0 };
    const result = prepareStartJob(
      project,
      READY_CONTROLLER,
      {
        ...READY_MACHINE,
        cameraPlacementActive: true,
        homingState: 'confirmed',
        workOriginActive: true,
        wcoCache: wco,
        frameVerification: frameVerificationForProject(project, {
          jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
          wco,
          workOriginActive: true,
        }),
      },
      { startFrom: 'user-origin', anchor: 'front-left' },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toContainEqual(
        expect.stringContaining('Camera placement is on, but Start from is User Origin.'),
      );
    }
  });

  it('says nothing about Start from for a camera-placed job at Absolute Coordinates', () => {
    const project = cameraProject(true);
    const result = prepareStartJob(project, READY_CONTROLLER, {
      ...READY_MACHINE,
      cameraPlacementActive: true,
      homingState: 'confirmed',
      frameVerification: frameVerificationForProject(project),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.some((w) => w.includes('Camera placement is on'))).toBe(false);
    }
  });

  it('starts without a completed Home on a homing-capable machine once framed', () => {
    const project = cameraProject(true);
    const result = prepareStartJob(project, READY_CONTROLLER, {
      ...READY_MACHINE,
      cameraPlacementActive: true,
      homingState: 'unknown',
      frameVerification: frameVerificationForProject(project),
    });

    expect(result.ok).toBe(true);
  });

  it('starts without an epoch-bound confirmation on a no-homing machine once framed', () => {
    const project = cameraProject(false);
    const result = prepareStartJob(project, READY_CONTROLLER, {
      ...READY_MACHINE,
      cameraPlacementActive: true,
      homingState: 'unknown',
      trustedPositionEpoch: 9,
      cameraConfirmedPositionEpoch: 8,
      frameVerification: frameVerificationForProject(project),
    });

    expect(result.ok).toBe(true);
  });
});

// Rolling audit v4 H6-P3-2 (ADR-654 Amendment 3): a Place Board job is laid
// out on the board's outline, which Place Board centres on the canvas, and
// burns on the registered board from User Origin. The camera warning told it
// to choose Absolute Coordinates, which burns it at the centred outline, off
// the board.
describe('Start camera-placement on a Place Board job', () => {
  function placeBoardProject(): Project {
    resetStore();
    useStore.setState({ project: cameraProject(true) });
    useStore.getState().addCapturedBoard({ kind: 'rect', widthMm: 100, heightMm: 50 });
    const { project, jobPlacement } = useStore.getState();
    // Place Board registers the board at User Origin, front-left (ADR-654 Decision 5).
    expect(jobPlacement).toEqual({ startFrom: 'user-origin', anchor: 'front-left' });
    return project;
  }
  const latched = { ...READY_MACHINE, cameraPlacementActive: true };

  it('says the job burns on the board at User Origin, and never advises Absolute Coordinates', () => {
    const warnings = demotedPolicyWarnings(placeBoardProject(), latched, {
      startFrom: 'user-origin',
      anchor: 'front-left',
    });
    const camera = warnings.filter((warning) => warning.includes('Camera placement is on'));
    expect(camera).toHaveLength(1);
    expect(camera[0]).toContain(
      'It burns on the board that Place Board registered at User Origin. Lay the artwork out on the outline, not on the board in the camera picture',
    );
    expect(warnings.join(' ')).not.toContain('Choose Absolute Coordinates');
  });

  it('points another relative Start from back to User Origin, not to Absolute', () => {
    const warnings = demotedPolicyWarnings(placeBoardProject(), latched, {
      startFrom: 'verified-origin',
      anchor: 'front-left',
    });
    expect(warnings).toContainEqual(
      expect.stringContaining(
        'It burns where Verified Origin puts the outline, not on the board that Place Board registered at User Origin. Choose User Origin to burn it on the board',
      ),
    );
    expect(warnings.join(' ')).not.toContain('Choose Absolute Coordinates');
  });

  it('warns in Job Review that Absolute Coordinates burn it at the outline, off the board, camera or not', () => {
    const project = placeBoardProject();
    for (const machine of [READY_MACHINE, latched]) {
      const result = prepareStartJob(project, READY_CONTROLLER, {
        ...machine,
        homingState: 'confirmed',
        frameVerification: frameVerificationForProject(project),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.warnings).toContain(PLACE_BOARD_ABSOLUTE_WARNING);
        expect(result.warnings.some((w) => w.includes('Camera placement is on'))).toBe(false);
      }
    }
  });

  it('says nothing about Place Board for a job without a board outline', () => {
    const warnings = demotedPolicyWarnings(cameraProject(true), READY_MACHINE, undefined);
    expect(warnings).not.toContain(PLACE_BOARD_ABSOLUTE_WARNING);
  });
});
