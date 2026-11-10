// ADR-699 golden programs: a 3D Sliced depth map and a ramped Fill stamp
// plate through the SHIPPED composition (emitGcode: guard → compileJob →
// placement → optimizer → strategy → preflight), byte-pinned, plus the burn
// facts each program must hold whatever its bytes.

import { describe, expect, it } from 'vitest';
import {
  collectG1SValues,
  expectedS,
  findLaserOnTravelIssues,
  findOutOfBoundsCoords,
} from '../../core/invariants';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { emitGcode } from './emit-gcode';

const SLICES = 4;
const DEPTH_POWER = 40;

// Two rows of five pixels, black to white and back: darkness 255 .. 0.
function depthMap(): SceneObject {
  return {
    kind: 'raster-image',
    id: 'D1',
    source: 'depth.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: 'AECAv///v4BAAA==',
    pixelWidth: 5,
    pixelHeight: 2,
    bounds: { minX: 100, minY: 100, maxX: 105, maxY: 102 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: '3d-sliced',
    linesPerMm: 1,
  };
}

function slicedProject(): Project {
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [depthMap()],
      layers: [
        {
          ...createLayer({ id: 'depth', color: '#808080', mode: 'image' }),
          ditherAlgorithm: '3d-sliced',
          linesPerMm: 1,
          passes: SLICES,
          power: DEPTH_POWER,
          speed: 2000,
        },
      ],
    },
  };
}

// A 12 mm stamp plate with a 4 mm square letter hole.
function stampPlate(): SceneObject {
  const square = (min: number, size: number) => ({
    closed: true,
    points: [
      { x: min, y: min },
      { x: min + size, y: min },
      { x: min + size, y: min + size },
      { x: min, y: min + size },
      { x: min, y: min },
    ],
  });
  return {
    kind: 'imported-svg',
    id: 'P1',
    source: 'stamp.svg',
    bounds: { minX: 50, minY: 50, maxX: 62, maxY: 62 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#0000ff', polylines: [square(50, 12), square(54, 4)] }],
  };
}

function rampLayer(settings: Partial<Layer> = {}): Layer {
  return {
    ...createLayer({ id: 'stamp', color: '#0000ff', mode: 'fill' }),
    hatchSpacingMm: 1,
    power: 80,
    minPower: 20,
    speed: 3000,
    fillRampLengthMm: 2,
    ...settings,
  };
}

function rampProject(settings: Partial<Layer> = {}): Project {
  return {
    ...createProject(),
    scene: { ...EMPTY_SCENE, objects: [stampPlate()], layers: [rampLayer(settings)] },
  };
}

function holdsSafetyInvariants(project: Project, gcode: string): void {
  expect(findLaserOnTravelIssues(gcode)).toEqual([]);
  expect(
    findOutOfBoundsCoords(gcode, {
      width: project.device.bedWidth,
      height: project.device.bedHeight,
    }),
  ).toEqual([]);
}

describe('ADR-699 3D Sliced golden program', () => {
  it('byte-pins the four-slice program', () => {
    const { gcode, preflight } = emitGcode(slicedProject());
    expect(preflight.ok).toBe(true);
    expect(gcode).toMatchSnapshot();
  });

  it('burns only at full power, once per slice, and stays safe', () => {
    const project = slicedProject();
    const { gcode } = emitGcode(project);
    const on = expectedS(DEPTH_POWER, project.device.maxPowerS);
    for (const s of collectG1SValues(gcode)) expect([0, on]).toContain(s);
    // One raster section per slice.
    expect(gcode.match(/^; image layer depth /gm)).toHaveLength(SLICES);
    holdsSafetyInvariants(project, gcode);
  });
});

describe('ADR-699 Fill Ramp golden program', () => {
  it('byte-pins the ramped stamp plate, outer edge square', () => {
    const { gcode, preflight } = emitGcode(rampProject());
    expect(preflight.ok).toBe(true);
    expect(gcode).toMatchSnapshot();
  });

  it('byte-pins the ramped stamp plate, outer edge ramped', () => {
    const { gcode } = emitGcode(rampProject({ fillRampOuterEdge: true }));
    expect(gcode).toMatchSnapshot();
  });

  it('grades power between Min power and Power and stays safe', () => {
    const project = rampProject();
    const { gcode } = emitGcode(project);
    const burning = collectG1SValues(gcode).filter((s) => s > 0);
    const full = expectedS(80, project.device.maxPowerS);
    const floor = expectedS(20, project.device.maxPowerS);
    expect(Math.max(...burning)).toBe(full);
    expect(Math.min(...burning)).toBeGreaterThan(floor);
    expect(new Set(burning).size).toBeGreaterThan(2);
    holdsSafetyInvariants(project, gcode);
  });

  it('is deterministic', () => {
    expect(emitGcode(rampProject()).gcode).toBe(emitGcode(rampProject()).gcode);
    expect(emitGcode(slicedProject()).gcode).toBe(emitGcode(slicedProject()).gcode);
  });
});
