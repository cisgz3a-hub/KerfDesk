// Controller audit SM-3/SM-2 at the Frame/Start preparation boundary: the
// connection's laser-module report reaches the machine snapshot that Frame and
// Start preparation compile against. An absent module is refused as a fact for
// laser projects; a build without M221 P is a Job Review warning.

import { afterEach, describe, expect, it } from 'vitest';
import {
  CONSTANT_POWER_UNSUPPORTED_MESSAGE,
  LASER_MODULE_ABSENT_MESSAGE,
} from '../../core/preflight/laser-module-readiness';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { startControllerPolicy } from './start-job-controller-policy';
import { findMachineStartIssues } from './start-job-input';
import { machineSnapshot } from './start-machine-snapshot';

const OBSERVED = { rawLines: [], sessionEpoch: 1 };
const ABSENT = { module: 'absent', constantPowerMode: null, ...OBSERVED } as const;
const PRE_2021 = { module: 'loaded', constantPowerMode: false, ...OBSERVED } as const;
const NO_CONTROLLER_FINDINGS = { ok: true, errors: [], warnings: [] };

afterEach(() => {
  resetStore();
});

function snapshotWith(
  laserModuleEvidence: typeof ABSENT | typeof PRE_2021,
  connected = true,
  cnc = false,
) {
  const project = useStore.getState().project;
  return machineSnapshot(
    cnc ? { ...project, machine: DEFAULT_CNC_MACHINE_CONFIG } : project,
    {
      ...useLaserStore.getState(),
      connection: connected ? { kind: 'connected' } : { kind: 'disconnected' },
      laserModuleEvidence,
    },
    useCameraStore.getState(),
  );
}

describe('the laser module report in Frame and Start preparation', () => {
  it('refuses a laser job on a connected board without the Laser module', () => {
    const snapshot = snapshotWith(ABSENT);
    expect(snapshot.laserOutputRefusal).toBe(LASER_MODULE_ABSENT_MESSAGE);
    expect(findMachineStartIssues(snapshot)).toContain(LASER_MODULE_ABSENT_MESSAGE);
  });

  it('refuses nothing for a CNC project, a disconnected board or a loaded module', () => {
    expect(snapshotWith(ABSENT, true, true).laserOutputRefusal).toBeNull();
    expect(snapshotWith(ABSENT, false).laserOutputRefusal).toBeNull();
    expect(snapshotWith(PRE_2021).laserOutputRefusal).toBeNull();
    expect(findMachineStartIssues(snapshotWith(PRE_2021))).not.toContain(
      LASER_MODULE_ABSENT_MESSAGE,
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
