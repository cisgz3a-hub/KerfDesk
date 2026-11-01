import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  findRegistrationBoxes,
  IDENTITY_TRANSFORM,
  registrationRunState,
  type Project,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
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

// Rolling audit v5 J5-P2-1 (ADR-654 Amendment 4, ADR-057 Amendment 6): a
// registration jig anchors both runs to its outline. Its artwork run, with the
// camera picture latched, was told to choose Absolute Coordinates, which burns
// the artwork about 198 mm from the outline run 1 burned at User Origin.
describe('Start camera-placement on a registration jig job', () => {
  const USER_ORIGIN = { startFrom: 'user-origin', anchor: 'front-left' } as const;
  const ABSOLUTE = { startFrom: 'absolute', anchor: 'front-left' } as const;

  function jigProject(run: 'box' | 'artwork' = 'artwork'): Project {
    resetStore();
    useStore.setState({ project: cameraProject(true) });
    useStore.getState().addRegistrationBox(100, 60);
    useStore.getState().drawShape(
      createRectangle({
        id: 'jig-art',
        color: '#0000ff',
        transform: { ...IDENTITY_TRANSFORM, x: 190, y: 190 },
        spec: { widthMm: 20, heightMm: 20, cornerRadiusMm: 0 },
      }),
    );
    useStore.getState().setRegistrationOutput(run);
    const { project } = useStore.getState();
    expect(registrationRunState(project.scene)).toBe(run);
    expect(findRegistrationBoxes(project.scene)[0]?.provenance).toBeUndefined();
    return project;
  }
  const latched = { ...READY_MACHINE, cameraPlacementActive: true };

  it('keeps the jig’s Start from and never advises Absolute Coordinates, through Start', () => {
    const project = jigProject();
    const wco = { x: 15, y: 25, z: 0 };
    const result = prepareStartJob(
      project,
      READY_CONTROLLER,
      {
        ...latched,
        homingState: 'confirmed',
        workOriginActive: true,
        wcoCache: wco,
        frameVerification: frameVerificationForProject(project, {
          jobOrigin: USER_ORIGIN,
          wco,
          workOriginActive: true,
        }),
      },
      USER_ORIGIN,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const camera = result.warnings.filter((w) => w.includes('Camera placement is on'));
    expect(camera).toEqual([
      expect.stringContaining(
        'this is a registration jig job: it burns where User Origin puts the jig outline',
      ),
    ]);
    expect(camera[0]).toContain('do not switch to Absolute Coordinates between the runs');
    expect(result.warnings.join(' ')).not.toContain('Choose Absolute Coordinates');
  });

  it('gives the outline run the same advice', () => {
    const warnings = demotedPolicyWarnings(jigProject('box'), latched, USER_ORIGIN);
    expect(warnings.join(' ')).toContain('this is a registration jig job');
    expect(warnings.join(' ')).not.toContain('Choose Absolute Coordinates');
  });

  it('warns an artwork run at Absolute Coordinates when the outline burned from User Origin', () => {
    const project = jigProject();
    for (const machine of [READY_MACHINE, latched]) {
      const result = prepareStartJob(project, READY_CONTROLLER, {
        ...machine,
        registrationOutline: USER_ORIGIN,
        homingState: 'confirmed',
        frameVerification: frameVerificationForProject(project),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.warnings).toContainEqual(
        'The jig outline burned from User Origin with the job origin at front left, but this artwork run starts from Absolute Coordinates. The artwork lands inside the burned outline only when both runs burn from the same Start from and job origin. Choose User Origin with the job origin at front left again, keep the work origin unchanged, and watch the Frame.',
      );
    }
  });

  it('names another job origin, and the outline’s Absolute Coordinates, in place of the camera advice', () => {
    const project = jigProject();
    const centre = demotedPolicyWarnings(
      project,
      { ...latched, registrationOutline: USER_ORIGIN },
      { startFrom: 'user-origin', anchor: 'center' },
    );
    expect(centre).toContainEqual(
      expect.stringContaining(
        'this artwork run starts from User Origin with the job origin at center.',
      ),
    );
    expect(centre.join(' ')).not.toContain('Camera placement is on');

    const absoluteOutline = demotedPolicyWarnings(
      project,
      { ...latched, registrationOutline: ABSOLUTE },
      USER_ORIGIN,
    );
    expect(absoluteOutline).toEqual([
      expect.stringContaining(
        'The jig outline burned from Absolute Coordinates, but this artwork run starts from User Origin',
      ),
    ]);
    expect(absoluteOutline[0]).toContain('Choose Absolute Coordinates again');
  });

  it('says nothing about the outline when the artwork run matches it, or on the outline run', () => {
    const matching = demotedPolicyWarnings(
      jigProject(),
      { ...READY_MACHINE, registrationOutline: USER_ORIGIN },
      USER_ORIGIN,
    );
    expect(matching).toEqual([]);
    const outlineRun = demotedPolicyWarnings(
      jigProject('box'),
      { ...READY_MACHINE, registrationOutline: USER_ORIGIN },
      undefined,
    );
    expect(outlineRun.join(' ')).not.toContain('The jig outline burned from');
  });
});
