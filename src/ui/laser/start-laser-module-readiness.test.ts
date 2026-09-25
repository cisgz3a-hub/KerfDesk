// Controller audit SM-3/SM-2 at the Frame/Start preparation boundary: the
// connection's laser-module report reaches the machine snapshot that Frame and
// Start preparation compile against. A board without the Laser module is a Job
// Review warning for laser projects, never a refusal (PROJECT.md
// non-negotiable 21, ADR-397), and its program leaves out the `fire off` that
// nothing would answer. A build without M221 P is a Job Review warning.

import { afterEach, describe, expect, it } from 'vitest';
import {
  CONSTANT_POWER_UNSUPPORTED_MESSAGE,
  LASER_MODULE_ABSENT_JOB_WARNING,
} from '../../core/preflight/laser-module-readiness';
import {
  createLayer,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { frameVerificationForProject } from './frame-verification-testing';
import { startControllerPolicy } from './start-job-controller-policy';
import { findMachineStartIssues } from './start-job-input';
import { demotedPolicyWarnings } from './start-job-readiness-policy';
import { prepareStartJob } from './start-job-readiness';
import { machineSnapshot } from './start-machine-snapshot';

const OBSERVED = { rawLines: [], sessionEpoch: 1 };
const ABSENT = { module: 'absent', constantPowerMode: null, ...OBSERVED } as const;
const PRE_2021 = { module: 'loaded', constantPowerMode: false, ...OBSERVED } as const;
const NO_CONTROLLER_FINDINGS = { ok: true, errors: [], warnings: [] };

const LINE: SceneObject = {
  kind: 'imported-svg',
  id: 'laser-module-line',
  source: 'laser-module-line.svg',
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

afterEach(() => {
  resetStore();
});

function smoothieProject(cnc = false): Project {
  const project = useStore.getState().project;
  return {
    ...project,
    ...(cnc ? { machine: DEFAULT_CNC_MACHINE_CONFIG } : {}),
    device: { ...project.device, controllerKind: 'smoothieware', maxPowerS: 1 },
    scene: {
      ...EMPTY_SCENE,
      objects: [LINE],
      layers: [createLayer({ id: 'laser-module-layer', color: '#ff0000' })],
    },
  };
}

function snapshotWith(
  laserModuleEvidence: typeof ABSENT | typeof PRE_2021,
  project: Project = smoothieProject(),
  connected = true,
) {
  return machineSnapshot(
    project,
    {
      ...useLaserStore.getState(),
      connection: connected ? { kind: 'connected' } : { kind: 'disconnected' },
      laserModuleEvidence,
    },
    useCameraStore.getState(),
  );
}

describe('the laser module report in Frame and Start preparation', () => {
  it('warns, and refuses nothing, for a laser job on a board without the Laser module', () => {
    const snapshot = snapshotWith(ABSENT);
    expect(snapshot.laserModuleReport).toMatchObject({ module: 'absent' });
    expect(findMachineStartIssues(snapshot)).toEqual(
      findMachineStartIssues(snapshotWith(PRE_2021)),
    );
    expect(demotedPolicyWarnings(smoothieProject(), snapshot)).toContain(
      LASER_MODULE_ABSENT_JOB_WARNING,
    );
  });

  it('prepares a program without `fire off` and states why in Job Review', () => {
    const project = smoothieProject();
    const machine = {
      ...snapshotWith(ABSENT, project),
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
      frameVerification: frameVerificationForProject(project),
    } as const;
    const prepared = prepareStartJob(project, null, machine);
    if (!prepared.ok) throw new Error(prepared.messages.join('\n'));
    expect(prepared.gcode.split('\n')).not.toContain('fire off');
    expect(prepared.warnings).toContain(LASER_MODULE_ABSENT_JOB_WARNING);

    const withModule = prepareStartJob(project, null, { ...machine, laserModuleReport: PRE_2021 });
    if (!withModule.ok) throw new Error(withModule.messages.join('\n'));
    expect(withModule.gcode.split('\n')[0]).toBe('fire off');
    expect(withModule.warnings).not.toContain(LASER_MODULE_ABSENT_JOB_WARNING);
  });

  it('stays silent for a CNC project, a disconnected board or a loaded module', () => {
    const cnc = smoothieProject(true);
    expect(demotedPolicyWarnings(cnc, snapshotWith(ABSENT, cnc))).not.toContain(
      LASER_MODULE_ABSENT_JOB_WARNING,
    );
    const disconnected = snapshotWith(ABSENT, smoothieProject(), false);
    expect(demotedPolicyWarnings(smoothieProject(), disconnected)).not.toContain(
      LASER_MODULE_ABSENT_JOB_WARNING,
    );
    expect(demotedPolicyWarnings(smoothieProject(), snapshotWith(PRE_2021))).not.toContain(
      LASER_MODULE_ABSENT_JOB_WARNING,
    );
  });

  it('adds a Job Review warning for constant-power output on a build without M221 P', () => {
    const snapshot = snapshotWith(PRE_2021);
    const constant = startControllerPolicy(
      NO_CONTROLLER_FINDINGS,
      'M400\nM221 S100 P1\nG1 X10 F600 S0.5\n',
      snapshot,
    );
    expect(constant.advisories).toContain(CONSTANT_POWER_UNSUPPORTED_MESSAGE);
    const proportional = startControllerPolicy(
      NO_CONTROLLER_FINDINGS,
      'M400\nM221 S100 P0\nG1 X10 F600 S0.5\n',
      snapshot,
    );
    expect(proportional.advisories).not.toContain(CONSTANT_POWER_UNSUPPORTED_MESSAGE);
  });
});
