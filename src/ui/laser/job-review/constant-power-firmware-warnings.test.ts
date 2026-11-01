import { describe, expect, it } from 'vitest';
import type { GrblBuildInfo } from '../../../core/controllers/grbl/build-info';
import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  type DeviceProfile,
} from '../../../core/devices';
import { compileJob } from '../../../core/job';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../../core/scene';
import { detectConstantPowerFirmwareWarnings } from './constant-power-firmware-warnings';

// ADR-257 Amendment 1: the connected controller's `$I` version sharpens the
// constant-power advice in Job Review.

const COLOR = '#ff0000';

function lineProject(device: DeviceProfile): Project {
  const points = [
    { x: 10, y: 10 },
    { x: 20, y: 10 },
    { x: 20, y: 20 },
  ];
  return {
    ...createProject(device),
    scene: {
      layers: [createLayer({ id: COLOR, name: 'Outline', color: COLOR })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'path',
          source: 'path.svg',
          bounds: { minX: 10, minY: 10, maxX: 20, maxY: 20 },
          transform: IDENTITY_TRANSFORM,
          paths: [{ color: COLOR, polylines: [{ points, closed: false }] }],
        },
      ],
    },
  };
}

function build(protocolVersion: string): GrblBuildInfo {
  return {
    protocolVersion,
    buildRevision: '20190830',
    userInfo: '',
    optionCodes: ['V'],
    plannerBufferBlocks: 15,
    rxBufferBytes: 128,
  };
}

function review(device: DeviceProfile, buildInfo: GrblBuildInfo | null, observedEpoch = 3) {
  const project = lineProject(device);
  return detectConstantPowerFirmwareWarnings({
    prepared: { prepared: { job: compileJob(project.scene, project.device) } },
    project,
    laserModeStartSnapshot: {
      controllerSessionEpoch: 3,
      controllerBuildInfo: buildInfo,
      buildInfoObservation: { sessionEpoch: observedEpoch, observedAt: 0 },
    },
  });
}

const GRBL_COMPATIBLE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'grbl-v1.1',
  gcodeDialect: { dialectId: 'grbl-compatible' },
};

describe('Job Review firmware sharpening of the constant-power advice', () => {
  it('names GRBL Dynamic when the controller reports GRBL 1.1f or newer', () => {
    const [line] = review(GRBL_COMPATIBLE, build('1.1h'));
    expect(line).toContain('reports GRBL 1.1h, which supports dynamic power (M4)');
    expect(line).toContain('choose GRBL Dynamic in Machine Setup');
    expect(review(GRBL_COMPATIBLE, build('1.1f'))).toHaveLength(1);
  });

  it('names the Line Power mode on the 4040, whose dialect stays as it is', () => {
    const [line] = review(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, build('1.1h'));
    expect(line).toContain("set the Line operations' Power mode to Dynamic (M4)");
  });

  it('keeps constant power for GRBL 1.1e and older, as LightBurn does', () => {
    const [line] = review(GRBL_COMPATIBLE, build('1.1e'));
    expect(line).toContain('reports GRBL 1.1e');
    expect(line).toContain('keep constant power here and lower the speed');
  });

  it('says nothing without current `$I` evidence or without constant-power advice', () => {
    expect(review(GRBL_COMPATIBLE, null)).toEqual([]);
    expect(review(GRBL_COMPATIBLE, build('1.1h'), 2)).toEqual([]);
    const dynamic = { ...GRBL_COMPATIBLE, gcodeDialect: { dialectId: 'grbl-dynamic' as const } };
    expect(review(dynamic, build('1.1h'))).toEqual([]);
  });
});
