import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type Origin } from '../devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
  type Vec2,
} from '../scene';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { mapToolpathToScene } from '../../ui/workspace/preview-scene-frame';
import { buildToolpath } from './toolpath';
import { compileJob } from './compile-job';
import { computeJobBounds } from './job-bounds';
import { JOB_ORIGIN_ANCHORS, type JobOriginAnchor, type JobOriginPlacement } from './job-origin';

// Independent oracle: these matrices describe the documented physical bed,
// rather than calling the production transform/jog/anchor helpers under test.
const FRAME: Record<Origin, readonly [number, number, number, number]> = {
  'front-left': [1, -1, 0, 268],
  'front-right': [-1, -1, 358, 268],
  'rear-left': [1, 1, 0, 0],
  'rear-right': [-1, 1, 358, 0],
  center: [1, -1, 179, 134],
};
const ORIGINS = Object.keys(FRAME) as Origin[];
const POINTS: readonly Vec2[] = [
  { x: 31, y: 47 },
  { x: 91, y: 47 },
  { x: 83, y: 87 },
  { x: 31, y: 87 },
];
const COLOR = '#ff0000';

function physicalToNumbers(point: Vec2, origin: Origin): Vec2 {
  const [sx, sy, tx, ty] = FRAME[origin];
  return {
    x: sx * point.x + (origin === 'center' ? -tx : tx),
    y: sy * point.y + ty,
  };
}

function sceneAnchor(anchor: JobOriginAnchor, radius = 0): Vec2 {
  const [row, column] = anchor === 'center' ? ['center', 'center'] : anchor.split('-');
  return {
    x: column === 'left' ? 31 - radius : column === 'right' ? 91 + radius : 61,
    y: row === 'front' ? 87 + radius : row === 'back' ? 47 - radius : 67,
  };
}

function projectFor(origin: Origin, cnc = false): Project {
  const device = { ...DEFAULT_DEVICE_PROFILE, origin, bedWidth: 358, bedHeight: 268 };
  const base = createProject(device);
  const layer = createLayer({ id: 'outline', color: COLOR });
  return {
    ...base,
    ...(cnc ? { machine: DEFAULT_CNC_MACHINE_CONFIG } : {}),
    optimization: { ...base.optimization, travelPolicy: 'source-order', pathDirection: 'preserve' },
    scene: {
      objects: [
        {
          kind: 'imported-svg',
          id: 'asymmetric',
          source: 'coordinate-audit.svg',
          bounds: { minX: 31, minY: 47, maxX: 91, maxY: 87 },
          transform: IDENTITY_TRANSFORM,
          paths: [{ color: COLOR, polylines: [{ closed: true, points: POINTS }] }],
        },
      ],
      layers: [
        cnc
          ? {
              ...layer,
              cnc: {
                ...DEFAULT_CNC_LAYER_SETTINGS,
                cutType: 'engrave',
                tabsEnabled: false,
              },
            }
          : layer,
      ],
    },
  };
}

function roundedPoint(point: Vec2): Vec2 {
  return { x: Math.round(point.x * 1e6) / 1e6, y: Math.round(point.y * 1e6) / 1e6 };
}

function containsRepresentedPoint(points: readonly Vec2[], expected: Vec2): boolean {
  // CNC preview intentionally follows the controller's 0.001 mm coordinates
  // and Float32 parser representation, rather than ideal unrounded vertices.
  return points.some(
    (point) =>
      Math.abs(point.x - expected.x) <= 0.00055 && Math.abs(point.y - expected.y) <= 0.00055,
  );
}

function explicitXyWords(gcode: string): Vec2[] {
  return gcode.split('\n').flatMap((line) => {
    if (line.startsWith(';')) return [];
    const x = /\bX(-?\d+(?:\.\d+)?)/.exec(line);
    const y = /\bY(-?\d+(?:\.\d+)?)/.exec(line);
    return x === null || y === null ? [] : [{ x: Number(x[1]), y: Number(y[1]) }];
  });
}

const MATRIX = ORIGINS.flatMap((origin) =>
  JOB_ORIGIN_ANCHORS.flatMap((anchor) =>
    (['absolute', 'user-origin', 'verified-origin', 'current-position'] as const).map(
      (startFrom) => ({ origin, anchor, startFrom }),
    ),
  ),
);

describe.each([false, true])('independent placement matrix, cnc=%s', (cnc) => {
  it.each(MATRIX)('$origin / $anchor / $startFrom', ({ origin, anchor, startFrom }) => {
    const project = projectFor(origin, cnc);
    const target = startFrom === 'current-position' ? { x: 123.25, y: -42.5 } : { x: 0, y: 0 };
    const placement: JobOriginPlacement =
      startFrom === 'current-position'
        ? { startFrom, anchor, currentPosition: target }
        : { startFrom, anchor };
    const prepared = prepareOutput(project, { jobOrigin: placement });
    if (!prepared.ok) throw new Error(JSON.stringify(prepared.preflight));
    const group = prepared.job.groups[0];
    const radius = group?.kind === 'cnc' ? group.toolDiameterMm / 2 : 0;
    const anchorNumber = physicalToNumbers(sceneAnchor(anchor, radius), origin);
    const offset =
      startFrom === 'absolute'
        ? { x: 0, y: 0 }
        : { x: target.x - anchorNumber.x, y: target.y - anchorNumber.y };
    expect(roundedPoint(prepared.jobOriginOffset)).toEqual(roundedPoint(offset));
    const expected = POINTS.map((point) => {
      const transformed = physicalToNumbers(point, origin);
      return roundedPoint({ x: transformed.x + offset.x, y: transformed.y + offset.y });
    });
    const toolpath = buildToolpath(prepared.job);
    const cutPoints = toolpath.steps.flatMap((step) =>
      step.kind === 'cut' ? step.polyline.map(roundedPoint) : [],
    );
    for (const point of expected) expect(containsRepresentedPoint(cutPoints, point)).toBe(true);
    const emitted = emitPreparedGcode(prepared, { jobOrigin: placement });
    const emittedPoints = explicitXyWords(emitted.gcode);
    for (const point of expected) expect(containsRepresentedPoint(emittedPoints, point)).toBe(true);
    const preview = mapToolpathToScene(toolpath, prepared.jobOriginOffset, project.device);
    const previewPoints = preview.steps.flatMap((step) =>
      step.kind === 'cut' ? step.polyline.map(roundedPoint) : [],
    );
    for (const point of POINTS) expect(containsRepresentedPoint(previewPoints, point)).toBe(true);
    expect(computeJobBounds(prepared.job, project.device)).not.toBeNull();
  });
});

describe('independent raster pixel centres across origins, rotation and mirror', () => {
  const luma = [0, 255, 255, 0, 0, 255];
  const cases = ORIGINS.flatMap((origin) =>
    [0, 90, 180, 270].flatMap((rotationDeg) =>
      [false, true].flatMap((mirrorX) =>
        [false, true].map((mirrorY) => ({ origin, rotationDeg, mirrorX, mirrorY })),
      ),
    ),
  );
  it.each(cases)('$origin / $rotationDeg / mx=$mirrorX / my=$mirrorY', (input) => {
    const image: RasterImage = {
      kind: 'raster-image',
      id: 'pixels',
      source: 'audit.png',
      dataUrl: 'data:image/png;base64,AA==',
      lumaBase64: 'AP//AAD/',
      pixelWidth: 3,
      pixelHeight: 2,
      bounds: { minX: 0, minY: 0, maxX: 3, maxY: 2 },
      color: COLOR,
      dither: 'threshold',
      linesPerMm: 1,
      transform: {
        ...IDENTITY_TRANSFORM,
        x: 70,
        y: 80,
        scaleX: 2,
        scaleY: 1.5,
        rotationDeg: input.rotationDeg,
        mirrorX: input.mirrorX,
        mirrorY: input.mirrorY,
      },
    };
    const layer = {
      ...createLayer({ id: 'pixels', color: COLOR, mode: 'image' }),
      passThrough: true,
      ditherAlgorithm: 'threshold' as const,
    };
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      origin: input.origin,
      bedWidth: 358,
      bedHeight: 268,
    };
    const group = compileJob({ objects: [image], layers: [layer] }, device).groups[0];
    if (group?.kind !== 'raster') throw new Error('expected raster');
    const radians = (input.rotationDeg * Math.PI) / 180;
    for (let sy = 0; sy < 2; sy += 1) {
      for (let sx = 0; sx < 3; sx += 1) {
        const mx = (sx + 0.5) * 2 * (input.mirrorX ? -1 : 1);
        const my = (sy + 0.5) * 1.5 * (input.mirrorY ? -1 : 1);
        const world = {
          x: 70 + mx * Math.cos(radians) - my * Math.sin(radians),
          y: 80 + mx * Math.sin(radians) + my * Math.cos(radians),
        };
        const number = physicalToNumbers(world, input.origin);
        const gx = Math.floor(
          ((number.x - group.bounds.minX) / (group.bounds.maxX - group.bounds.minX)) *
            group.pixelWidth,
        );
        const gy = Math.floor(
          ((number.y - group.bounds.minY) / (group.bounds.maxY - group.bounds.minY)) *
            group.pixelHeight,
        );
        expect(group.sValues[gy * group.pixelWidth + gx]).toBe(luma[sy * 3 + sx] === 0 ? 300 : 0);
      }
    }
  });
});
