// Closed cut segments must return to their start so the G-code emitter (which
// walks the point list and ignores the `closed` flag) draws the closing edge.
// DXF entities drop the seam vertex and trust `closed`, so before the
// withClosingPoint fix a closed DXF shape cut open — the final edge was never
// emitted and the part stayed attached to the stock. See CutSegment (job.ts):
// "for a closed segment, the last point equals the first by construction".

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { parseDxf } from '../../io/dxf';
import { emitGcode } from '../../io/gcode/emit-gcode';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../scene';
import { compileJob } from './compile-job';

const dev = DEFAULT_DEVICE_PROFILE;

function closedSquare(color: string, points: ReadonlyArray<{ x: number; y: number }>): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'sq',
    source: 'sq.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color, polylines: [{ closed: true, points }] }],
  };
}

// Four distinct corners, closed flag set, first vertex NOT repeated — exactly
// the shape parse-dxf hands downstream after dxf-entities pops the seam.
const SQUARE_NO_SEAM = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

// A minimal ASCII DXF with one closed LWPOLYLINE square (group 70 bit 1 = closed).
const DXF_CLOSED_SQUARE = [
  '0',
  'SECTION',
  '2',
  'ENTITIES',
  '0',
  'LWPOLYLINE',
  '8',
  '0',
  '90',
  '4',
  '70',
  '1',
  '10',
  '10.0',
  '20',
  '10.0',
  '10',
  '30.0',
  '20',
  '10.0',
  '10',
  '30.0',
  '20',
  '30.0',
  '10',
  '10.0',
  '20',
  '30.0',
  '0',
  'ENDSEC',
  '0',
  'EOF',
  '',
].join('\n');

// Pull the ordered (x, y) targets of every G0/G1 motion line out of G-code.
function motionPoints(gcode: string): ReadonlyArray<{ x: number; y: number }> {
  const out: { x: number; y: number }[] = [];
  for (const line of gcode.split('\n')) {
    if (!/^G[01]\b/.test(line)) continue;
    const x = /X(-?\d+(?:\.\d+)?)/.exec(line);
    const y = /Y(-?\d+(?:\.\d+)?)/.exec(line);
    if (x && y) out.push({ x: Number(x[1]), y: Number(y[1]) });
  }
  return out;
}

describe('compileJob — closed cut segment closure', () => {
  it('appends the closing vertex when a closed polyline omits its repeated seam', () => {
    const layer = createLayer({ id: 'L1', color: '#ff0000' });
    const obj = closedSquare('#ff0000', SQUARE_NO_SEAM);
    const job = compileJob({ objects: [obj], layers: [layer] }, dev);
    const group = job.groups[0];
    expect(group?.kind).toBe('cut');
    const seg = group?.kind === 'cut' ? group.segments[0] : undefined;
    expect(seg?.closed).toBe(true);
    const pts = seg?.polyline ?? [];
    expect(pts).toHaveLength(5); // four corners + closing vertex
    expect(pts[pts.length - 1]).toEqual(pts[0]);
  });

  it('leaves an already-closed polyline (repeated seam) unchanged', () => {
    const layer = createLayer({ id: 'L1', color: '#ff0000' });
    const obj = closedSquare('#ff0000', [...SQUARE_NO_SEAM, { x: 0, y: 0 }]);
    const job = compileJob({ objects: [obj], layers: [layer] }, dev);
    const group = job.groups[0];
    const seg = group?.kind === 'cut' ? group.segments[0] : undefined;
    expect(seg?.polyline).toHaveLength(5); // no double-append
  });

  it('emits the closing edge for a closed DXF LWPOLYLINE (regression)', () => {
    const parsed = parseDxf({ dxfText: DXF_CLOSED_SQUARE, id: 'dxf', source: 'sq.dxf' });
    expect(parsed.kind).toBe('ok');
    if (parsed.kind !== 'ok' || parsed.object === null) throw new Error('parse failed');
    const color = parsed.object.paths[0]?.color ?? '#000000';
    const project: Project = {
      ...createProject(),
      scene: {
        ...EMPTY_SCENE,
        objects: [parsed.object],
        layers: [createLayer({ id: 'cut', color })],
      },
    };
    // Scan only the cut body, before the postamble `M5` + park move, so the
    // last motion is the closing edge rather than the return-to-origin park.
    const gcode = emitGcode(project).gcode;
    const pts = motionPoints(gcode.slice(0, gcode.indexOf('M5')));
    expect(pts.length).toBeGreaterThanOrEqual(5); // G0 lead-in + 4 cut edges
    // The cut returns to where it started: the final cut target equals the
    // first (the G0 lead-in point).
    expect(pts[pts.length - 1]).toEqual(pts[0]);
  });
});
