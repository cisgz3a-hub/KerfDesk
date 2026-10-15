import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import { drawObjectsFaint } from './draw-preview';
import {
  beginArtworkSpriteFrame,
  drawArtworkSprite,
  resetArtworkSpritesForTests,
  SPRITE_SETTLE_MS,
  type SpriteRequest,
} from './artwork-sprite-cache';

function scene(count: number, large = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  const drawImage = vi.fn();
  const ctx = {
    canvas,
    globalAlpha: 1,
    drawImage,
    save: vi.fn(),
    restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  const requests: SpriteRequest[] = Array.from({ length: count }, () => ({
    ctx,
    key: {},
    transform: IDENTITY_TRANSFORM,
    view: { scale: 1, offsetX: 0, offsetY: 0 },
    styleKey: 'budget-test',
    // Including 3px padding: 32x32 or 1000x3000 pixels. Four large sprites
    // exactly fill the 12-million-pixel cache budget for this viewport.
    measure: () => ({ minX: 0, minY: 0, maxX: large ? 994 : 26, maxY: large ? 2994 : 26 }),
    paint: vi.fn(),
  }));
  function draw(selected = requests) {
    beginArtworkSpriteFrame();
    let direct = 0;
    for (const request of selected) {
      if (drawArtworkSprite(request)) continue;
      // The production object painter uses this exact fallback on declined
      // admission. Every object still paints; only retained sprites are reused.
      request.paint(ctx, request.view);
      direct += 1;
    }
    return direct;
  }
  return { requests, draw, drawImage };
}

beforeEach(resetArtworkSpritesForTests);
afterEach(() => {
  resetArtworkSpritesForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('artwork sprite cache admission', () => {
  it.each([8, 9, 16])('retains all %i small dense objects across stable draws', (count) => {
    const state = scene(count);
    for (let pass = 0; pass < 3; pass += 1) expect(state.draw()).toBe(0);
    for (const request of state.requests) expect(request.paint).toHaveBeenCalledTimes(1);
    expect(state.drawImage).toHaveBeenCalledTimes(count * 3);
  });

  it('keeps a stable pixel-budget subset instead of cycling through every object', () => {
    const state = scene(6, true);
    const create = vi.spyOn(document, 'createElement');
    for (let pass = 0; pass < 3; pass += 1) expect(state.draw()).toBe(2);
    for (const request of state.requests.slice(0, 4))
      expect(request.paint).toHaveBeenCalledTimes(1);
    for (const request of state.requests.slice(4)) expect(request.paint).toHaveBeenCalledTimes(3);
    expect(create).toHaveBeenCalledTimes(4);
    const retained = state.drawImage.mock.calls
      .slice(0, 4)
      .map(([canvas]) => canvas as HTMLCanvasElement);
    expect(retained.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0)).toBe(
      12_000_000,
    );
  });

  it('bounds canvas metadata even when a scan contains hundreds of tiny sprites', () => {
    const state = scene(257);
    const create = vi.spyOn(document, 'createElement');
    for (let pass = 0; pass < 3; pass += 1) expect(state.draw()).toBe(1);
    for (const request of state.requests.slice(0, 256))
      expect(request.paint).toHaveBeenCalledTimes(1);
    expect(state.requests[256]?.paint).toHaveBeenCalledTimes(3);
    expect(create).toHaveBeenCalledTimes(256);
  });

  it('reclaims absent sprites after one complete draw and zeroes evicted canvases', () => {
    const state = scene(5, true);
    expect(state.draw()).toBe(1);
    const evicted = state.drawImage.mock.calls[0]?.[0] as HTMLCanvasElement;
    const remaining = state.requests.slice(1);
    // The prior draw still protects object zero. Its absence is known next time.
    expect(state.draw(remaining)).toBe(1);
    expect(state.draw(remaining)).toBe(0);
    expect(evicted.width).toBe(0);
    expect(evicted.height).toBe(0);
    expect(state.draw(remaining)).toBe(0);
    expect(state.requests[4]?.paint).toHaveBeenCalledTimes(3);
  });

  it('does not allocate beyond the pixel budget when an existing sprite grows', () => {
    const state = scene(5, true);
    expect(state.draw()).toBe(1);
    const oldCanvas = state.drawImage.mock.calls[0]?.[0] as HTMLCanvasElement;
    const request = state.requests[0]!;
    beginArtworkSpriteFrame();
    // A 2000x2000 sprite is below the per-sprite cap but would exceed the total.
    expect(
      drawArtworkSprite({
        ...request,
        styleKey: 'changed',
        measure: () => ({ minX: 0, minY: 0, maxX: 1994, maxY: 1994 }),
      }),
    ).toBe(false);
    expect(oldCanvas.width).toBe(0);
    expect(oldCanvas.height).toBe(0);
  });

  it('reclaims an old scene after an empty full Preview artwork pass', () => {
    const previous = scene(4, true);
    expect(previous.draw()).toBe(0);
    const oldCanvases = previous.drawImage.mock.calls.map(
      ([canvas]) => canvas as HTMLCanvasElement,
    );
    const request = previous.requests[0]!;
    // This exported entrypoint is also usable without drawScene. Empty artwork
    // must advance residency, while an individual object paint must not.
    drawObjectsFaint(request.ctx, createProject(), request.view);
    const replacement = scene(4, true);
    expect(replacement.draw()).toBe(0);
    expect(replacement.draw()).toBe(0);
    for (const canvas of oldCanvases) expect([canvas.width, canvas.height]).toEqual([0, 0]);
    for (const item of replacement.requests) expect(item.paint).toHaveBeenCalledTimes(1);
  });

  it('keeps a useful zoom placeholder only until an unrenderable region must paint directly', () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const state = scene(1);
    const source = state.requests[0]!;
    source.ctx.canvas.width = 9000;
    source.ctx.canvas.height = 1000;
    const request = {
      ...source,
      view: { scale: 0.1, offsetX: 0, offsetY: 0 },
      measure: () => ({ minX: 0, minY: 0, maxX: 10_000, maxY: 10_000 }),
    };
    expect(drawArtworkSprite(request)).toBe(true);
    const oldCanvas = state.drawImage.mock.calls[0]?.[0] as HTMLCanvasElement;
    const zoomed = { ...request, view: { ...request.view, scale: 1 } };
    expect(drawArtworkSprite(zoomed)).toBe(true);
    expect(oldCanvas.width).toBeGreaterThan(0);
    vi.advanceTimersByTime(SPRITE_SETTLE_MS);
    // Both the complete object and the clipped 9000px-wide viewport exceed
    // the 8192px side limit. The old sprite cannot be retained as a live entry.
    expect(drawArtworkSprite(zoomed)).toBe(false);
    expect([oldCanvas.width, oldCanvas.height]).toEqual([0, 0]);
    expect(source.paint).toHaveBeenCalledTimes(1);
  });
});
