import { describe, expect, it } from 'vitest';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type Layer,
  type SceneObject,
  type TracedImage,
} from '../../core/scene';
import {
  ArtworkPulseClock,
  PULSE_DURATION_MS,
  PULSE_EDGE_ALPHA,
  pulseGlow,
  pulseStartOffsets,
  pulseStrength,
  pulseTargetFor,
  type PulseTarget,
} from './artwork-pulse';

function layer(id: string, color: string, overrides: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id, color }), ...overrides };
}

function artwork(id: string, operationIds: ReadonlyArray<string>, x: number): TracedImage {
  return {
    kind: 'traced-image',
    id,
    source: `${id}.png`,
    traceMode: 'filled-contours',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x },
    operationIds: [...operationIds],
    paths: [{ color: '#000000', polylines: [] }],
  };
}

describe('pulse shape', () => {
  it('rises quickly, holds full colour, then fades back to ink', () => {
    expect(pulseStrength(0)).toBe(0);
    expect(pulseStrength(0.08)).toBeGreaterThan(0.5);
    expect(pulseStrength(0.2)).toBe(1);
    expect(pulseStrength(0.6)).toBeGreaterThan(pulseStrength(0.8));
    expect(pulseStrength(1)).toBe(0);
    expect(pulseStrength(-0.1)).toBe(0);
  });

  it('blooms the glow outward while it fades', () => {
    const early = pulseGlow(0.1);
    const late = pulseGlow(0.8);
    expect(late?.blurPx).toBeGreaterThan(early?.blurPx ?? Infinity);
    expect(late?.alpha).toBeLessThan(early?.alpha ?? 0);
    expect(pulseGlow(0)).toBeNull();
    expect(pulseGlow(1)).toBeNull();
  });
});

describe('what pulses for a hover', () => {
  const engrave = layer('engrave', '#2563eb', { power: 40, speed: 3000 });
  const sameEngrave = layer('engrave-2', '#16a34a', { power: 40, speed: 3000, name: 'Other' });
  const cut = layer('cut', '#dc2626', { power: 100, speed: 480 });
  const layers = [engrave, sameEngrave, cut];
  const centre = (object: SceneObject) => ({ x: object.transform.x, y: 0 });

  it('pulses only the hovered piece, even beside artwork with the same settings', () => {
    const objects = [
      artwork('heart', ['engrave'], 0),
      artwork('name', ['engrave-2'], 100),
      artwork('box', ['cut'], 200),
    ];
    const target = pulseTargetFor(objects, layers, { kind: 'object', objectId: 'heart' }, centre);
    expect(target?.objectIds).toEqual(['heart']);
    expect([...(target?.operationIds ?? [])]).toEqual(['engrave']);
    expect(target?.offsets.get('heart')).toBe(0);
  });

  it('leaves other artwork in the same operation in ink', () => {
    const objects = [artwork('heart', ['engrave'], 0), artwork('star', ['engrave'], 100)];
    const target = pulseTargetFor(objects, layers, { kind: 'object', objectId: 'star' }, centre);
    expect(target?.objectIds).toEqual(['star']);
  });

  it('pulses each operation of a piece with two operations, each in its own colour', () => {
    const objects = [artwork('badge', ['cut', 'engrave-2'], 0)];
    const target = pulseTargetFor(objects, layers, { kind: 'object', objectId: 'badge' }, centre);
    expect(target?.objectIds).toEqual(['badge']);
    expect([...(target?.operationIds ?? [])].sort()).toEqual(['cut', 'engrave-2']);
  });

  it('pulses nothing for a piece that is gone', () => {
    const gone = { kind: 'object', objectId: 'deleted' } as const;
    expect(pulseTargetFor([artwork('box', ['cut'], 0)], layers, gone, centre)).toBeNull();
  });

  it("pulses an operation row's own artwork only, and nothing for a missing operation", () => {
    const objects = [
      artwork('box', ['cut'], 50),
      artwork('lid', ['cut'], 0),
      artwork('heart', ['engrave'], 100),
    ];
    const seed = { kind: 'operation', operationId: 'cut' } as const;
    const target = pulseTargetFor(objects, layers, seed, centre);
    expect(target?.objectIds).toEqual(['box', 'lid']);
    expect([...(target?.operationIds ?? [])]).toEqual(['cut']);
    // The row sweeps left to right.
    expect(target?.offsets.get('lid')).toBe(0);
    expect(target?.offsets.get('box')).toBeGreaterThan(0);
    const gone = { kind: 'operation', operationId: 'deleted' } as const;
    expect(pulseTargetFor(objects, layers, gone, centre)).toBeNull();
  });

  it('sweeps left to right and keeps the whole sweep short', () => {
    const pieces = Array.from({ length: 40 }, (_, index) => ({ id: `p${index}`, x: -index, y: 0 }));
    const offsets = pulseStartOffsets(pieces);
    expect(offsets.get('p39')).toBe(0);
    expect(offsets.get('p0')).toBeLessThanOrEqual(420);
    expect(offsets.get('p0')).toBeGreaterThan(offsets.get('p1') ?? Infinity);
  });
});

describe('pulse clock', () => {
  const target: PulseTarget = {
    operationIds: new Set(['engrave']),
    objectIds: ['heart'],
    offsets: new Map([['heart', 0]]),
  };

  it('plays one pulse per hover and keeps a soft edge while the pointer stays', () => {
    const clock = new ArtworkPulseClock();
    clock.hover(target, 0);
    expect(clock.frame(0, false).busy).toBe(true);
    expect(clock.frame(0.2 * PULSE_DURATION_MS, false).pieces[0]?.strength).toBe(1);
    // Hovering again mid-pulse does not restart it.
    clock.hover(target, 0.5 * PULSE_DURATION_MS);
    const done = clock.frame(PULSE_DURATION_MS + 1000, false);
    expect(done.pieces[0]).toMatchObject({ strength: 0, glow: null, edgeAlpha: PULSE_EDGE_ALPHA });
    expect(done.busy).toBe(false);
  });

  it('fades the edge after the pointer leaves, then forgets the piece', () => {
    const clock = new ArtworkPulseClock();
    clock.hover(target, 0);
    clock.frame(0, false);
    clock.frame(PULSE_DURATION_MS + 1000, false);
    clock.leave();
    clock.frame(PULSE_DURATION_MS + 1016, false);
    const fading = clock.frame(PULSE_DURATION_MS + 1032, false);
    expect(fading.pieces[0]?.edgeAlpha).toBeLessThan(PULSE_EDGE_ALPHA);
    expect(fading.busy).toBe(true);
    const gone = clock.frame(PULSE_DURATION_MS + 3000, false);
    expect(gone.pieces).toEqual([]);
    expect(gone.busy).toBe(false);
  });

  it('returns the edge without a second pulse when a click or drag pauses the hover', () => {
    const clock = new ArtworkPulseClock();
    clock.hover(target, 0);
    clock.frame(0, false);
    clock.frame(PULSE_DURATION_MS + 1000, false);
    clock.leave();
    clock.frame(PULSE_DURATION_MS + 1016, false);
    clock.hover(target, PULSE_DURATION_MS + 1100, { pulse: false });
    const resumed = clock.frame(PULSE_DURATION_MS + 1200, false);
    expect(resumed.pieces[0]).toMatchObject({ strength: 0, glow: null });
    expect(resumed.pieces[0]?.edgeAlpha).toBeGreaterThan(0);
  });

  it('shows the colour without motion when reduced motion is preferred', () => {
    const clock = new ArtworkPulseClock();
    clock.hover(target, 0);
    const shown = clock.frame(10, true);
    expect(shown.pieces[0]).toMatchObject({ strength: 1, glow: null, edgeAlpha: PULSE_EDGE_ALPHA });
    expect(shown.busy).toBe(false);
    clock.leave();
    expect(clock.frame(20, true).pieces).toEqual([]);
  });
});
