import { describe, expect, it } from 'vitest';
import {
  angle,
  artwork,
  color,
  compile,
  contains,
  crossing,
  crossingOwners,
  device,
  duplicateMaterialBurns,
  fillGroups,
  fillLayer,
  hole,
  interiorBurns,
  nested,
  nestedMaterial,
  nestedObjects,
  nestedOwner,
  operationId,
  plate,
  styles,
  voidBurns,
} from '../../__fixtures__/fill-process-ownership';
import {
  captureLayerOperationSettings,
  createLayerSubLayer,
  createRegistrationLayer,
  type ImportedSvg,
  type LayerFillStyle,
  type Scene,
  type Vec2,
} from '../scene';
import { registrationJigCopyId } from '../scene/registration-jig-artwork';
import { createRegistrationBox } from '../shapes';
import { compileJob } from './compile-job';
import type { Job } from './job';

function manufacturedBurn(polyline: readonly Vec2[], closed = false): Job {
  return {
    groups: [
      {
        kind: 'fill',
        layerId: operationId,
        color,
        power: 80,
        speed: 1200,
        passes: 1,
        airAssist: false,
        overscanMm: 0,
        segments: [{ polyline, closed, reverse: false }],
      },
    ],
  };
}

function reorderedNested(ids: readonly string[]): ImportedSvg[] {
  const byId = new Map(nestedObjects(true).map((object) => [object.id, object]));
  return ids.map((id) => {
    const object = byId.get(id);
    if (object === undefined) throw new Error(`Missing nested fixture ${id}`);
    return object;
  });
}

function jigScene(style: LayerFillStyle): Scene {
  const objects = nestedObjects(true);
  const copies = objects.map((object) => ({
    ...object,
    id: registrationJigCopyId(object.id, 'box-b'),
    transform: { ...object.transform, x: 60 },
    ...(object.id === 'island'
      ? {
          powerScale: 75,
          operationOverride: {
            byOperation: {
              [operationId]: {
                hatchAngleDeg: 90,
                hatchSpacingMm: 0.75,
                speed: 300,
                airAssist: false,
              },
            },
          },
        }
      : {}),
  }));
  return {
    objects: [
      createRegistrationBox({ id: 'box-a', widthMm: 100, heightMm: 100 }),
      createRegistrationBox({ id: 'box-b', widthMm: 100, heightMm: 100, x: 60 }),
      ...objects,
      ...copies,
    ],
    layers: [{ ...createRegistrationLayer(), output: false }, fillLayer(style)],
  };
}

function localJig(job: Job, sourceObjectId: string, offset: number): Job {
  const groups = fillGroups(job)
    .filter((group) => group.sourceObjectId === sourceObjectId)
    .map((group) => ({
      ...group,
      segments: group.segments.map((segment) => ({
        ...segment,
        polyline: segment.polyline.map((p) => ({ x: p.x - offset, y: p.y })),
      })),
    }));
  expect(groups.length).toBeGreaterThan(0);
  return { groups };
}

function subOperationJob(style: LayerFillStyle): Job {
  const base = fillLayer(style);
  const childId = `${operationId}:second`;
  return compile(
    [
      artwork('plate', plate),
      artwork('hole', hole, {
        powerScale: 50,
        operationOverride: {
          byOperation: {
            [childId]: { mode: 'line', kerfOffsetMm: 1, speed: 600 },
          },
        },
      }),
    ],
    {
      ...base,
      subLayers: [
        createLayerSubLayer(base, {
          id: 'second',
          label: 'Independent materialized operation',
          settings: { ...captureLayerOperationSettings(base), power: 60 },
        }),
      ],
    },
  );
}

const crossingSettings = [
  {
    powerScale: 100,
    power: 80,
    speed: 1200,
    airAssist: false,
    hatchAngleDeg: 0,
    hatchSpacingMm: 0.7,
  },
  {
    powerScale: 50,
    power: 40,
    speed: 900,
    airAssist: false,
    hatchAngleDeg: 45,
    hatchSpacingMm: 1.1,
  },
  {
    powerScale: 25,
    power: 20,
    speed: 600,
    airAssist: true,
    hatchAngleDeg: 90,
    hatchSpacingMm: 0.6,
  },
] as const;

function crossingJob(style: LayerFillStyle, order: readonly number[]): Job {
  const objects = order.map((index) => {
    const bounds = crossing[index],
      settings = crossingSettings[index];
    if (bounds === undefined || settings === undefined) throw new Error('Invalid crossing fixture');
    return artwork(`cross-${index}`, bounds, {
      powerScale: settings.powerScale,
      operationOverride: {
        byOperation: {
          [operationId]: {
            speed: settings.speed,
            airAssist: settings.airAssist,
            hatchAngleDeg: settings.hatchAngleDeg,
            hatchSpacingMm: settings.hatchSpacingMm,
          },
        },
      },
    });
  });
  return compileJob(
    {
      objects,
      layers: [fillLayer(style)],
      // Job priority deliberately differs from the canvas stack.
      artworkOrder: ['cross-1', 'cross-0', 'cross-2'],
    },
    device,
  );
}

// Prospective frontmost canvas default, pending the maintainer's optional
// preference. If operation base is selected, revise this explicit winner
// before production; deepest strictly contained islands remain independent.
const prospectiveOrders = [
  { name: 'C frontmost', order: [0, 1, 2], winner: 2 },
  { name: 'A frontmost', order: [2, 1, 0], winner: 0 },
] as const;

describe('K1 analytic topology boundary qualification', () => {
  it('control: detects both hole strips when the unsplit edge midpoint is material', () => {
    const job = manufacturedBurn([
      { x: 10, y: 50 },
      { x: 90, y: 50 },
    ]);
    expect(nestedOwner({ x: 50, y: 50 })).toBe('island');
    expect(voidBurns(job, nested, (p) => nestedOwner(p) !== 'void').map((burn) => burn.at)).toEqual(
      [
        { x: expect.closeTo(38, 12), y: 50 },
        { x: expect.closeTo(62, 12), y: 50 },
      ],
    );
  });

  it('control: qualifies the implicit closing edge through both open void strips', () => {
    const job = manufacturedBurn(
      [
        { x: 10, y: 50 },
        { x: 10, y: 10 },
        { x: 90, y: 50 },
      ],
      true,
    );
    expect(
      voidBurns(job, nested, (p) => nestedOwner(p) !== 'void')
        .filter((burn) => burn.at.y === 50)
        .map((burn) => burn.at),
    ).toEqual([
      { x: expect.closeTo(62, 12), y: 50 },
      { x: expect.closeTo(38, 12), y: 50 },
    ]);
  });

  it('control: rectangle boundary motion is not an open void interior', () => {
    const job = manufacturedBurn([
      { x: 34, y: 40 },
      { x: 34, y: 60 },
    ]);
    expect(interiorBurns(job, nested)).toEqual([]);
  });

  for (const ids of [
    ['island', 'hole', 'plate'],
    ['island', 'plate', 'hole'],
    ['hole', 'island', 'plate'],
  ]) {
    it.each(styles)(
      `%s: deepest island owns its process after canvas order ${ids.join(',')}`,
      (style) => {
        const job = compile(reorderedNested(ids), fillLayer(style));
        expect(voidBurns(job, nested, (p) => nestedOwner(p) !== 'void')).toEqual([]);
        nestedMaterial(job, 20, 600, true);
        expect(duplicateMaterialBurns(job, nested, (p) => nestedOwner(p) !== 'void')).toEqual([]);
      },
    );
  }

  it.each(styles)(
    '%s: heterogeneous overlapping jig runs retain independent owners and holes',
    (style) => {
      const job = compileJob(jigScene(style), device);
      for (const [id, offset, power, speed, air] of [
        ['plate', 0, 20, 600, true],
        [registrationJigCopyId('plate', 'box-b'), 60, 60, 300, false],
      ] as const) {
        const local = localJig(job, id, offset);
        expect(voidBurns(local, nested, (p) => nestedOwner(p) !== 'void')).toEqual([]);
        nestedMaterial(local, power, speed, air);
        expect(duplicateMaterialBurns(local, nested, (p) => nestedOwner(p) !== 'void')).toEqual([]);
      }
    },
  );

  it.each(styles)(
    '%s: a child Line override changes only its materialized Fill topology',
    (style) => {
      const job = subOperationJob(style),
        rectangles = [plate, hole];
      const parent = { groups: fillGroups(job).filter((group) => group.layerId === operationId) };
      const child = {
        groups: fillGroups(job).filter((group) => group.layerId === `${operationId}:second`),
      };
      expect(
        voidBurns(parent, rectangles, (p) => contains(plate, p) && !contains(hole, p)),
      ).toEqual([]);
      const parentBurns = interiorBurns(parent, rectangles);
      expect(parentBurns.length).toBeGreaterThan(0);
      expect(parentBurns.every((burn) => burn.group.power === 80)).toBe(true);
      const childBurns = interiorBurns(child, rectangles);
      expect(childBurns.some((burn) => contains(hole, burn.midpoint))).toBe(true);
      expect(
        childBurns.every((burn) => contains(plate, burn.midpoint) && burn.group.power === 60),
      ).toBe(true);
      const cuts = job.groups.flatMap((group) => (group.kind === 'cut' ? [group] : []));
      expect(cuts).toHaveLength(1);
      expect(cuts[0]).toMatchObject({ layerId: `${operationId}:second`, power: 30, speed: 600 });
      const points = cuts.flatMap((group) => group.segments.flatMap((segment) => segment.polyline));
      expect(Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x))).toBeCloseTo(
        34,
        8,
      );
    },
  );

  for (const style of ['scanline', 'island'] as const) {
    it.each(prospectiveOrders)(
      `${style}: differing angle/spacing respects crossing material ($name)`,
      ({ order }) => {
        const job = crossingJob(style, order);
        expect(voidBurns(job, crossing, (p) => crossingOwners(p).length % 2 === 1)).toEqual([]);
      },
    );

    it.each(prospectiveOrders)(
      `${style}: prospective frontmost crossing has one explicit settings owner ($name)`,
      ({ order, winner }) => {
        const job = crossingJob(style, order);
        const intervals = interiorBurns(job, crossing).filter(
          (burn) => crossingOwners(burn.midpoint).length % 2 === 1,
        );
        expect(intervals.some((burn) => crossingOwners(burn.midpoint).length === 3)).toBe(true);
        for (const burn of intervals) {
          const owners = crossingOwners(burn.midpoint);
          const owner = owners.length === 3 ? winner : owners[0];
          const settings = owner === undefined ? undefined : crossingSettings[owner];
          if (settings === undefined) throw new Error('Material interval lacks a fixture owner');
          expect(burn.group).toMatchObject({
            power: settings.power,
            speed: settings.speed,
            airAssist: settings.airAssist,
          });
          expect(burn.group.operationSettings).toMatchObject({
            hatchSpacingMm: settings.hatchSpacingMm,
          });
          expect(angle(burn)).toBe(settings.hatchAngleDeg);
        }
        expect(
          duplicateMaterialBurns(job, crossing, (p) => crossingOwners(p).length % 2 === 1),
        ).toEqual([]);
      },
    );
  }
});
