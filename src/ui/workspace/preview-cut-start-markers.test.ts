import { describe, expect, it } from 'vitest';
import { toSceneCoords } from '../../core/devices';
import type { JobOriginPlacement } from '../../core/job';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type Project,
  type Vec2,
} from '../../core/scene';
import { cutStartPointAt } from '../../core/scene/cut-start-points';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import { parseSvg } from '../../io/svg';
import { buildPreviewToolpathFromPrepared } from './draw-preview';
import { drawPreviewCutStartMarkers, previewCutStartMarkers } from './preview-cut-start-markers';
import type { ViewTransform } from './view-transform';

// A rectangle drawn from the middle of its bottom edge, so the automatic
// start has a corner to move to.
function midEdgeRectangle(x: number, y: number): ReadonlyArray<Vec2> {
  return [
    { x: x + 10, y },
    { x: x + 20, y },
    { x: x + 20, y: y + 10 },
    { x, y: y + 10 },
    { x, y },
  ];
}

const TRIANGLE: ReadonlyArray<Vec2> = [
  { x: 110, y: 40 },
  { x: 140, y: 40 },
  { x: 125, y: 70 },
];

function closedPath(color: string, loops: ReadonlyArray<ReadonlyArray<Vec2>>): ColoredPath {
  return { color, polylines: loops.map((points) => ({ points, closed: true })) };
}

// Closed shapes only (every G-code entry is then a closed-cut start): automatic
// starts on two layers, one with kerf offset, a curve, and one operator start.
function startPointProject(): Project {
  const pinned = closedPath('#ff0000', [midEdgeRectangle(20, 120)]);
  const start = cutStartPointAt(pinned, 1, 0, { x: 20, y: 130 });
  if (start === null) throw new Error('fixture start is on the contour');
  const circle = parseSvg({
    svgText:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">' +
      '<circle cx="80" cy="60" r="12" stroke="#00aa00" fill="none"/></svg>',
    id: 'circle',
    source: 'circle.svg',
  }).object;
  if (circle === null) throw new Error('circle fixture produced no geometry');
  return {
    ...createProject(),
    optimization: {
      ...createProject().optimization,
      bestStartPoint: true,
      preferCorners: true,
      bestDirection: true,
    },
    scene: {
      ...EMPTY_SCENE,
      objects: [
        {
          kind: 'imported-svg',
          id: 'shapes',
          source: 'shapes.svg',
          bounds: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            closedPath('#ff0000', [midEdgeRectangle(20, 20), TRIANGLE]),
            pinned,
            closedPath('#00aa00', [midEdgeRectangle(60, 150)]),
          ],
          cutStartPoints: [start],
        },
        circle,
      ],
      layers: [
        createLayer({ id: 'plain', color: '#ff0000' }),
        { ...createLayer({ id: 'kerf', color: '#00aa00' }), kerfOffsetMm: 0.1 },
      ],
    },
  };
}

type Entry = { readonly at: Vec2; readonly next: Vec2 };

function inside(p: Vec2, minX: number, minY: number, maxX: number, maxY: number): boolean {
  const eps = 1e-6;
  return p.x >= minX - eps && p.x <= maxX + eps && p.y >= minY - eps && p.y <= maxY + eps;
}

// Where the program first switches the beam on after moving with it off, and
// the point that first burning move heads for.
function gcodeBurnEntries(gcode: string): ReadonlyArray<Entry> {
  const entries: Entry[] = [];
  let position: Vec2 = { x: 0, y: 0 };
  let burning = false;
  for (const line of gcode.split('\n')) {
    const code = (line.split(';')[0] ?? '').trim();
    const move = /^G([01])\b/.exec(code);
    if (move === null) continue;
    const target = { x: word(code, 'X', position.x), y: word(code, 'Y', position.y) };
    const nowBurning = move[1] === '1' && word(code, 'S', burning ? 1 : 0) > 0;
    if (nowBurning && !burning) entries.push({ at: position, next: target });
    burning = nowBurning;
    position = target;
  }
  return entries;
}

function word(code: string, letter: 'X' | 'Y' | 'S', modal: number): number {
  const value = new RegExp(`${letter}(-?[\\d.]+)`).exec(code)?.[1];
  return value === undefined ? modal : Number(value);
}

function expectMarkersOnEntries(project: Project, jobOrigin?: JobOriginPlacement): void {
  const prepared = prepareOutput(project, jobOrigin === undefined ? {} : { jobOrigin });
  if (!prepared.ok) throw new Error('fixture must prepare');
  const toScene = (p: Vec2): Vec2 =>
    toSceneCoords(
      { x: p.x - prepared.jobOriginOffset.x, y: p.y - prepared.jobOriginOffset.y },
      project.device,
    );
  const entries = gcodeBurnEntries(emitPreparedGcode(prepared).gcode);
  const markers = previewCutStartMarkers(
    buildPreviewToolpathFromPrepared(project, prepared, jobOrigin),
  );
  expect(markers).toHaveLength(entries.length);
  expect(markers.filter((marker) => marker.operatorSet)).toHaveLength(1);
  markers.forEach((marker, index) => {
    const entry = entries[index];
    if (entry === undefined) throw new Error('missing entry');
    const at = toScene(entry.at);
    const next = toScene(entry.next);
    const length = Math.hypot(next.x - at.x, next.y - at.y);
    // G-code keeps three decimals; the marks keep full precision.
    expect(marker.at.x).toBeCloseTo(at.x, 2);
    expect(marker.at.y).toBeCloseTo(at.y, 2);
    expect(marker.direction.x).toBeCloseTo((next.x - at.x) / length, 2);
    expect(marker.direction.y).toBeCloseTo((next.y - at.y) / length, 2);
  });
}

describe('preview start points', () => {
  it('sit on the G-code entry of every closed cut, heading the way it cuts', () => {
    expectMarkersOnEntries(startPointProject());
  });

  it('stay on the entries when the job is placed from a user origin', () => {
    expectMarkersOnEntries(startPointProject(), { startFrom: 'user-origin', anchor: 'center' });
  });

  it('follow the start to a corner only when the planner moves it', () => {
    const project = startPointProject();
    const rectangleMark = (candidate: Project): Vec2 | undefined =>
      previewCutStartMarkers(
        buildPreviewToolpathFromPrepared(candidate, prepareOutput(candidate)),
      ).find((marker) => inside(marker.at, 20, 20, 40, 30))?.at;
    const moved = rectangleMark(project);
    expect([20, 40]).toContain(Math.round(moved?.x ?? 0));
    expect([20, 30]).toContain(Math.round(moved?.y ?? 0));
    const drawnStart = rectangleMark({ ...project, optimization: createProject().optimization });
    expect(drawnStart?.x).toBeCloseTo(30, 9);
    expect(drawnStart?.y).toBeCloseTo(20, 9);
  });

  it('draws one dot and one arrow per mark', () => {
    const project = startPointProject();
    const toolpath = buildPreviewToolpathFromPrepared(project, prepareOutput(project));
    const calls = { arc: 0, stroke: 0, fill: 0 };
    const ctx = {
      save: () => undefined,
      restore: () => undefined,
      setLineDash: () => undefined,
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      arc: () => {
        calls.arc += 1;
      },
      fill: () => {
        calls.fill += 1;
      },
      stroke: () => {
        calls.stroke += 1;
      },
    } as unknown as CanvasRenderingContext2D;
    const view: ViewTransform = { scale: 2, offsetX: 0, offsetY: 0 };
    drawPreviewCutStartMarkers(ctx, toolpath, view);
    expect(calls.arc).toBe(previewCutStartMarkers(toolpath).length);
    // Automatic and operator-set marks are drawn as two batches.
    expect(calls.fill).toBe(2);
    expect(calls.stroke).toBe(2);
  });
});
