// ADR-441 Amendment 14 (the maintainer's choice on camera audit v2 K2-P2-1,
// "Follow material, save it"): the camera picture's Material height follows
// the job material's thickness and is kept between sessions, together with
// what it was set for (Amendment 15).

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

  it('keeps a height set by hand until the material changes', () => {
    setMaterial(3);
    const stop = followMaterialHeight();
    useCameraStore.getState().setSurfaceHeightMm(4.5);
    expect(savedMaterialHeight()).toEqual({ heightMm: 4.5, setFor: 'material:3' });
    setMaterial(6);
    expect(height()).toBe(6);
    stop();
  });

  // Camera audit v2 K6-P1-1 (ADR-441 Amendment 15): an 85 mm height kept from
  // a tumbler job came back for the next project, which named no material, and
  // drew a flat job's picture 46-83 mm off with nothing said.
  it('starts a project that names no material at 0 mm, whatever was kept', () => {
    setRotary(true);
    const first = followMaterialHeight();
    useCameraStore.getState().setSurfaceHeightMm(85);
    first();
    // The next session: the same rotary part gets its height back.
    useCameraStore.setState(initialCamera);
    const second = followMaterialHeight();
    expect(height()).toBe(85);
    // A new project names no material and has no rotary on: 0 mm.
    setRotary(false);
    useStore.getState().newProject();
    expect(height()).toBe(0);
    second();
    // And so does the session after it.
    useCameraStore.getState().setSurfaceHeightMm(85);
    useCameraStore.setState(initialCamera);
    const third = followMaterialHeight();
    expect(height()).toBe(0);
    third();
  });

  it('starts an opened project at its material, and another rotary part at 0 mm', () => {
    const stop = followMaterialHeight();
    useCameraStore.getState().setSurfaceHeightMm(85);
    useStore.getState().newProject();
    expect(height()).toBe(0);
    setMaterial(18);
    expect(height()).toBe(18);
    const project = useStore.getState().project;
    useStore.setState({
      project: {
        ...project,
        device: {
          ...project.device,
          rotary: { enabled: true, type: 'chuck', mmPerRotation: 360, objectDiameterMm: 60 },
        },
      },
      projectDocumentEpoch: useStore.getState().projectDocumentEpoch + 1,
    });
    expect(height()).toBe(0);
    stop();
  });

  it('reads a height saved as a plain number by an older version as nothing kept', () => {
    localStorage.setItem(MATERIAL_HEIGHT_KEY, '85');
    expect(savedMaterialHeight()).toBeNull();
    const stop = followMaterialHeight();
    expect(height()).toBe(0);
    stop();
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
