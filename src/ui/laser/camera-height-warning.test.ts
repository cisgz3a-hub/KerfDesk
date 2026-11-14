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
      expect(warning).toContain('at least 80 mm above the bed');
    }
    // Set to the top of the part (axis 45 mm up + 40 mm radius): nothing to say.
    expect(cameraHeightWarnings(tumbler, placed(85), undefined)).toEqual([]);
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
    expect(
      cameraHeightWarnings(project({}), { ...machine, cameraSurfaceHeightMm: 3 }, undefined),
    ).toEqual([]);
  });

  it('says nothing without camera placement', () => {
    const tumbler = project({ rotaryDiameterMm: 80, thicknessMm: 3 });
    expect(
      cameraHeightWarnings(tumbler, { ...placed(0), cameraPlacementActive: false }, undefined),
    ).toEqual([]);
  });
});
