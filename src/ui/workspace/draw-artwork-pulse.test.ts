import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  sceneLayerVisibility,
  type ImportedSvg,
  type Layer,
  type Project,
} from '../../core/scene';
import type { PulsePieceFrame } from './artwork-pulse';
import { ArtworkPulsePainter } from './draw-artwork-pulse';
import * as objectDisplay from './object-display';

const view = { scale: 1, offsetX: 0, offsetY: 0 };

function square(id: string, operationId: string, x: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: 10, maxX: x + 8, maxY: 18 },
    transform: IDENTITY_TRANSFORM,
    operationIds: [operationId],
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x, y: 10 },
              { x: x + 8, y: 10 },
              { x: x + 8, y: 18 },
              { x, y: 18 },
              { x, y: 10 },
            ],
          },
        ],
      },
    ],
  };
}

// Repeated imports: each piece has its own operation, all with the same settings.
function repeatedImports(count: number): { project: Project; layers: Layer[] } {
  const layers = Array.from({ length: count }, (_, index) =>
    createLayer({ id: `op-${index}`, color: '#2563eb' }),
  );
  const objects = layers.map((layer, index) => square(`piece-${index}`, layer.id, index * 10));
  const base = createProject();
  return { project: { ...base, scene: { ...base.scene, objects, layers } }, layers };
}

function canvas2d(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 200;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2d context missing');
  return ctx;
}

afterEach(() => vi.restoreAllMocks());

describe('ArtworkPulsePainter (ADR-620)', () => {
  it('keeps Fill artwork outlined in wireframe and invalidates cached design geometry', () => {
    const fill = createLayer({ id: 'fill', color: '#2563eb', mode: 'fill' });
    const base = createProject();
    const project = {
      ...base,
      scene: { ...base.scene, objects: [square('piece', 'fill', 10)], layers: [fill] },
    };
    const painter = new ArtworkPulsePainter();
    const painted = vi.spyOn(objectDisplay, 'paintObjectDisplay');
    const ctx = canvas2d();
    const pieces = [pulse('piece', 'fill')];
    painter.draw(ctx, project, view, pieces, 'design');
    expect(painted.mock.calls.at(-1)?.[2].paths[0]?.paint.kind).toBe('fill');
    painted.mockClear();
    painter.draw(ctx, project, view, pieces, 'wireframe');
    expect(painted).toHaveBeenCalledOnce();
    expect(painted.mock.calls.at(-1)?.[2].paths[0]?.paint.kind).toBe('stroke');
    painted.mockClear();
    painter.draw(ctx, project, view, pieces, 'wireframe');
    expect(painted).not.toHaveBeenCalled();
    painter.draw(ctx, project, view, pieces, 'design');
    expect(painted.mock.calls.at(-1)?.[2].paths[0]?.paint.kind).toBe('fill');
  });

  it('does not rebuild scene-wide indexes on unchanged animation frames', () => {
    const { project } = repeatedImports(30);
    const lookup = vi.spyOn(sceneLayerVisibility, 'lookup');
    const layers = vi.spyOn(project.scene.layers, 'map');
    const objects = vi.spyOn(project.scene.objects, 'map');
    const painter = new ArtworkPulsePainter();
    const ctx = canvas2d();
    const pieces = [pulse('piece-0', 'op-0')];
    painter.draw(ctx, project, view, pieces);
    lookup.mockClear();
    layers.mockClear();
    objects.mockClear();

    for (let frame = 0; frame < 60; frame += 1) painter.draw(ctx, project, view, pieces);

    expect(lookup).not.toHaveBeenCalled();
    expect(layers).not.toHaveBeenCalled();
    expect(objects).not.toHaveBeenCalled();
    painter.draw(ctx, { ...project, scene: { ...project.scene, layers: [] } }, view, pieces);
    expect(lookup).toHaveBeenCalledOnce();
  });

  it('repaints a cached pulse when a bound peer changes its fill/stroke styling', () => {
    const line = createLayer({ id: 'line', color: '#2563eb' });
    const fill = createLayer({ id: 'fill', color: '#dc2626', mode: 'fill' });
    const object = { ...square('both', 'line', 10), operationIds: ['line', 'fill'] };
    const base = createProject();
    const project = { ...base, scene: { ...base.scene, objects: [object], layers: [line, fill] } };
    const painter = new ArtworkPulsePainter();
    const ctx = canvas2d();
    const painted = vi.spyOn(objectDisplay, 'paintObjectDisplay');
    const pieces = [pulse('both', 'fill')];
    painter.draw(ctx, project, view, pieces);
    expect(painted.mock.calls.at(-1)?.[2].paths[0]?.paint.kind).toBe('stroke');
    painted.mockClear();

    painter.draw(ctx, project, view, pieces);
    expect(painted).not.toHaveBeenCalled();
    painter.draw(
      ctx,
      { ...project, scene: { ...project.scene, layers: [{ ...line, visible: false }, fill] } },
      view,
      pieces,
    );

    expect(painted).toHaveBeenCalledOnce();
    expect(painted.mock.calls.at(-1)?.[2].paths[0]?.paint.kind).toBe('fill');
  });

  it('releases large inactive bitmap pairs while reusing live and small recent pieces', () => {
    const { project } = repeatedImports(10);
    const ctx = canvas2d();
    ctx.canvas.width = 3840;
    ctx.canvas.height = 2160;
    const created = vi.spyOn(document, 'createElement');
    const painter = new ArtworkPulsePainter();
    const large = {
      ...project,
      scene: {
        ...project.scene,
        objects: project.scene.objects.map((object) => ({
          ...object,
          bounds: { minX: 0, minY: 0, maxX: 3840, maxY: 2160 },
        })),
      },
    };
    const first = [pulse('piece-0', 'op-0')];
    painter.draw(ctx, large, view, first);
    const initialCanvases = created.mock.results.map((result) => result.value as HTMLCanvasElement);
    created.mockClear();
    painter.draw(ctx, large, view, first);
    expect(created).not.toHaveBeenCalled();
    for (let index = 1; index < 10; index += 1) {
      painter.draw(ctx, large, view, [pulse(`piece-${index}`, `op-${index}`)]);
    }
    expect(initialCanvases.every((canvas) => canvas.width === 0)).toBe(true);
    painter.draw(ctx, large, view, []);
    const largeCanvases = created.mock.results.map((result) => result.value as HTMLCanvasElement);
    expect(largeCanvases.every((canvas) => canvas.width === 0)).toBe(true);

    painter.draw(ctx, project, view, first);
    painter.draw(ctx, project, view, []);
    created.mockClear();
    painter.draw(ctx, project, view, first);
    expect(created).not.toHaveBeenCalled();
  });

  it('renders one piece per artwork, not one per artwork and group operation', () => {
    const count = 30;
    const { project, layers } = repeatedImports(count);
    const colorSources = new Map(layers.map((layer) => [layer.id, 'op-0']));
    const pieces: PulsePieceFrame[] = project.scene.objects.map((object) => ({
      objectId: object.id,
      colorSources,
      strength: 1,
      glowAlpha: 0,
      edgeAlpha: 0,
    }));
    const ctx = canvas2d();
    const created = vi.spyOn(document, 'createElement');

    new ArtworkPulsePainter({ renderBudgetMs: Infinity }).draw(ctx, project, view, pieces);

    const canvases = created.mock.calls.filter(([tag]) => tag === 'canvas').length;
    // Colour, outline and two halos per piece: 4N, where pairing every piece
    // with every same-settings operation would make 4N².
    expect(canvases).toBe(4 * count);
  });

  it('blits each piece at an alpha on every frame, with no blur on the overlay', () => {
    const { project } = repeatedImports(3);
    const { ctx, drawImages, shadowBlurs } = recordingContext();
    // Every piece renders on the first frame, however slow the machine.
    const painter = new ArtworkPulsePainter({ renderBudgetMs: Infinity });
    const pieces = project.scene.objects.map((object, index) => glowing(object.id, `op-${index}`));
    for (let frame = 0; frame < 6; frame += 1) painter.draw(ctx, project, view, pieces);
    // Bloom, edge and colour: three plain blits per piece per frame.
    expect(drawImages()).toBe(3 * 3 * 6);
    expect(shadowBlurs()).toEqual([]);
  });

  it('draws its bitmaps scaled while the view moves, and re-renders once it settles', () => {
    const { project } = repeatedImports(2);
    const { ctx, drawArgs } = recordingContext();
    const created = vi.spyOn(document, 'createElement');
    // Both bitmaps exist after the first draw, however slow the machine.
    const painter = new ArtworkPulsePainter({ renderBudgetMs: Infinity });
    const pieces = [pulse('piece-0', 'op-0'), pulse('piece-1', 'op-1')];
    painter.draw(ctx, project, view, pieces, 'design', 0);
    created.mockClear();
    const zoomed = { scale: 1.5, offsetX: -20, offsetY: 4 };
    // Zooming: the cached bitmaps stretch into place and nothing re-renders.
    expect(painter.draw(ctx, project, zoomed, pieces, 'design', 16)).toBe(true);
    expect(painter.draw(ctx, project, zoomed, pieces, 'design', 100)).toBe(true);
    expect(created).not.toHaveBeenCalled();
    expect(drawArgs().slice(-2)).toEqual([5, 5]);
    // Once the view has been still long enough, both re-render sharp.
    expect(painter.draw(ctx, project, zoomed, pieces, 'design', 400)).toBe(false);
    expect(created.mock.calls.filter(([tag]) => tag === 'canvas')).toHaveLength(8);
    expect(drawArgs().slice(-2)).toEqual([3, 3]);
  });

  it('renders new pieces within the frame budget, the most visible first', () => {
    const { project } = repeatedImports(4);
    const { ctx } = recordingContext();
    const painted = vi.spyOn(objectDisplay, 'paintObjectDisplay');
    const painter = new ArtworkPulsePainter({ renderBudgetMs: 0 });
    const pieces = project.scene.objects.map((object, index) => ({
      ...pulse(object.id, `op-${index}`),
      strength: index === 2 ? 0.7 : 0.1,
    }));
    expect(painter.draw(ctx, project, view, pieces)).toBe(true);
    expect(painted.mock.calls.map(([, object]) => object.id)).toEqual(['piece-2']);
    expect(painter.draw(ctx, project, view, pieces)).toBe(true);
    expect(painter.draw(ctx, project, view, pieces)).toBe(true);
    expect(painter.draw(ctx, project, view, pieces)).toBe(false);
    expect(painted).toHaveBeenCalledTimes(4);
  });

  it.each(['object', 'path'] as const)(
    'pulses the second operation with %s bindings',
    (binding) => {
      const line = createLayer({ id: 'line', color: '#2563eb' });
      const fill = createLayer({ id: 'fill', color: '#dc2626', mode: 'fill' });
      const piece = square('both', 'line', 10);
      const object: ImportedSvg = {
        ...piece,
        ...(binding === 'object'
          ? { operationIds: ['line', 'fill'] }
          : { paths: piece.paths.map((path) => ({ ...path, operationIds: ['line', 'fill'] })) }),
      };
      const base = createProject();
      const project = {
        ...base,
        scene: { ...base.scene, objects: [object], layers: [line, fill] },
      };
      const { ctx, drawImages } = recordingContext();

      new ArtworkPulsePainter().draw(ctx, project, view, [
        {
          objectId: 'both',
          // The second operation: the canvas styles the path with the first.
          colorSources: new Map([['fill', 'fill']]),
          strength: 1,
          glowAlpha: 0,
          edgeAlpha: 0,
        },
      ]);

      expect(drawImages()).toBe(1);
    },
  );
});

function pulse(objectId: string, operationId: string): PulsePieceFrame {
  return {
    objectId,
    colorSources: new Map([[operationId, operationId]]),
    strength: 1,
    glowAlpha: 0,
    edgeAlpha: 0,
  };
}

function glowing(objectId: string, operationId: string): PulsePieceFrame {
  return { ...pulse(objectId, operationId), glowAlpha: 0.3, edgeAlpha: 0.5 };
}

// Counts the blits the painter makes onto the overlay itself, their argument
// counts (5 means scaled) and every shadow blur set on the overlay.
function recordingContext(): {
  ctx: CanvasRenderingContext2D;
  drawImages: () => number;
  drawArgs: () => ReadonlyArray<number>;
  shadowBlurs: () => ReadonlyArray<unknown>;
} {
  const args: number[] = [];
  const blurs: unknown[] = [];
  const state: Record<string, unknown> = { canvas: { width: 800, height: 200 } };
  const ctx = new Proxy(state, {
    get(target, property) {
      if (property === 'drawImage') return (...call: unknown[]) => args.push(call.length);
      if (property in target) return target[String(property)];
      return () => undefined;
    },
    set(target, property, value) {
      if (property === 'shadowBlur') blurs.push(value);
      target[String(property)] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return {
    ctx,
    drawImages: () => args.length,
    drawArgs: () => args,
    shadowBlurs: () => blurs,
  };
}
