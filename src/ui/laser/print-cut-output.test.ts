import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject } from '../../core/scene';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { currentPrintCutOutputRegistration } from './print-cut-output';

const targets = { first: { x: 0, y: 0 }, second: { x: 10, y: 0 } };

describe('currentPrintCutOutputRegistration', () => {
  afterEach(() => {
    useExperimentalLaserFeatures.getState().setFeature('printAndCut', false);
  });

  it('still refuses a laser job whose saved targets have no usable capture', () => {
    const laser = { ...createProject(), printAndCutTargets: targets };
    expect(currentPrintCutOutputRegistration(laser)).toBeNull();
  });

  it.each([false, true])(
    'leaves a CNC job alone when laser Print and Cut targets are saved (Labs on=%s)',
    (labsOn) => {
      useExperimentalLaserFeatures.getState().setFeature('printAndCut', labsOn);
      const cnc = {
        ...createProject(),
        machine: DEFAULT_CNC_MACHINE_CONFIG,
        printAndCutTargets: targets,
      };
      expect(currentPrintCutOutputRegistration(cnc)).toBeUndefined();
    },
  );
});
