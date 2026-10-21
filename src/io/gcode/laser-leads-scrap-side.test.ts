// Which side of a contour is scrap, end to end (ADR-626 Amendment 1). The
// side is judged among every Line contour of the scene, whatever the output
// scope, and only operations that ask for leads decide it: a closed shape on
// an operation without leads (a score line, a sheet border, or a part) leaves
// the contours it holds without leads, with a Job Review warning, rather than
// guessing a side that could put a lead into the part.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toSceneCoords, type DeviceProfile } from '../../core/devices';
import { pointInPolygon } from '../../core/geometry/point-in-polygon';
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
  type Vec2,
} from '../../core/scene';
import { prepareOutput } from './prepare-output';

const LEADS = { leadInEnabled: true, leadOutEnabled: true } as const;
const DEVICE = DEFAULT_DEVICE_PROFILE;

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

function project(
  layers: ReadonlyArray<Layer>,
  objects: ReadonlyArray<SceneObject>,
  device: DeviceProfile = DEVICE,
): Project {
  return { ...createProject(device), scene: { layers: [...layers], objects: [...objects] } };
}

function prepared(input: Project, outputScope?: OutputScope): Job {
  const output = prepareOutput(input, outputScope === undefined ? {} : { outputScope });
  if (!output.ok) throw new Error('expected the project to prepare');
  return output.job;
}

type Region = 'hole' | 'part' | 'outside';

function region(point: Vec2, device: DeviceProfile): Region {
  const scene = toSceneCoords(point, device);
  if (pointInPolygon(scene, HOLE.points)) return 'hole';
  return pointInPolygon(scene, PLATE.points) ? 'part' : 'outside';
}

/** Each cut contour of the lead operations: which shape it cuts, and where its
 * lead-in starts and its lead-outs end; no ends when it got no lead. */
function leadEnds(job: Job, device: DeviceProfile = DEVICE): string[] {
  return job.groups
    .filter((group): group is CutGroup => group.kind === 'cut' && group.laserLeads !== undefined)
    .flatMap((group) =>
      group.segments.map((segment) => {
        const xs = segment.polyline.map((point) => point.x);
        const width = Math.max(...xs) - Math.min(...xs);
        const name = width < 20 ? 'hole' : 'plate';
        if (segment.closed) return `${group.layerId} ${name}: no lead`;
        const ends = [
          segment.polyline[0],
          segment.polyline.at(-1),
          segment.finalPassBurn?.polyline.at(-1),
        ].flatMap((point) => (point === undefined ? [] : [region(point, device)]));
        return `${group.layerId} ${name}: ${[...new Set(ends)].join(' ')}`;
      }),
    )
    .sort();
}

function sideUnknown(job: Job): number {
  return (job.diagnostics ?? []).reduce(
    (count, diagnostic) =>
      diagnostic.kind === 'laser-leads-side-unknown' ? count + diagnostic.count : count,
    0,
  );
}

const SELECT_HOLE: OutputScope = {
  cutSelectedGraphics: true,
  useSelectionOrigin: false,
  selectedObjectIds: ['hole'],
};

describe('the scrap side of laser leads (ADR-626 Amendment 1)', () => {
  it('leads a separate hole into itself and the plate outward in the whole job', () => {
    const job = prepared(
      project(
        [layer('cut', LEADS)],
        [shape('plate', PLATE, ['cut']), shape('hole', HOLE, ['cut'])],
      ),
    );
    expect(leadEnds(job)).toEqual(['cut hole: hole', 'cut plate: outside']);
  });

  it('still leads the hole into itself when only the hole is selected', () => {
    const job = prepared(
      project(
        [layer('cut', LEADS)],
        [shape('plate', PLATE, ['cut']), shape('hole', HOLE, ['cut'])],
      ),
      SELECT_HOLE,
    );
    expect(leadEnds(job)).toEqual(['cut hole: hole']);
  });

  it("still leads the hole into itself when the plate's operation is output off", () => {
    const job = prepared(
      project(
        [layer('outer', { ...LEADS, output: false }), layer('inner', LEADS)],
        [shape('plate', PLATE, ['outer']), shape('hole', HOLE, ['inner'])],
      ),
    );
    expect(leadEnds(job)).toEqual(['inner hole: hole']);
  });

  it('gives a hole no lead, and says so, when an operation without leads holds it', () => {
    for (const output of [true, false]) {
      const job = prepared(
        project(
          [layer('outer', { output }), layer('inner', LEADS)],
          [shape('plate', PLATE, ['outer']), shape('hole', HOLE, ['inner'])],
        ),
      );
      expect(leadEnds(job)).toEqual(['inner hole: no lead']);
      expect(sideUnknown(job)).toBe(1);
    }
  });

  it('names each operation that leaves a side unknown, with its own count', () => {
    const job = prepared(
      project(
        [layer('Score'), layer('Border'), layer('inner', LEADS)],
        [
          shape('ring', PLATE, ['Score']),
          shape('hole', HOLE, ['inner']),
          shape('frame', square(65, 95), ['Border']),
          shape('slot', square(75, 85), ['inner']),
        ],
      ),
    );
    const unknown = (job.diagnostics ?? []).flatMap((diagnostic) =>
      diagnostic.kind === 'laser-leads-side-unknown'
        ? [`${diagnostic.aroundName}: ${diagnostic.count}`]
        : [],
    );
    expect(unknown.sort()).toEqual(['Border: 1', 'Score: 1']);
  });

  it("keeps the hole's leads out of the part when a score ring lies between", () => {
    const job = prepared(
      project(
        [layer('cut', LEADS), layer('score', { power: 10 })],
        [
          shape('plate', PLATE, ['cut']),
          shape('ring', square(30, 50), ['score']),
          shape('hole', HOLE, ['cut']),
        ],
      ),
    );
    expect(leadEnds(job)).toEqual(['cut hole: no lead', 'cut plate: outside']);
    expect(sideUnknown(job)).toBe(1);
  });

  it('does not turn the plate into a hole inside a sheet border', () => {
    const shapes = [
      shape('border', square(10, 70), ['border']),
      shape('plate', PLATE, ['cut']),
      shape('hole', HOLE, ['cut']),
    ];
    const burning = prepared(project([layer('cut', LEADS), layer('border')], shapes));
    expect(leadEnds(burning)).toEqual(['cut hole: no lead', 'cut plate: no lead']);
    expect(sideUnknown(burning)).toBe(2);
    // A border that burns nothing holds no part.
    const reference = prepared(
      project([layer('cut', LEADS), layer('border', { power: 0 })], shapes),
    );
    expect(leadEnds(reference)).toEqual(['cut hole: hole', 'cut plate: outside']);
    expect(sideUnknown(reference)).toBe(0);
  });

  it('reads each kerf contour of a plate drawn with its hole as the contour it came from', () => {
    const compound = shape('plate', [PLATE, HOLE], ['cut']);
    for (const kerfOffsetMm of [0.1, -0.1]) {
      const job = prepared(project([layer('cut', { ...LEADS, kerfOffsetMm })], [compound]));
      expect(leadEnds(job)).toEqual(['cut hole: hole', 'cut plate: outside']);
    }
  });

  it('reads a tabbed plate whole, so the hole inside it still leads into itself', () => {
    const job = prepared(
      project(
        [layer('outer', { ...LEADS, tabsEnabled: true }), layer('inner', LEADS)],
        [shape('plate', PLATE, ['outer']), shape('hole', HOLE, ['inner'])],
      ),
    );
    expect(leadEnds(job).filter((entry) => entry.startsWith('inner'))).toEqual([
      'inner hole: hole',
    ]);
  });

  it('reads the plate cut again with a kerf offset as the same outline', () => {
    for (const second of [{ ...LEADS, kerfOffsetMm: 0.1 }, { kerfOffsetMm: 0.1 }]) {
      const job = prepared(
        project(
          [layer('cut', LEADS), layer('again', second)],
          [shape('plate', PLATE, ['cut', 'again']), shape('hole', HOLE, ['cut'])],
        ),
      );
      const again = 'leadInEnabled' in second ? ['again plate: outside'] : [];
      expect(leadEnds(job)).toEqual([...again, 'cut hole: hole', 'cut plate: outside']);
      expect(sideUnknown(job)).toBe(0);
    }
  });
});
