// Camera audit v2 K2-P1-2, K2-P2-1 and K1-P2-2 (ADR-441 Amendment 13): the
// camera picture lines up with what is on the bed only at the overlay's
// Material height. Job Review says when the project knows that height is
// wrong: a rotary part's top, the job material's thickness, or a calibration
// that lines up only at its target's height.

import { describe, expect, it } from 'vitest';
import { savedCameraModel } from '../../core/camera/model/model-fixtures';
import { createProject, type Project } from '../../core/scene';
import { cameraHeightIssues } from '../camera/camera-height-rule';
import { cameraHeightWarnings } from './camera-height-warning';

const base = createProject();

function project(over: {
  readonly rotaryDiameterMm?: number;
  readonly thicknessMm?: number;
}): Project {
  return {
    ...base,
    device: {
      ...base.device,
      ...(over.rotaryDiameterMm === undefined
        ? {}
        : {
            rotary: {
              enabled: true,
              type: 'chuck' as const,
              mmPerRotation: 360,
              objectDiameterMm: over.rotaryDiameterMm,
            },
          }),
    },
    jobSetup: {
      ...base.jobSetup,
      ...(over.thicknessMm === undefined
        ? {}
        : {
            laserMaterial: {
              name: 'Birch plywood',
              thicknessMm: over.thicknessMm,
              autoApplyRecipes: false,
            },
          }),
    },
  };
}

const placed = (heightMm: number) => ({
  cameraPlacementActive: true,
  cameraCalibration: savedCameraModel(),
  cameraSurfaceHeightMm: heightMm,
});

describe('cameraHeightIssues', () => {
  it('takes a Material height within a millimetre as set', () => {
    const facts = {
      surfaceHeightMm: 6.5,
      rotaryDiameterMm: null,
      materialThicknessMm: 6,
      onlyAtTargetHeightMm: null,
    };
    expect(cameraHeightIssues(facts)).toEqual([]);
    expect(cameraHeightIssues({ ...facts, surfaceHeightMm: 0 })).toEqual([
      { kind: 'material', surfaceHeightMm: 0, thicknessMm: 6 },
    ]);
  });
});

describe('cameraHeightWarnings in Job Review', () => {
  it('warns that a rotary part lines up only at its top, from any Start from', () => {
    const tumbler = project({ rotaryDiameterMm: 80 });
    for (const origin of [undefined, { startFrom: 'current-position' } as never]) {
      const [warning] = cameraHeightWarnings(tumbler, placed(0), origin);
      expect(warning).toContain('the camera picture lines up with the part only at the part');
      expect(warning).toContain('so at least 83 mm');
    }
    // Set to the top of the part (axis 45 mm up + 40 mm radius): nothing to say.
    expect(cameraHeightWarnings(tumbler, placed(85), undefined)).toEqual([]);
  });

  // Camera audit v2 K6-P3-2: the diameter itself was taken as the top, so 80 mm
  // on an 80 mm tumbler whose top was 85 mm drew the picture 5.4 mm off, unsaid.
  it('does not take a rotary part’s diameter as its top', () => {
    const tumbler = project({ rotaryDiameterMm: 80 });
    expect(cameraHeightWarnings(tumbler, placed(80), undefined)).toHaveLength(1);
  });

  // Camera audit v2 K6-P1-1 (ADR-441 Amendment 15): with no material named there
  // was nothing to compare with, so a height kept from a tumbler job went unsaid.
  it('says when a project that names no material is drawn above the bed', () => {
    const [warning] = cameraHeightWarnings(project({}), placed(85), undefined);
    expect(warning).toContain('this project names no material');
    expect(warning).toContain('85 mm');
    expect(cameraHeightWarnings(project({}), placed(0), undefined)).toEqual([]);
    expect(cameraHeightWarnings(project({}), placed(0.5), undefined)).toEqual([]);
  });

  it('warns when the job material is thicker than the Material height', () => {
    const plywood = project({ thicknessMm: 18 });
    const [warning] = cameraHeightWarnings(plywood, placed(0), undefined);
    expect(warning).toContain("this job's material is 18 mm thick");
    expect(cameraHeightWarnings(plywood, placed(18), undefined)).toEqual([]);
    // A relative Start from places the job by its origin, which Job Review says already.
    expect(cameraHeightWarnings(plywood, placed(0), { startFrom: 'user-origin' } as never)).toEqual(
      [],
    );
  });

  it('warns for a calibration that lines up only at its target height', () => {
    const record = savedCameraModel();
    const heightOnly = {
      ...record,
      accuracy: { ...record.accuracy, onlyAtTargetHeight: true as const, targetHeightMm: 3 },
    };
    const machine = { ...placed(20), cameraCalibration: heightOnly };
    const [warning] = cameraHeightWarnings(project({}), machine, undefined);
    expect(warning).toContain('lines up only at the height of its target sheet (3 mm)');
    // At its target height only the missing material is left to say.
    const atTarget = cameraHeightWarnings(
      project({}),
      { ...machine, cameraSurfaceHeightMm: 3 },
      undefined,
    );
    expect(atTarget).toHaveLength(1);
    expect(atTarget[0]).toContain('this project names no material');
  });

  it('says nothing without camera placement', () => {
    const tumbler = project({ rotaryDiameterMm: 80, thicknessMm: 3 });
    expect(
      cameraHeightWarnings(tumbler, { ...placed(0), cameraPlacementActive: false }, undefined),
    ).toEqual([]);
  });
});
