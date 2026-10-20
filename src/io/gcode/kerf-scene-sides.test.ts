// Which side of a contour the kerf offset goes to, end to end (ADR-486
// Amendment 3). The side is judged among the Line contours of the whole scene,
// whatever the output scope, as laser leads judge their scrap side (ADR-626
// Amendment 1): a hole cut by its own operation shrinks like a hole drawn on
// the plate's operation. A closed shape on an operation that neither offsets
// kerf, nor asks for leads, nor leaves tabs (a score ring, a sheet border) is
// not read as a part edge, and Job Review says so.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { CutGroup, Job } from '../../core/job';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type OutputScope,
  type Polyline,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { compileDiagnosticWarnings } from '../../ui/laser/compile-diagnostic-warnings';
import { emitGcode } from './emit-gcode';
import { prepareOutput } from './prepare-output';

const KERF = { kerfOffsetMm: 0.5 } as const;

function square(min: number, max: number): Polyline {
  return {
    closed: true,
    points: [
      { x: min, y: min },
      { x: max, y: min },
      { x: max, y: max },
      { x: min, y: max },
    ],
  };
}

// Drawn 40 mm and 10 mm wide: with a 0.5 mm Kerf Offset the plate's cut is
// 41 mm wide and the hole's 9 mm; a hole offset as an outline is cut 11 mm.
const PLATE = square(20, 60);
const HOLE = square(35, 45);

function layer(id: string, settings: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id, color: '#ff0000', name: id }), ...settings };
}

function shape(
  id: string,
  polyline: Polyline | ReadonlyArray<Polyline>,
  operationIds: ReadonlyArray<string>,
): SceneObject {
  const polylines = 'points' in polyline ? [polyline] : [...polyline];
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    operationIds,
    paths: [{ color: '#ff0000', polylines }],
  };
}

function project(layers: ReadonlyArray<Layer>, objects: ReadonlyArray<SceneObject>): Project {
  return {
    ...createProject(DEFAULT_DEVICE_PROFILE),
    scene: { layers: [...layers], objects: [...objects] },
  };
}

function prepared(input: Project, outputScope?: OutputScope): Job {
  const output = prepareOutput(input, outputScope === undefined ? {} : { outputScope });
  if (!output.ok) throw new Error('expected the project to prepare');
  return output.job;
}

/** The width of every closed contour each operation cuts, rounded to the
 * offset engine's grid, as "operation: width". */
function cutWidths(job: Job): string[] {
  return job.groups
    .filter((group): group is CutGroup => group.kind === 'cut')
    .flatMap((group) =>
      group.segments
        .filter((segment) => segment.closed)
        .map((segment) => {
          const xs = segment.polyline.map((point) => point.x);
          const width = Math.round((Math.max(...xs) - Math.min(...xs)) * 1000) / 1000;
          return `${group.layerId}: ${width}`;
        }),
    )
    .sort();
}

function assumedSides(
  job: Job,
): ReadonlyArray<{ readonly count: number; readonly aroundName: string }> {
  return (job.diagnostics ?? []).flatMap((diagnostic) =>
    diagnostic.kind === 'kerf-side-assumed'
      ? [{ count: diagnostic.count, aroundName: diagnostic.aroundName }]
      : [],
  );
}

const SELECT_HOLE: OutputScope = {
  cutSelectedGraphics: true,
  useSelectionOrigin: false,
  selectedObjectIds: ['hole'],
};

describe('the side the kerf offset goes to (ADR-486 Amendment 3)', () => {
  it('shrinks a hole cut by its own operation, as it does a hole on the plate’s operation', () => {
    const job = prepared(
      project(
        [layer('outer', KERF), layer('inner', KERF)],
        [shape('plate', PLATE, ['outer']), shape('hole', HOLE, ['inner'])],
      ),
    );
    expect(cutWidths(job)).toEqual(['inner: 9', 'outer: 41']);
    expect(assumedSides(job)).toEqual([]);
  });

  it('writes the hole on its own operation to G-code at its shrunk size', () => {
    const gcode = emitGcode(
      project(
        [layer('outer', KERF), layer('inner', KERF)],
        [shape('plate', PLATE, ['outer']), shape('hole', HOLE, ['inner'])],
      ),
    ).gcode;
    const xs = [...gcode.matchAll(/^G1\b.*?X(-?\d+(?:\.\d+)?)/gm)].map((match) => Number(match[1]));
    const holeXs = xs.filter((x) => x > 30 && x < 50);
    expect(Math.min(...holeXs)).toBeCloseTo(35.5, 3);
    expect(Math.max(...holeXs)).toBeCloseTo(44.5, 3);
  });

  it('leaves a hole on the plate’s own operation as it was', () => {
    const job = prepared(
      project([layer('cut', KERF)], [shape('plate', PLATE, ['cut']), shape('hole', HOLE, ['cut'])]),
    );
    expect(cutWidths(job)).toEqual(['cut: 41', 'cut: 9']);
    expect(assumedSides(job)).toEqual([]);
    // One compound path is unchanged too.
    const compound = prepared(
      project([layer('cut', KERF)], [shape('plate', [PLATE, HOLE], ['cut'])]),
    );
    expect(cutWidths(compound)).toEqual(['cut: 41', 'cut: 9']);
  });

  it('still shrinks the hole when only the hole is selected', () => {
    for (const layers of [[layer('cut', KERF)], [layer('outer', KERF), layer('inner', KERF)]]) {
      const plateOn = layers.length === 1 ? 'cut' : 'outer';
      const holeOn = layers.length === 1 ? 'cut' : 'inner';
      const job = prepared(
        project(layers, [shape('plate', PLATE, [plateOn]), shape('hole', HOLE, [holeOn])]),
        SELECT_HOLE,
      );
      expect(cutWidths(job)).toEqual([`${holeOn}: 9`]);
    }
  });

  it('still shrinks the hole when the plate’s operation is output off', () => {
    const job = prepared(
      project(
        [layer('outer', { ...KERF, output: false }), layer('inner', KERF)],
        [shape('plate', PLATE, ['outer']), shape('hole', HOLE, ['inner'])],
      ),
    );
    expect(cutWidths(job)).toEqual(['inner: 9']);
  });

  it('reads an outline whose operation leaves tabs or asks for leads as a part edge', () => {
    for (const outer of [{ tabsEnabled: true }, { leadInEnabled: true, leadOutEnabled: true }]) {
      const job = prepared(
        project(
          [layer('outer', { ...outer, output: false }), layer('inner', KERF)],
          [shape('plate', PLATE, ['outer']), shape('hole', HOLE, ['inner'])],
        ),
      );
      expect(cutWidths(job)).toEqual(['inner: 9']);
      expect(assumedSides(job)).toEqual([]);
    }
  });

  it('does not let a score ring between the plate and its hole flip the hole', () => {
    const ring = shape('ring', square(30, 50), ['score']);
    const same = prepared(
      project(
        [layer('cut', KERF), layer('score', { power: 10 })],
        [shape('plate', PLATE, ['cut']), ring, shape('hole', HOLE, ['cut'])],
      ),
    );
    expect(cutWidths(same)).toEqual(['cut: 41', 'cut: 9', 'score: 20']);
    expect(assumedSides(same)).toEqual([{ count: 1, aroundName: 'score' }]);
    const own = prepared(
      project(
        [layer('outer', KERF), layer('score', { power: 10 }), layer('inner', KERF)],
        [shape('plate', PLATE, ['outer']), ring, shape('hole', HOLE, ['inner'])],
      ),
    );
    expect(cutWidths(own)).toEqual(['inner: 9', 'outer: 41', 'score: 20']);
    expect(assumedSides(own)).toEqual([{ count: 1, aroundName: 'score' }]);
  });

  it('does not turn the plate into a hole inside a sheet border', () => {
    const shapes = [
      shape('border', square(10, 70), ['border']),
      shape('plate', PLATE, ['outer']),
      shape('hole', HOLE, ['inner']),
    ];
    for (const border of [{}, { output: false }]) {
      const job = prepared(
        project([layer('border', border), layer('outer', KERF), layer('inner', KERF)], shapes),
      );
      const borderCut = 'output' in border ? [] : ['border: 60'];
      expect(cutWidths(job)).toEqual([...borderCut, 'inner: 9', 'outer: 41']);
      expect(assumedSides(job)).toEqual([
        { count: 1, aroundName: 'border' },
        { count: 1, aroundName: 'border' },
      ]);
    }
    // A border that burns nothing holds no part and is not reported.
    const reference = prepared(
      project([layer('border', { power: 0 }), layer('outer', KERF), layer('inner', KERF)], shapes),
    );
    expect(cutWidths(reference)).toEqual(['border: 60', 'inner: 9', 'outer: 41']);
    expect(assumedSides(reference)).toEqual([]);
  });

  it('counts the plate once when two operations cut it', () => {
    const job = prepared(
      project(
        [layer('cut', KERF), layer('again', { kerfOffsetMm: 0.1 }), layer('inner', KERF)],
        [shape('plate', PLATE, ['cut', 'again']), shape('hole', HOLE, ['inner'])],
      ),
    );
    expect(cutWidths(job)).toEqual(['again: 40.2', 'cut: 41', 'inner: 9']);
  });

  it('says so when an outline without kerf may be the plate a hole sits in', () => {
    // A closed shape on an operation without kerf, leads or tabs may be a part
    // cut uncompensated, or only a score line or a sheet border; the kerf
    // takes it for the latter, as it always has, and Job Review says how to
    // make it count.
    const job = prepared(
      project(
        [layer('outer'), layer('inner', KERF)],
        [shape('plate', PLATE, ['outer']), shape('hole', HOLE, ['inner'])],
      ),
    );
    expect(cutWidths(job)).toEqual(['inner: 11', 'outer: 40']);
    expect(assumedSides(job)).toEqual([{ count: 1, aroundName: 'outer' }]);
    expect(compileDiagnosticWarnings(job)).toEqual([
      'Kerf offset on layer "inner": 1 shape sits inside a closed shape on layer "outer", which has no kerf offset, leads or tabs, so it was offset as if that shape were only a score line or border. If "outer" cuts parts out, this shape was offset to the wrong side and comes out 2 mm off its drawn width: give "outer" a kerf offset, or cut both on one layer.',
    ]);
  });
});
