import type { ConstrainedSketch2d, SketchConstraint } from './constrained-sketch';
/** Analytic 60 x 30 mm bracket; each hole stays at its named fractional width. */
export function defaultConstrainedSketch(): ConstrainedSketch2d {
  const coordinates = [
    ['a', 0, 0, 0, 0],
    ['b', 60, 0, 'width', 0],
    ['c', 60, 30, 'width', 'height'],
    ['d', 0, 30, 0, 'height'],
    ['hole1', 15, 15, 'hole_x1', 'hole_y'],
    ['hole2', 45, 15, 'hole_x2', 'hole_y'],
  ] as const;
  const constraints: SketchConstraint[] = coordinates.flatMap(([id, , , x, y]) => [
    { id: id + '-x', kind: 'x', pointId: id, value: typeof x === 'number' ? x : { parameter: x } },
    { id: id + '-y', kind: 'y', pointId: id, value: typeof y === 'number' ? y : { parameter: y } },
  ]);
  return {
    version: 1,
    name: 'Constrained bracket',
    parameters: [
      { name: 'width', unit: 'mm', value: 60 },
      { name: 'height', unit: 'mm', value: 30 },
      { name: 'hole_diameter', unit: 'mm', value: 4 },
      { name: 'hole_x1', unit: 'mm', value: 'width/4' },
      { name: 'hole_x2', unit: 'mm', value: '3*width/4' },
      { name: 'hole_y', unit: 'mm', value: 'height/2' },
    ],
    points: coordinates.map(([id, x, y]) => ({ id, x, y })),
    lines: [
      { id: 'bottom', first: 'a', second: 'b' },
      { id: 'right', first: 'b', second: 'c' },
      { id: 'top', first: 'c', second: 'd' },
      { id: 'left', first: 'd', second: 'a' },
    ],
    circles: [
      { id: 'mount1', centre: 'hole1', radiusMm: 2 },
      { id: 'mount2', centre: 'hole2', radiusMm: 2 },
    ],
    profiles: [{ id: 'outline', pointIds: ['a', 'b', 'c', 'd'], closed: true }],
    constraints: [
      ...constraints,
      {
        id: 'mount1-diameter',
        kind: 'diameter',
        circleId: 'mount1',
        value: { parameter: 'hole_diameter' },
      },
      {
        id: 'mount2-diameter',
        kind: 'diameter',
        circleId: 'mount2',
        value: { parameter: 'hole_diameter' },
      },
      { id: 'bottom-horizontal', kind: 'horizontal', lineId: 'bottom' },
      { id: 'left-vertical', kind: 'vertical', lineId: 'left' },
      { id: 'opposite-widths', kind: 'equal', firstLineId: 'bottom', secondLineId: 'top' },
    ],
  };
}
