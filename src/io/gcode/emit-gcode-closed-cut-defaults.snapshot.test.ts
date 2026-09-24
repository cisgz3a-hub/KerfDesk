// Byte pin for closed Line cuts under default settings (ADR-385).
//
// Written against the pipeline BEFORE start-point selection, Set Start Point,
// Overcut and tab spacing existed. Every one of those features is opt-in, so
// these jobs — closed shapes that start mid-edge, nested holes, kerf offset,
// automatic tabs with skip-inner, multi-pass, open paths and the 4040 contour
// entry — must keep producing exactly these bytes unless an operator turns a
// feature on. A change here is a change to what existing projects cut.

import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { parseSvg } from '../svg';
import { emitGcode } from './emit-gcode';

function polylineObject(
  id: string,
  color: string,
  polylines: ReadonlyArray<{ readonly points: ReadonlyArray<Vec2>; readonly closed: boolean }>,
): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color, polylines }],
  };
}

// A 20 × 10 rectangle whose first node sits in the middle of its bottom edge,
// so the default start mark lands mid-edge.
function midEdgeRectangle(x: number, y: number): ReadonlyArray<Vec2> {
  return [
    { x: x + 10, y },
    { x: x + 20, y },
    { x: x + 20, y: y + 10 },
    { x, y: y + 10 },
    { x, y },
    { x: x + 10, y },
  ];
}

function square(x: number, y: number, size: number): ReadonlyArray<Vec2> {
  return [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
    { x, y },
  ];
}

function curveObject(id: string, color: string, svgBody: string): SceneObject {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${svgBody}</svg>`;
  const parsed = parseSvg({ svgText: svg, id, source: `${id}.svg` });
  if (parsed.object === null) throw new Error(`${id} fixture produced no geometry`);
  return parsed.object;
}

function lineLayer(id: string, color: string, patch: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id, color }), ...patch };
}

// Plain cuts, a nested hole, an open path and a D-shape with two corners on
// one two-pass operation; a kerf-compensated operation; a tabbed operation
// with a hole that skip-inner keeps whole.
function mixedClosedCutProject(): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      ...EMPTY_SCENE,
      objects: [
        polylineObject('mid-edge', '#ff0000', [
          { points: midEdgeRectangle(20, 20), closed: true },
          { points: square(60, 20, 30), closed: true },
          { points: square(70, 30, 10), closed: true },
          {
            points: [
              { x: 20, y: 70 },
              { x: 45, y: 80 },
              { x: 70, y: 70 },
            ],
            closed: false,
          },
        ]),
        curveObject(
          'd-shape',
          '#ff0000',
          '<path d="M 120 20 L 120 60 A 20 20 0 0 0 120 20 Z" stroke="#ff0000" fill="none"/>',
        ),
        curveObject(
          'kerf-shapes',
          '#00aa00',
          '<rect x="20" y="100" width="30" height="20" stroke="#00aa00" fill="none"/>' +
            '<circle cx="80" cy="110" r="10" stroke="#00aa00" fill="none"/>',
        ),
        polylineObject('tabbed', '#0000ff', [
          { points: midEdgeRectangle(110, 100), closed: true },
          { points: square(140, 140, 40), closed: true },
          { points: square(150, 150, 20), closed: true },
        ]),
      ],
      layers: [
        lineLayer('plain', '#ff0000', { passes: 2 }),
        lineLayer('kerf', '#00aa00', { kerfOffsetMm: 0.1 }),
        lineLayer('tabs', '#0000ff', {
          tabsEnabled: true,
          tabSizeMm: 1,
          tabsPerShape: 3,
          tabSkipInnerShapes: true,
        }),
      ],
    },
  };
}

// The 4040-safe dialect adds a laser-off contour entry ahead of every
// contour start (ADR-239), so the start vertex also decides where it runs.
function contourEntryProject(): Project {
  const base = createProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
  return {
    ...base,
    scene: {
      ...EMPTY_SCENE,
      objects: [
        polylineObject('entry-shapes', '#ff0000', [
          { points: midEdgeRectangle(30, 30), closed: true },
          { points: square(80, 30, 25), closed: true },
        ]),
        curveObject(
          'entry-circle',
          '#ff0000',
          '<circle cx="150" cy="60" r="15" stroke="#ff0000" fill="none"/>',
        ),
      ],
      layers: [lineLayer('entry', '#ff0000', { fillOverscanMm: 3 })],
    },
  };
}

const CORPUS: ReadonlyArray<{ readonly id: string; readonly project: () => Project }> = [
  { id: 'mixed-closed-cuts', project: mixedClosedCutProject },
  { id: 'contour-entry-closed-cuts', project: contourEntryProject },
];

describe('closed Line cuts keep their default output', () => {
  it.each(CORPUS)('$id is byte-pinned', ({ project }) => {
    const { gcode, preflight } = emitGcode(project());
    expect(preflight.issues.filter((issue) => issue.code === 'compile-failed')).toEqual([]);
    expect(gcode.length).toBeGreaterThan(0);
    expect(gcode).toMatchSnapshot();
  });
});
