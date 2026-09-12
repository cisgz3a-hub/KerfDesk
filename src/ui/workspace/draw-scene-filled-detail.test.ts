import { afterEach, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Polyline,
  type Project,
  type TracedImage,
} from '../../core/scene';
import { createDisplayPolylineCache } from './display-polylines';
import { drawScene } from './draw-scene';

class RecordedPath {
  readonly contours: number[][] = [];
  moveTo(x: number, y: number) {
    this.contours.push([x, y]);
  }
  lineTo(x: number, y: number) {
    this.contours.at(-1)!.push(x, y);
  }
}

afterEach(() => vi.unstubAllGlobals());

it('renders every filled hole through drawScene, reuses it through zoom, and refreshes replaced geometry', () => {
  vi.stubGlobal('Path2D', RecordedPath);
  const hole: Polyline = {
    closed: true,
    points: [
      { x: 4, y: 4 },
      { x: 6, y: 4 },
      { x: 6, y: 6 },
      { x: 4, y: 6 },
      { x: 4, y: 4 },
    ],
  };
  const polylines = Array.from({ length: 30_001 }, () => hole);
  const object: TracedImage = {
    kind: 'traced-image',
    id: 'fine-fill',
    source: 'detail.png',
    traceMode: 'filled-contours',
    bounds: { minX: 4, minY: 4, maxX: 6, maxY: 6 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines }],
  };
  const project: Project = {
    ...createProject(),
    scene: {
      layers: [createLayer({ id: '#000000', color: '#000000', mode: 'fill' })],
      objects: [object],
    },
  };
  const painted: Array<{ path: RecordedPath; rule: string }> = [];
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'measureText') return () => ({ width: 0 });
        if (prop === 'fill')
          return (path: unknown, rule: string) => {
            if (path instanceof RecordedPath) painted.push({ path, rule });
          };
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  const displayPolylineCache = createDisplayPolylineCache();
  const draw = (current: Project, zoomFactor: number) =>
    drawScene(ctx, 800, 600, current, {
      selectedId: null,
      preview: false,
      view: { zoomFactor, panX: 0, panY: 0 },
      displayPolylineCache,
    });
  draw(project, 1);
  draw(project, 3.83);
  expect(painted).toHaveLength(2);
  expect(painted[0]!.path.contours).toHaveLength(30_001);
  expect(painted[0]!.path.contours[30_000]).toEqual([4, 4, 6, 4, 6, 6, 4, 6, 4, 4]);
  expect(painted[0]!.rule).toBe('evenodd');
  expect(painted[1]!.path).toBe(painted[0]!.path);
  const updated = { ...object, paths: [{ ...object.paths[0]!, polylines: [hole] }] };
  draw({ ...project, scene: { ...project.scene, objects: [updated] } }, 3.83);
  expect(painted[2]!.path).not.toBe(painted[0]!.path);
  expect(painted[2]!.path.contours).toHaveLength(1);
});
