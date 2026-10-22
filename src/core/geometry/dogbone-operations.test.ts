// Dogbone keeps the region the canvas and CAM read (audit 2026-10-21 geometry
// K-1, CNC audit 2026-09-29 WA-6): ordinary artwork is even-odd, so a DXF plate
// whose outline, CIRCLE hole and slot all run the same way keeps both holes.

import { areaD } from 'clipper2-ts';
import { describe, expect, it } from 'vitest';
import { parseDxf } from '../../io/dxf';
import { createLayer, IDENTITY_TRANSFORM, type ImportedSvg, type Vec2 } from '../scene';
import { dogboneOperationRegions } from './dogbone-operations';
import { dogboneVectorObject } from './dogbone';
import { polylineToPathD } from './vector-path-tools';

const PLATE: ReadonlyArray<Vec2> = [
  { x: 0, y: 0 },
  { x: 80, y: 0 },
  { x: 80, y: 40 },
  { x: 0, y: 40 },
];
const SLOT: ReadonlyArray<Vec2> = [
  { x: 50, y: 17 },
  { x: 60, y: 17 },
  { x: 60, y: 23 },
  { x: 50, y: 23 },
];

function lwpolyline(points: ReadonlyArray<Vec2>): string[] {
  return [
    '0',
    'LWPOLYLINE',
    '8',
    '0',
    '90',
    String(points.length),
    '70',
    '1',
    ...points.flatMap((point) => ['10', String(point.x), '20', String(point.y)]),
  ];
}

function plateDxf(plate: ReadonlyArray<Vec2>, slot: ReadonlyArray<Vec2>): string {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    ...lwpolyline(plate),
    // An M6 clearance hole; DXF circles always run counter-clockwise.
    ...['0', 'CIRCLE', '8', '0', '10', '20', '20', '20', '40', '3.2'],
    ...lwpolyline(slot),
    '0',
    'ENDSEC',
    '0',
    'EOF',
    '',
  ].join('\n');
}

function importPlate(plate: ReadonlyArray<Vec2>, slot: ReadonlyArray<Vec2>): ImportedSvg {
  const parsed = parseDxf({ dxfText: plateDxf(plate, slot), id: 'plate', source: 'plate.dxf' });
  if (parsed.kind !== 'ok' || parsed.object === null) throw new Error('DXF import failed');
  return parsed.object;
}

function signedAreas(object: ImportedSvg): number[] {
  return object.paths
    .flatMap((path) => path.polylines)
    .map((polyline) => areaD(polylineToPathD(polyline)));
}

function dogbonePlate(object: ImportedSvg): ImportedSvg {
  const color = object.paths[0]?.color ?? '#000000';
  const result = dogboneOperationRegions(object, 6, [createLayer({ id: 'cut', color })]);
  if (result.kind === 'error') throw new Error(result.error.message);
  return result.value;
}

/** The plate keeps its outline and both holes: three rings, holes opposite to the outline. */
function expectPlateWithTwoHoles(object: ImportedSvg): void {
  const areas = signedAreas(object).sort((a, b) => Math.abs(b) - Math.abs(a));
  expect(areas).toHaveLength(3);
  const [outline, slot, hole] = areas as [number, number, number];
  expect(Math.abs(outline)).toBeGreaterThan(3200);
  expect(Math.abs(slot)).toBeCloseTo(60, 2);
  expect(Math.abs(hole)).toBeCloseTo(Math.PI * 3.2 * 3.2, 0);
  expect(Math.sign(slot)).toBe(-Math.sign(outline));
  expect(Math.sign(hole)).toBe(-Math.sign(outline));
}

describe('dogboneOperationRegions on an imported DXF plate', () => {
  it('imports every ring of a counter-clockwise plate the same way round, in one path', () => {
    const plate = importPlate(PLATE, SLOT);
    expect(plate.paths).toHaveLength(1);
    expect(plate.paths[0]?.fillRule).toBeUndefined();
    const signs = signedAreas(plate).map(Math.sign);
    expect(new Set(signs).size).toBe(1);
  });

  it('keeps the CIRCLE hole and the slot of a counter-clockwise plate', () => {
    expectPlateWithTwoHoles(dogbonePlate(importPlate(PLATE, SLOT)));
  });

  it('keeps a same-direction slot in a clockwise plate', () => {
    const clockwise = (points: ReadonlyArray<Vec2>) => [...points].reverse();
    expectPlateWithTwoHoles(dogbonePlate(importPlate(clockwise(PLATE), clockwise(SLOT))));
  });
});

function ringObject(fillRule?: 'nonzero' | 'evenodd'): ImportedSvg {
  const square = (min: number, max: number): ReadonlyArray<Vec2> => [
    { x: min, y: min },
    { x: max, y: min },
    { x: max, y: max },
    { x: min, y: max },
  ];
  return {
    kind: 'imported-svg',
    id: 'ring',
    source: 'ring',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        ...(fillRule === undefined ? {} : { fillRule }),
        polylines: [
          { closed: true, points: [...square(0, 20)] },
          { closed: true, points: [...square(5, 15)] },
        ],
      },
    ],
  };
}

describe('dogboneVectorObject fill rule', () => {
  it('reads two same-direction loops of ordinary artwork as a ring', () => {
    const result = dogboneVectorObject(ringObject(), 3);
    if (result.kind === 'error') throw new Error(result.error.message);
    expect(signedAreas(result.value)).toHaveLength(2);
  });

  it('honours a declared non-zero rule, which fills the same loops solid', () => {
    const result = dogboneVectorObject(ringObject('nonzero'), 3);
    if (result.kind === 'error') throw new Error(result.error.message);
    expect(signedAreas(result.value)).toHaveLength(1);
  });
});
