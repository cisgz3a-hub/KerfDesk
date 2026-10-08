import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  angle,
  artwork,
  boundaryDistance,
  burns,
  color,
  compile,
  contains,
  contour,
  crossing,
  crossingObjects,
  crossingOwners,
  device,
  duplicateMaterialBurns,
  fillGroups,
  fillLayer,
  hole,
  island,
  interiorBurns,
  margin,
  nested,
  nestedMaterial,
  nestedObjects,
  nestedOwner,
  operationId,
  plate,
  rectangle,
  styles,
  voidBurns,
} from '../../__fixtures__/fill-process-ownership';
import * as polygon from '../geometry/polygon-difference';
import {
  createLayer,
  createRegistrationLayer,
  IDENTITY_TRANSFORM,
  type Scene,
  type TracedImage,
} from '../scene';
import { registrationJigCopyId } from '../scene/registration-jig-artwork';
import { createRegistrationBox } from '../shapes';
import { compileJob } from './compile-job';
import type { Job } from './job';
afterEach(() => vi.restoreAllMocks());

describe('K1 Fill geometry retains process ownership', () => {
  it.each(styles)('%s: different-power nested objects never engrave the void', (style) => {
    const job = compile(nestedObjects(), fillLayer(style));
    expect(burns(job).length).toBeGreaterThan(0);
    expect(voidBurns(job, nested, (p) => nestedOwner(p) !== 'void')).toEqual([]);
  });

  it.each(styles)(
    '%s: the nested island burns once at its own power and outer material retains its settings',
    (style) => {
      const job = compile(nestedObjects(), fillLayer(style));
      nestedMaterial(job);
      expect(duplicateMaterialBurns(job, nested, (p) => nestedOwner(p) !== 'void')).toEqual([]);
    },
  );

  it.each(styles)(
    '%s: object hatch angle, spacing and feed overrides preserve shared voids and material ownership',
    (style) => {
      const job = compile(nestedObjects(true), fillLayer(style));
      expect(voidBurns(job, nested, (p) => nestedOwner(p) !== 'void')).toEqual([]);
      nestedMaterial(job, 20, 600, true);
      if (style !== 'offset') {
        const islandBurns = interiorBurns(job, nested).filter(
          (burn) => nestedOwner(burn.midpoint) === 'island',
        );
        expect([...new Set(islandBurns.map(angle))]).toEqual([90]);
      }
    },
  );

  it.each(['scanline', 'island'] as const)(
    '%s: each material owner keeps its explicit angle-per-pass sequence',
    (style) => {
      const objects = [
        artwork('plate', plate),
        artwork('hole', hole, {
          operationOverride: {
            byOperation: {
              [operationId]: { power: 40, hatchAngleDeg: 43, passAngleStepDeg: 22, passes: 4 },
            },
          },
        }),
        artwork('island', island, {
          operationOverride: {
            byOperation: {
              [operationId]: {
                power: 20,
                speed: 600,
                airAssist: true,
                hatchAngleDeg: 91,
                passAngleStepDeg: 29,
                passes: 2,
              },
            },
          },
        }),
      ];
      const job = compile(
        objects,
        fillLayer(style, { hatchAngleDeg: 13, passAngleStepDeg: 37, passes: 3 }),
      );
      nestedMaterial(job, 20, 600, true);
      expect(voidBurns(job, nested, (p) => nestedOwner(p) !== 'void')).toEqual([]);
      for (const [owner, expected] of [
        ['outer', [13, 50, 87]],
        ['island', [91, 120]],
      ] as const) {
        const owned = interiorBurns(job, nested).filter(
          (burn) => nestedOwner(burn.midpoint) === owner,
        );
        expect([...new Set(owned.map(angle))].sort((a, b) => a - b)).toEqual(expected);
        expect(owned.every((burn) => burn.group.passes === 1)).toBe(true);
      }
    },
  );

  it.each(styles)(
    '%s: two crossing different-power rectangles knock out even overlap and keep sole-owner power',
    (style) => {
      const rectangles = crossing.slice(0, 2);
      const job = compile(crossingObjects(true).slice(0, 2), fillLayer(style));
      expect(
        voidBurns(job, rectangles, (p) => crossingOwners(p, rectangles).length % 2 === 1),
      ).toEqual([]);
      for (const [owner, power] of [
        [0, 80],
        [1, 40],
      ] as const) {
        const owned = interiorBurns(job, rectangles).filter(
          (burn) => crossingOwners(burn.midpoint, rectangles).join() === String(owner),
        );
        expect(owned.length).toBeGreaterThan(0);
        expect(owned.every((burn) => burn.group.power === power)).toBe(true);
      }
    },
  );

  it.each(styles)(
    '%s: three-owner odd overlap contains material without duplicate burns or an invented power winner',
    (style) => {
      const job = compile(crossingObjects(true), fillLayer(style));
      expect(
        interiorBurns(job, crossing).some((burn) => crossingOwners(burn.midpoint).length === 3),
      ).toBe(true);
      expect(duplicateMaterialBurns(job, crossing, (p) => crossingOwners(p).length === 3)).toEqual(
        [],
      );
    },
  );

  it.each(styles)(
    'control %s: uniform three-object crossing respects parity without duplicate material',
    (style) => {
      const job = compile(crossingObjects(false), fillLayer(style));
      expect(
        interiorBurns(job, crossing).some((burn) => crossingOwners(burn.midpoint).length === 3),
      ).toBe(true);
      expect(voidBurns(job, crossing, (p) => crossingOwners(p).length % 2 === 1)).toEqual([]);
      expect(
        duplicateMaterialBurns(job, crossing, (p) => crossingOwners(p).length % 2 === 1),
      ).toEqual([]);
    },
  );

  it.each(styles)(
    'control %s: one explicit nonzero path paints overlapping contours together',
    (style) => {
      const rectangles = crossing.slice(0, 2);
      const object = artwork('one-nonzero-object', rectangle(10, 10, 60, 50), {
        powerScale: 50,
        paths: [{ color, fillRule: 'nonzero', polylines: rectangles.map(contour) }],
      });
      const job = compile([object], fillLayer(style));
      const interior = interiorBurns(job, rectangles);
      expect(interior.some((burn) => crossingOwners(burn.midpoint, rectangles).length === 2)).toBe(
        true,
      );
      expect(
        interior.every(
          (burn) => crossingOwners(burn.midpoint, rectangles).length > 0 && burn.group.power === 40,
        ),
      ).toBe(true);
      expect(
        duplicateMaterialBurns(job, rectangles, (p) => crossingOwners(p, rectangles).length > 0),
      ).toEqual([]);
    },
  );

  it.each(styles)(
    'control %s: independent paths paint together within one object before cross-object parity',
    (style) => {
      const rectangles = crossing.slice(0, 2);
      const object = artwork('two-path-object', rectangle(10, 10, 60, 50), {
        paths: rectangles.map((r) => ({ color, fillRule: 'evenodd', polylines: [contour(r)] })),
      });
      const job = compile([object], fillLayer(style));
      const interior = interiorBurns(job, rectangles);
      expect(interior.some((burn) => crossingOwners(burn.midpoint, rectangles).length === 2)).toBe(
        true,
      );
      expect(interior.every((burn) => crossingOwners(burn.midpoint, rectangles).length > 0)).toBe(
        true,
      );
      expect(
        duplicateMaterialBurns(job, rectangles, (p) => crossingOwners(p, rectangles).length > 0),
      ).toEqual([]);
    },
  );

  it.each(styles)('control %s: uniform nested artwork preserves its hole and island', (style) => {
    const objects = [artwork('plate', plate), artwork('hole', hole), artwork('island', island)];
    const job = compile(objects, fillLayer(style));
    expect(voidBurns(job, nested, (p) => nestedOwner(p) !== 'void')).toEqual([]);
    nestedMaterial(job, 80);
    expect(duplicateMaterialBurns(job, nested, (p) => nestedOwner(p) !== 'void')).toEqual([]);
  });

  it.each(styles)(
    'control %s: overlapping material in separate operations retains both independent engraves',
    (style) => {
      const first = artwork('a', crossing[0]!, { operationIds: ['a'] }),
        second = artwork('b', crossing[1]!, { operationIds: ['b'] });
      const job = compileJob(
        {
          objects: [first, second],
          layers: [
            { ...fillLayer(style), id: 'a' },
            { ...fillLayer(style, { power: 40 }), id: 'b' },
          ],
        },
        device,
      );
      for (const [id, power] of [
        ['a', 80],
        ['b', 40],
      ] as const) {
        const owned = interiorBurns(job, crossing.slice(0, 2)).filter(
          (burn) => burn.group.layerId === id,
        );
        expect(
          owned.some((burn) => crossingOwners(burn.midpoint, crossing.slice(0, 2)).length === 2),
        ).toBe(true);
        expect(owned.every((burn) => burn.group.power === power)).toBe(true);
      }
    },
  );

  it('control: artwork priority interleaving does not split a shared operation region', () => {
    const other = artwork('priority-separator', rectangle(120, 10, 5), { operationIds: ['other'] });
    const scene: Scene = {
      objects: [artwork('plate', plate), artwork('hole', hole), artwork('island', island), other],
      artworkOrder: ['plate', other.id, 'hole', 'island'],
      layers: [fillLayer('scanline'), { ...createLayer({ id: 'other', color, mode: 'line' }) }],
    };
    const job = compileJob(scene, device);
    expect(voidBurns(job, nested, (p) => nestedOwner(p) !== 'void')).toEqual([]);
    nestedMaterial(job, 80);
    expect(job.groups.some((group) => group.kind === 'cut' && group.layerId === 'other')).toBe(
      true,
    );
  });

  it.each(styles)(
    'control %s: independently run registration jigs retain their own compound region',
    (style) => {
      const objects = [artwork('plate', plate), artwork('hole', hole), artwork('island', island)];
      const x = 60;
      const copies = objects.map((object) => ({
        ...object,
        id: registrationJigCopyId(object.id, 'box-b'),
        transform: { ...object.transform, x },
      }));
      const scene: Scene = {
        objects: [
          createRegistrationBox({ id: 'box-a', widthMm: 100, heightMm: 100 }),
          createRegistrationBox({ id: 'box-b', widthMm: 100, heightMm: 100, x }),
          ...objects,
          ...copies,
        ],
        layers: [{ ...createRegistrationLayer(), output: false }, fillLayer(style)],
      };
      const job = compileJob(scene, device);
      for (const [sourceObjectId, offset] of [
        ['plate', 0],
        [registrationJigCopyId('plate', 'box-b'), x],
      ] as const) {
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
        const local: Job = { groups };
        expect(voidBurns(local, nested, (p) => nestedOwner(p) !== 'void')).toEqual([]);
        nestedMaterial(local, 80);
        expect(duplicateMaterialBurns(local, nested, (p) => nestedOwner(p) !== 'void')).toEqual([]);
      }
    },
  );

  it('control: a uniform dense Sharp-style evenodd trace retains direct scanline sweep and every region', () => {
    const count = 4000;
    const rectangles = Array.from({ length: count }, (_, i) =>
      rectangle(5 + (i % 100) * 2, 5 + Math.floor(i / 100) * 2, 1.2),
    );
    const evenOdd = vi.spyOn(polygon, 'normalizeClosedPolylinesEvenOddChecked');
    const nonZero = vi.spyOn(polygon, 'normalizeClosedPolylinesNonZeroChecked');
    const object: TracedImage = {
      kind: 'traced-image',
      id: 'sharp-trace',
      source: 'sharp-fixture.png',
      traceMode: 'filled-contours',
      bounds: rectangle(5, 5, 200, 80),
      transform: IDENTITY_TRANSFORM,
      operationIds: [operationId],
      paths: [{ color, fillRule: 'evenodd', polylines: rectangles.map(contour) }],
    };
    const job = compile([object], fillLayer('scanline', { hatchSpacingMm: 0.5 }));
    const covered = new Set<number>();
    for (const burn of burns(job)) {
      const column = Math.floor((burn.midpoint.x - 5) / 2),
        row = Math.floor((burn.midpoint.y - 5) / 2),
        index = row * 100 + column;
      const source = rectangles[index];
      if (
        source !== undefined &&
        contains(source, burn.midpoint) &&
        boundaryDistance(source, burn.midpoint) > margin
      )
        covered.add(index);
      expect(burn.group.power).toBe(80);
    }
    expect(covered.size).toBe(count);
    expect(evenOdd).not.toHaveBeenCalled();
    expect(nonZero).not.toHaveBeenCalled();
  });

  it('control: Offset ignores hatch/pass angles and keeps its owners actual repeated-pass setting', () => {
    const object = artwork('island-only', island, {
      operationOverride: {
        byOperation: {
          [operationId]: { power: 20, hatchAngleDeg: 91, passAngleStepDeg: 29, passes: 2 },
        },
      },
    });
    const groups = fillGroups(compile([object], fillLayer('offset', { passes: 3 })));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ power: 20, passes: 2, fillStyle: 'offset' });
    expect(groups[0]?.segments.every((segment) => segment.closed)).toBe(true);
  });
});
