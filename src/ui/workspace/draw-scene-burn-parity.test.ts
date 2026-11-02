// Rolling audit v9 R5 (ADR-683 Amendment 2): the canvas paints exactly what the
// job burns. Each row (draw-scene-burn-parity-rows.test-support.ts) builds a scene, replays
// drawScene's fills and compares every point of a grid with compileJob's hatch,
// then checks clicks. A point shown and not burned is allowed only in a row's
// named Output-off area, and one burned and not shown only under a hidden
// operation (both KNOWN rules).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hitTest, type RasterImage, type SceneObject } from '../../core/scene';
import { hitTestCandidates } from '../../core/scene/hit-test-candidates';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import {
  burnProbe,
  mismatches,
  paintEvents,
  shownAt,
  type PaintEvent,
} from './draw-scene-burn-parity-harness.test-support';
import { ROWS } from './draw-scene-burn-parity-rows.test-support';
import {
  caption,
  CENTRE,
  fillOp,
  frameOuter,
  frameWindow,
  imageOp,
  lbrnProject,
  lineOp,
  OP_ONE,
  OP_TWO,
  photo,
  plate,
  project,
  square,
  SQUARE_EDGE,
} from './draw-scene-burn-parity-scenes.test-support';
import { workspaceHitTest, workspaceHitTestCandidates } from './workspace-hit-test';

const painted = vi.hoisted(() => ({ events: [] as unknown[] }));

vi.mock('./draw-raster', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // jsdom cannot decode a bitmap: record where the opaque photo is blitted.
  drawRasterImage: (_ctx: unknown, image: RasterImage) => {
    const { bounds, transform } = image;
    const box = [
      { x: bounds.minX + transform.x, y: bounds.minY + transform.y },
      { x: bounds.maxX + transform.x, y: bounds.maxY + transform.y },
    ];
    painted.events.push({ kind: 'photo', id: image.id, box });
  },
}));

beforeEach(() => resetStore());
afterEach(() => {
  vi.unstubAllGlobals();
  useUiStore.setState({ wireframeView: false });
});

describe('the canvas paints what compileJob burns (R5)', () => {
  it.each(ROWS.map((row) => [row.name, row] as const))('%s', (_name, row) => {
    const current = row.build();
    const events = paintEvents(painted, current);
    const burned = burnProbe(current);
    const probed = row
      .probes(current)
      .map(([at]) => [at, shownAt(current, events, at), burned(at)] as const);
    expect(probed).toEqual(row.probes(current));

    const { points, wrong } = mismatches(events, current, {
      ...(row.shownNotOutput === undefined ? {} : { shownNotOutput: row.shownNotOutput }),
      ...(row.burnedNotShown === undefined ? {} : { burnedNotShown: row.burnedNotShown }),
    });
    expect(points).toBeGreaterThan(50);
    expect(wrong).toEqual([]);
  });
});

describe('a click picks what the canvas shows (R5)', () => {
  const clickRows = ROWS.filter((row) => row.clicks !== undefined);
  it.each(clickRows.map((row) => [row.name, row] as const))('%s', (_name, row) => {
    const current = row.build();
    for (const [at, id] of row.clicks?.(current) ?? []) {
      expect([at, hitTest(current.scene, at)]).toEqual([at, id]);
      expect(hitTestCandidates(current.scene, at)[0]).toBe(id);
    }
  });

  const wireframeRows = ROWS.filter((row) => row.wireframeClicks !== undefined);
  it.each(wireframeRows.map((row) => [row.name, row] as const))(
    'in Wireframe, an empty interior lets a click through: %s',
    (_name, row) => {
      const current = row.build();
      expect(paintEvents(painted, current, true)).toEqual([]);
      for (const [at, id] of row.wireframeClicks?.(current) ?? []) {
        expect([at, hitTest(current.scene, at, { wireframe: true })]).toEqual([at, id]);
        expect(hitTestCandidates(current.scene, at, { wireframe: true })[0]).toBe(id);
      }
    },
  );

  it('the workspace asks with the view it is showing', () => {
    // R5-P2-2: a Line square drawn before a Fill plate that covers it.
    const current = project([square(), plate()], [fillOp(), lineOp()]);
    expect(workspaceHitTest(current.scene, CENTRE)).toBe('plate');
    expect(workspaceHitTestCandidates(current.scene, CENTRE)[0]).toBe('plate');

    useUiStore.setState({ wireframeView: true });
    expect(workspaceHitTest(current.scene, CENTRE)).toBe('square');
    expect(workspaceHitTest(current.scene, SQUARE_EDGE)).toBe('square');
    expect(workspaceHitTestCandidates(current.scene, CENTRE)[0]).toBe('square');
  });
});

describe('.lbrn Cut + Scan is the route R5-P1-3 names', () => {
  it('binds both shapes Line then Fill', () => {
    const current = lbrnProject();
    const modes = current.scene.objects.map((object) =>
      (('paths' in object ? object.paths[0]?.operationIds : undefined) ?? []).map(
        (id) => current.scene.layers.find((layer) => layer.id === id)?.mode,
      ),
    );
    expect(modes).toEqual([
      ['line', 'fill'],
      ['line', 'fill'],
    ]);
  });
});

describe('the clip budget is one per frame (R5-P3-2)', () => {
  it('paints a second split pool whole once the first has spent the frame’s budget', () => {
    // Two pools, each a frame and 360 captions over photos: 361 parts of 1,448 segments.
    const stack = (operation: string, prefix: string): SceneObject[] =>
      Array.from({ length: 360 }, (_, i) => [
        { ...photo, id: `${prefix}-photo-${i}` },
        { ...caption(), id: `${prefix}-caption-${i}`, operationIds: [operation] },
      ]).flat();
    const current = project(
      [
        { ...frameOuter(), operationIds: [OP_ONE] },
        { ...frameWindow(), operationIds: [OP_ONE] },
        ...stack(OP_ONE, 'a'),
        { ...frameOuter(), id: 'outer-b', operationIds: [OP_TWO] },
        { ...frameWindow(), id: 'window-b', operationIds: [OP_TWO] },
        ...stack(OP_TWO, 'b'),
      ],
      [fillOp(), fillOp(OP_TWO), imageOp()],
    );
    const ink = paintEvents(painted, current).filter(
      (event): event is Extract<PaintEvent, { kind: 'ink' }> => event.kind === 'ink',
    );

    const whole = ink.filter((event) => event.clips.length === 0);
    expect(whole).toHaveLength(1);
    expect(ink.length - whole.length).toBeGreaterThan(300);
  });
});
