import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import { cncGrblStrategy } from '../output/cnc-grbl-strategy';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type ImportedSvg,
  type Scene,
  type Vec2,
} from '../scene';
import { cncTabAnchorPosition, projectCncTabAnchor } from './cnc-tab-anchors';
import { collectLayerContours } from './collect-cnc-contours';
import { compileCncJob } from './compile-cnc-job';

const COLOR = '#ff0000';
const OBJECT: ImportedSvg = {
  kind: 'imported-svg',
  id: 'scaled',
  source: 'scaled.svg',
  bounds: { minX: 20, minY: 20, maxX: 40, maxY: 40 },
  transform: { ...IDENTITY_TRANSFORM, scaleX: 2 },
  paths: [
    {
      color: COLOR,
      polylines: [
        {
          closed: true,
          points: [
            { x: 20, y: 20 },
            { x: 40, y: 20 },
            { x: 40, y: 40 },
            { x: 20, y: 40 },
          ],
        },
      ],
    },
  ],
};

function expectTabCenter(points: ReadonlyArray<Vec2>, expected: Vec2): void {
  expect(points).toHaveLength(2);
  expect((points[0]!.x + points[1]!.x) / 2).toBeCloseTo(expected.x, 3);
  expect((points[0]!.y + points[1]!.y) / 2).toBeCloseTo(expected.y, 3);
}

describe('transformed manual CNC tabs', () => {
  it.each([
    { cutType: 'profile-on-path', offsetMm: 0 },
    { cutType: 'profile-outside', offsetMm: 1 },
    { cutType: 'profile-inside', offsetMm: -1 },
  ] as const)(
    'keeps the dragged handle and output bridge aligned for $cutType',
    ({ cutType, offsetMm }) => {
      const anchor = projectCncTabAnchor(OBJECT, COLOR, { x: 82, y: 30 });
      expect(anchor).not.toBeNull();
      const object = { ...OBJECT, cncTabAnchors: [anchor!] };
      expect(cncTabAnchorPosition(object, anchor!)).toEqual({ x: 80, y: 30 });
      const layer = {
        ...createLayer({ id: 'L1', color: COLOR }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType,
          profileLead: { shape: 'none' as const },
          depthMm: 6,
          depthPerPassMm: 3,
          tabsEnabled: true,
          tabHeightMm: 2,
          tabWidthMm: 6,
        },
      };
      const sourcePosition = toMachineCoords({ x: 80, y: 30 }, DEFAULT_DEVICE_PROFILE);
      const expected = toMachineCoords({ x: 80 + offsetMm, y: 30 }, DEFAULT_DEVICE_PROFILE);
      const contours = collectLayerContours([object], layer, DEFAULT_DEVICE_PROFILE);
      expect(contours[0]?.manualTabPoints).toEqual([sourcePosition]);
      const input: Scene = { objects: [object], layers: [layer] };
      const machine = {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        toolId: 'test-2mm',
        tools: [
          { id: 'test-2mm', name: '2 mm end mill', kind: 'end-mill' as const, diameterMm: 2 },
        ],
      };
      const job = compileCncJob(input, DEFAULT_DEVICE_PROFILE, machine);
      const group = job.groups[0];
      if (group?.kind !== 'cnc') throw new Error('expected CNC group');
      const tabTopPoints = group.passes.flatMap((pass) =>
        pass.kind === 'path3d' ? pass.points.filter((point) => Math.abs(point.z + 4) < 1e-9) : [],
      );
      expectTabCenter(tabTopPoints, expected);

      const gcode = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
      const emittedTabPoints = gcode.split('\n').flatMap((line) => {
        const match = /^G1 X(-?[\d.]+) Y(-?[\d.]+) Z(-?[\d.]+)(?:\s|$)/.exec(line);
        return match !== null && Number(match[3]) === -4
          ? [{ x: Number(match[1]), y: Number(match[2]) }]
          : [];
      });
      expectTabCenter(emittedTabPoints, expected);
    },
  );
});
