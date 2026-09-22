import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type AABB, type Transform } from '../../core/scene';
import {
  drawArtworkSprite,
  resetArtworkSpritesForTests,
  SPRITE_PAD_PX,
  SPRITE_SETTLE_MS,
  type SpriteRequest,
} from './artwork-sprite-cache';
import type { ViewTransform } from './view-transform';

function workspaceContext(width = 800, height = 600) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const calls = { drawImage: vi.fn(), save: vi.fn(), restore: vi.fn() };
  const ctx = { canvas, globalAlpha: 1, ...calls } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

type Harness = {
  readonly request: SpriteRequest;
  readonly paints: ViewTransform[];
  readonly requestRedraw: ReturnType<typeof vi.fn>;
};

function harness(
  ctx: CanvasRenderingContext2D,
  args: {
    readonly key?: object;
    readonly transform?: Transform;
    readonly view?: ViewTransform;
    readonly styleKey?: string;
    readonly bounds?: AABB;
  } = {},
): Harness {
  const paints: ViewTransform[] = [];
  const requestRedraw = vi.fn();
  return {
    paints,
    requestRedraw,
    request: {
      ctx,
      key: args.key ?? {},
      transform: args.transform ?? { ...IDENTITY_TRANSFORM, x: 5, y: 7 },
      view: args.view ?? { scale: 2, offsetX: 10.4, offsetY: 20.6 },
      styleKey: args.styleKey ?? 'design|1.5|s:#000000:1',
      measure: () => args.bounds ?? { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      paint: (_spriteCtx, view) => {
        paints.push(view);
      },
      requestRedraw,
    },
  };
}

function lastBlit(calls: { readonly drawImage: ReturnType<typeof vi.fn> }): unknown[] {
  const call = calls.drawImage.mock.lastCall;
  if (call === undefined) throw new Error('no blit recorded');
  return call;
}

beforeEach(() => resetArtworkSpritesForTests());
afterEach(() => {
  resetArtworkSpritesForTests();
  vi.useRealTimers();
});

describe('artwork sprite cache', () => {
  it('renders an object once and blits it at whole-pixel placement afterwards', () => {
    const { ctx, calls } = workspaceContext();
    const { request, paints } = harness(ctx);

    expect(drawArtworkSprite(request)).toBe(true);
    expect(paints).toHaveLength(1);
    // The sprite's own view maps the region origin (object space, before
    // translation) onto (PAD, PAD): offset = PAD - (translation + region.min) * scale.
    expect(paints[0]).toEqual({
      scale: 2,
      offsetX: SPRITE_PAD_PX - 10,
      offsetY: SPRITE_PAD_PX - 14,
    });
    const [sprite, x, y] = lastBlit(calls) as [HTMLCanvasElement, number, number];
    expect(sprite.width).toBe(Math.ceil(10 * 2) + 2 * SPRITE_PAD_PX);
    expect(sprite.height).toBe(Math.ceil(10 * 2) + 2 * SPRITE_PAD_PX);
    expect(x).toBe(Math.round(10.4 + 5 * 2) - SPRITE_PAD_PX);
    expect(y).toBe(Math.round(20.6 + 7 * 2) - SPRITE_PAD_PX);

    expect(drawArtworkSprite(request)).toBe(true);
    expect(paints).toHaveLength(1);
    expect(calls.drawImage).toHaveBeenCalledTimes(2);
  });

  it('reuses the bitmap across pans and object moves, but repaints for a rotation or style change', () => {
    const { ctx, calls } = workspaceContext();
    const key = {};
    const first = harness(ctx, { key });
    drawArtworkSprite(first.request);

    const panned = harness(ctx, { key, view: { scale: 2, offsetX: -300.2, offsetY: 44 } });
    expect(drawArtworkSprite(panned.request)).toBe(true);
    expect(panned.paints).toHaveLength(0);
    expect(lastBlit(calls)[1]).toBe(Math.round(-300.2 + 10) - SPRITE_PAD_PX);

    const moved = harness(ctx, { key, transform: { ...IDENTITY_TRANSFORM, x: 50, y: 7 } });
    expect(drawArtworkSprite(moved.request)).toBe(true);
    expect(moved.paints).toHaveLength(0);
    expect(lastBlit(calls)[1]).toBe(Math.round(10.4 + 100) - SPRITE_PAD_PX);

    const rotated = harness(ctx, {
      key,
      transform: { ...IDENTITY_TRANSFORM, x: 5, y: 7, rotationDeg: 30 },
    });
    expect(drawArtworkSprite(rotated.request)).toBe(true);
    expect(rotated.paints).toHaveLength(1);

    const restyled = harness(ctx, { key, styleKey: 'design|1|s:#ff0000:1' });
    expect(drawArtworkSprite(restyled.request)).toBe(true);
    expect(restyled.paints).toHaveLength(1);
  });

  it('paints a separate sprite for a different context alpha', () => {
    const { ctx } = workspaceContext();
    const key = {};
    const opaque = harness(ctx, { key });
    drawArtworkSprite(opaque.request);
    (ctx as { globalAlpha: number }).globalAlpha = 0.24;
    const dimmed = harness(ctx, { key });
    expect(drawArtworkSprite(dimmed.request)).toBe(true);
    expect(dimmed.paints).toHaveLength(1);
  });

  it('shows a scaled placeholder while zooming and repaints exactly after the settle window', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const { ctx, calls } = workspaceContext();
    const key = {};
    const settled = harness(ctx, { key });
    drawArtworkSprite(settled.request);

    const zoomed = harness(ctx, { key, view: { scale: 3, offsetX: 10.4, offsetY: 20.6 } });
    expect(drawArtworkSprite(zoomed.request)).toBe(true);
    expect(zoomed.paints).toHaveLength(0);
    const placeholder = lastBlit(calls);
    // Five-argument drawImage: the old 26 px bitmap stretched by 3/2.
    expect(placeholder).toHaveLength(5);
    expect(placeholder[3]).toBeCloseTo(26 * 1.5, 9);
    expect(placeholder[1]).toBeCloseTo(10.4 + 5 * 3 - SPRITE_PAD_PX * 1.5, 9);
    expect(zoomed.requestRedraw).not.toHaveBeenCalled();

    vi.advanceTimersByTime(SPRITE_SETTLE_MS - 1);
    expect(zoomed.requestRedraw).not.toHaveBeenCalled();
    // A repaint inside the window keeps holding the placeholder.
    const early = harness(ctx, { key, view: { scale: 3, offsetX: 10.4, offsetY: 20.6 } });
    expect(drawArtworkSprite(early.request)).toBe(true);
    expect(early.paints).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(early.requestRedraw).toHaveBeenCalledTimes(1);

    const exact = harness(ctx, { key, view: { scale: 3, offsetX: 10.4, offsetY: 20.6 } });
    expect(drawArtworkSprite(exact.request)).toBe(true);
    expect(exact.paints).toHaveLength(1);
    expect(exact.paints[0]?.scale).toBe(3);
    expect(lastBlit(calls)).toHaveLength(3);
    expect((lastBlit(calls)[0] as HTMLCanvasElement).width).toBe(Math.ceil(30) + 2 * SPRITE_PAD_PX);
  });

  it('repaints immediately for a zoom when no earlier bitmap can stand in', () => {
    const { ctx } = workspaceContext();
    const fresh = harness(ctx, { view: { scale: 5, offsetX: 0, offsetY: 0 } });
    expect(drawArtworkSprite(fresh.request)).toBe(true);
    expect(fresh.paints).toHaveLength(1);
  });

  it('clips an oversized object to the viewport plus a margin and re-renders when the view leaves it', () => {
    const { ctx } = workspaceContext(800, 600);
    const key = {};
    const bounds = { minX: 0, minY: 0, maxX: 100_000, maxY: 100_000 };
    const view = { scale: 1, offsetX: 0, offsetY: 0 };
    const first = harness(ctx, { key, bounds, view, transform: IDENTITY_TRANSFORM });
    expect(drawArtworkSprite(first.request)).toBe(true);
    expect(first.paints).toHaveLength(1);
    // Region = viewport (800 x 600) with a 25% margin, clipped to the geometry.
    expect(first.paints[0]).toEqual({ scale: 1, offsetX: SPRITE_PAD_PX, offsetY: SPRITE_PAD_PX });

    const inside = harness(ctx, {
      key,
      bounds,
      view: { scale: 1, offsetX: -150, offsetY: -100 },
      transform: IDENTITY_TRANSFORM,
    });
    expect(drawArtworkSprite(inside.request)).toBe(true);
    expect(inside.paints).toHaveLength(0);

    const outside = harness(ctx, {
      key,
      bounds,
      view: { scale: 1, offsetX: -400, offsetY: 0 },
      transform: IDENTITY_TRANSFORM,
    });
    expect(drawArtworkSprite(outside.request)).toBe(true);
    expect(outside.paints).toHaveLength(1);
    expect(outside.paints[0]?.offsetX).toBe(SPRITE_PAD_PX - 200);
  });

  it('declines contexts that are not backed by a canvas element', () => {
    const calls = { drawImage: vi.fn() };
    const ctx = { canvas: {}, globalAlpha: 1, ...calls } as unknown as CanvasRenderingContext2D;
    const { request, paints } = harness(ctx);
    expect(drawArtworkSprite(request)).toBe(false);
    expect(paints).toHaveLength(0);
    expect(calls.drawImage).not.toHaveBeenCalled();
  });
});
