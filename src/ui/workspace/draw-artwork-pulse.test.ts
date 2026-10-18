import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
  type Project,
} from '../../core/scene';
import type { PulsePieceFrame } from './artwork-pulse';
import { ArtworkPulsePainter } from './draw-artwork-pulse';

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
  it('renders one piece per artwork, not one per artwork and group operation', () => {
    const count = 30;
    const { project, layers } = repeatedImports(count);
    const colorSources = new Map(layers.map((layer) => [layer.id, 'op-0']));
    const pieces: PulsePieceFrame[] = project.scene.objects.map((object) => ({
      objectId: object.id,
      colorSources,
      strength: 1,
      glow: null,
      edgeAlpha: 0,
    }));
    const ctx = canvas2d();
    const created = vi.spyOn(document, 'createElement');

    new ArtworkPulsePainter().draw(ctx, project, view, pieces);

    const canvases = created.mock.calls.filter(([tag]) => tag === 'canvas').length;
    // A colour bitmap and a glow bitmap per piece: 2N, where pairing every
    // piece with every same-settings operation would make 2N².
    expect(canvases).toBe(2 * count);
  });

  it('pulses a path for an operation that is bound to it but does not style it', () => {
    const line = createLayer({ id: 'line', color: '#2563eb' });
    const fill = createLayer({ id: 'fill', color: '#dc2626', mode: 'fill' });
    const piece = square('both', 'line', 10);
    const object: ImportedSvg = {
      ...piece,
      paths: piece.paths.map((path) => ({ ...path, operationIds: ['line', 'fill'] })),
    };
    const base = createProject();
    const project = { ...base, scene: { ...base.scene, objects: [object], layers: [line, fill] } };
    const { ctx, drawImages } = recordingContext();

    new ArtworkPulsePainter().draw(ctx, project, view, [
      {
        objectId: 'both',
        // The second operation: the canvas styles the path with the first.
        colorSources: new Map([['fill', 'fill']]),
        strength: 1,
        glow: null,
        edgeAlpha: 0,
      },
    ]);

    expect(drawImages()).toBe(1);
  });
});

// Counts the blits the painter makes onto the overlay itself.
function recordingContext(): {
  ctx: CanvasRenderingContext2D;
  drawImages: () => number;
} {
  let count = 0;
  const state: Record<string, unknown> = { canvas: { width: 800, height: 200 } };
  const ctx = new Proxy(state, {
    get(target, property) {
      if (property === 'drawImage') return () => (count += 1);
      if (property in target) return target[String(property)];
      return () => undefined;
    },
    set(target, property, value) {
      target[String(property)] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, drawImages: () => count };
}
