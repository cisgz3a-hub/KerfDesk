// ADR-441 Amendment 14 (the maintainer's choice on camera audit v2 K2-P2-1,
// "Follow material, save it"): the camera picture's Material height follows
// the job material's thickness and is kept between sessions.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { resetStore } from '../../state/test-helpers';
import { followMaterialHeight, MATERIAL_HEIGHT_KEY, savedMaterialHeight } from './material-height';

const initialCamera = useCameraStore.getState();

function setMaterial(thicknessMm: number | undefined): void {
  const project = useStore.getState().project;
  const { laserMaterial: _drop, ...jobSetup } = project.jobSetup;
  useStore.setState({
    project: {
      ...project,
      jobSetup:
        thicknessMm === undefined
          ? jobSetup
          : {
              ...jobSetup,
              laserMaterial: { name: 'Birch plywood', thicknessMm, autoApplyRecipes: false },
            },
    },
  });
}

function setRotary(on: boolean): void {
  const project = useStore.getState().project;
  const { rotary: _drop, ...device } = project.device;
  useStore.setState({
    project: {
      ...project,
      device: on
        ? {
            ...device,
            rotary: { enabled: true, type: 'chuck', mmPerRotation: 360, objectDiameterMm: 80 },
          }
        : device,
    },
  });
}

const height = (): number => useCameraStore.getState().surfaceHeightMm;

beforeEach(() => {
  localStorage.clear();
  resetStore();
  useCameraStore.setState(initialCamera);
});

afterEach(() => {
  useCameraStore.setState(initialCamera);
});

describe('followMaterialHeight', () => {
  it('starts at the job material thickness, and follows a new material', () => {
    setMaterial(6);
    const stop = followMaterialHeight();
    expect(height()).toBe(6);
    setMaterial(18);
    expect(height()).toBe(18);
    stop();
  });

  it('keeps a height set by hand into the next session, until the material changes', () => {
    const first = followMaterialHeight();
    useCameraStore.getState().setSurfaceHeightMm(4.5);
    first();
    expect(savedMaterialHeight()).toBe(4.5);
    // The next session, with no material named: the kept height.
    useCameraStore.setState(initialCamera);
    const second = followMaterialHeight();
    expect(height()).toBe(4.5);
    setMaterial(3);
    expect(height()).toBe(3);
    expect(localStorage.getItem(MATERIAL_HEIGHT_KEY)).toBe('3');
    second();
  });

  it('leaves the height alone while a rotary applies', () => {
    setRotary(true);
    setMaterial(6);
    const stop = followMaterialHeight();
    expect(height()).toBe(0);
    setMaterial(12);
    expect(height()).toBe(0);
    stop();
  });
});
