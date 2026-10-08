import { describe, expect, it } from 'vitest';
import {
  angle,
  artwork,
  color,
  contains,
  contour,
  device,
  duplicateMaterialBurns,
  fillLayer,
  interiorBurns,
  operationId,
  rectangle,
  styles,
  voidBurns,
  type Burn,
  type Rectangle,
} from '../../__fixtures__/fill-process-ownership';
import type { ImportedSvg, LayerFillStyle, Vec2 } from '../scene';
import { compileJob } from './compile-job';
import type { Job } from './job';

const plate = rectangle(10, 10, 80);
const hole = rectangle(30, 30, 40);
const crossing = rectangle(50, 20, 60, 60);
const island = rectangle(42, 42, 16);
const remote = rectangle(130, 10, 40);
const processes = {
  P: {
    power: 80,
    speed: 1200,
    airAssist: false,
    powerMode: 'dynamic',
    hatchAngleDeg: 0,
    hatchSpacingMm: 2,
  },
  H: {
    power: 20,
    speed: 300,
    airAssist: false,
    powerMode: 'constant',
    hatchAngleDeg: 30,
    hatchSpacingMm: 1.3,
  },
  C: {
    power: 40,
    speed: 600,
    airAssist: true,
    powerMode: 'constant',
    hatchAngleDeg: 90,
    hatchSpacingMm: 1.5,
  },
  I: {
    power: 24,
    speed: 450,
    airAssist: true,
    powerMode: 'constant',
    hatchAngleDeg: 90,
    hatchSpacingMm: 1.5,
  },
} as const;
type Owner = keyof typeof processes;
type OwnerAt = (point: Vec2) => Owner | null;

function ownedArtwork(
  id: string,
  bounds: Rectangle,
  owner: Owner,
  extra: Partial<ImportedSvg> = {},
): ImportedSvg {
  return artwork(id, bounds, {
    operationOverride: { byOperation: { [operationId]: processes[owner] } },
    ...extra,
  });
}

function compile(
  objects: readonly ImportedSvg[],
  style: LayerFillStyle,
  artworkOrder: readonly string[],
): Job {
  return compileJob({ objects, layers: [fillLayer(style)], artworkOrder }, device);
}

function actualProcess(burn: Burn, style: LayerFillStyle) {
  const group = burn.group;
  return {
    power: group.power,
    speed: group.speed,
    airAssist: group.airAssist,
    powerMode: group.powerMode,
    passes: group.passes,
    fillStyle: group.fillStyle,
    spacing: group.operationSettings?.hatchSpacingMm,
    requestedAngle: group.operationSettings?.hatchAngleDeg,
    angle: style === 'offset' ? null : angle(burn),
  };
}

function expectedProcess(owner: Owner, style: LayerFillStyle) {
  const process = processes[owner];
  return {
    power: process.power,
    speed: process.speed,
    airAssist: process.airAssist,
    powerMode: process.powerMode,
    passes: 1,
    fillStyle: style,
    spacing: process.hatchSpacingMm,
    requestedAngle: process.hatchAngleDeg,
    angle: style === 'offset' ? null : process.hatchAngleDeg,
  };
}

function qualify(
  job: Job,
  rectangles: readonly Rectangle[],
  style: LayerFillStyle,
  ownerAt: OwnerAt,
): Burn[] {
  const material = interiorBurns(job, rectangles).filter((burn) => ownerAt(burn.midpoint) !== null);
  expect(material.length).toBeGreaterThan(0);
  expect(voidBurns(job, rectangles, (point) => ownerAt(point) !== null)).toEqual([]);
  const violations = material.flatMap((burn) => {
    const owner = ownerAt(burn.midpoint);
    if (owner === null) throw new Error('Material interval lacks an independent owner');
    const actual = actualProcess(burn, style);
    const expected = expectedProcess(owner, style);
    return JSON.stringify(actual) === JSON.stringify(expected)
      ? []
      : [{ at: burn.midpoint, actual, expected }];
  });
  expect({ count: violations.length, sample: violations.slice(0, 5) }).toEqual({
    count: 0,
    sample: [],
  });
  expect(duplicateMaterialBurns(job, rectangles, (point) => ownerAt(point) !== null)).toEqual([]);
  return material;
}

function crossingOwner(point: Vec2, winner: 'P' | 'C'): Owner | null {
  const insidePlate = contains(plate, point);
  const insideHole = contains(hole, point);
  const insideCrossing = contains(crossing, point);
  const count = Number(insidePlate) + Number(insideHole) + Number(insideCrossing);
  if (count % 2 === 0) return null;
  if (count === 3) return winner;
  if (insidePlate) return 'P';
  if (insideCrossing) return 'C';
  throw new Error('A negative contained hole cannot be sole material');
}

// Crossing-frontmost ownership is our working default, pending any user
// steering. This comment records the team's default, not a received answer.
// The laminar P/H pair makes H negative. In the P/H/C triple cell, positive
// P and unrelated C compete by canvas order; global depth sorting is wrong.
const crossingOrders = [
  { name: 'P frontmost', order: ['H', 'C', 'P'], winner: 'P' },
  { name: 'C frontmost', order: ['H', 'P', 'C'], winner: 'C' },
] as const;

describe('K1 working Fill ownership policy', () => {
  for (const style of styles) {
    it.each(crossingOrders)(
      `${style}: restored triple material uses positive $name and never negative H`,
      ({ order, winner }) => {
        const byId = {
          P: ownedArtwork('P', plate, 'P'),
          H: ownedArtwork('H', hole, 'H'),
          C: ownedArtwork('C', crossing, 'C'),
        };
        // Job priority deliberately differs from canvas order in both cases.
        const job = compile(
          order.map((id) => byId[id]),
          style,
          ['P', 'H', 'C'],
        );
        const material = qualify(job, [plate, hole, crossing], style, (point) =>
          crossingOwner(point, winner),
        );
        expect(
          material.some(({ midpoint }) => contains(hole, midpoint) && contains(crossing, midpoint)),
        ).toBe(true);
        expect(
          material.some(
            ({ midpoint }) => contains(plate, midpoint) && !contains(crossing, midpoint),
          ),
        ).toBe(true);
        expect(
          material.some(
            ({ midpoint }) => contains(crossing, midpoint) && !contains(plate, midpoint),
          ),
        ).toBe(true);
      },
    );

    it(`${style}: a true positive island owns its material despite being behind P`, () => {
      const job = compile(
        [
          ownedArtwork('I', island, 'I'),
          ownedArtwork('H', hole, 'H'),
          ownedArtwork('P', plate, 'P'),
        ],
        style,
        ['P', 'I', 'H'],
      );
      const material = qualify(job, [plate, hole, island], style, (point) => {
        if (contains(island, point)) return 'I';
        return contains(plate, point) && !contains(hole, point) ? 'P' : null;
      });
      expect(material.some(({ midpoint }) => contains(island, midpoint))).toBe(true);
      expect(material.some(({ midpoint }) => !contains(hole, midpoint))).toBe(true);
    });

    it(`${style}: intrinsic-hole/disjoint control cannot fabricate compound ownership`, () => {
      const compound = ownedArtwork('D', rectangle(10, 10, 160, 80), 'P', {
        paths: [
          {
            color,
            fillRule: 'evenodd',
            polylines: [contour(plate), contour(hole), contour(remote)],
          },
        ],
      });
      // Frontmost D is absent inside its own intrinsic hole. C is the sole
      // actual contributor there; D's whole-object bounds are not ownership.
      const job = compile([ownedArtwork('C', island, 'C'), compound], style, ['D', 'C']);
      const material = qualify(job, [plate, hole, island, remote], style, (point) => {
        if (contains(island, point)) return 'C';
        if (contains(remote, point)) return 'P';
        return contains(plate, point) && !contains(hole, point) ? 'P' : null;
      });
      expect(material.some(({ midpoint }) => contains(island, midpoint))).toBe(true);
      expect(material.some(({ midpoint }) => contains(remote, midpoint))).toBe(true);
      expect(
        material.some(({ midpoint }) => contains(plate, midpoint) && !contains(hole, midpoint)),
      ).toBe(true);
    });
  }
});
