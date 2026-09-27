import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCut3DGlide, type Cut3DGlideKind } from './cut3d-offscreen-glide';

type Sent = { readonly kind: Cut3DGlideKind; readonly deltaX: number; readonly deltaY: number };

// A hand-cranked clock and frame queue, so each glide frame is stepped by the test.
function harness() {
  let clock = 0;
  const queued = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  const sent: Sent[] = [];
  const glide = createCut3DGlide((kind, deltaX, deltaY) => sent.push({ kind, deltaX, deltaY }), {
    requestAnimationFrame: (callback) => {
      nextId += 1;
      queued.set(nextId, callback);
      return nextId;
    },
    cancelAnimationFrame: (id) => {
      queued.delete(id);
    },
  });
  const advance = (ms: number): void => {
    clock += ms;
  };
  const frame = (ms = 1000 / 60): boolean => {
    const [first] = queued.entries();
    if (first === undefined) return false;
    queued.delete(first[0]);
    advance(ms);
    first[1](clock);
    return true;
  };
  // Drags right at `pxPerFrame` for `frames` frames of 16 ms each.
  const drag = (pxPerFrame: number, frames: number): void => {
    glide.begin();
    for (let index = 0; index < frames; index += 1) {
      advance(16);
      glide.track('rotate', pxPerFrame, 0);
      frame(0);
    }
  };
  return { glide, sent, frame, advance, drag, pending: () => queued.size };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createCut3DGlide', () => {
  it('glides over only the remaining pointer distance and settles within a second', () => {
    const { sent, frame, drag } = harness();
    drag(10, 5);
    const dragCount = sent.length;
    let frames = 0;
    while (frame() && frames < 500) frames += 1;
    expect(sent.length).toBeGreaterThan(5);
    expect(sent.every((step) => step.kind === 'rotate' && step.deltaY === 0)).toBe(true);
    // Each visible settling step is smaller; the final subpixel remainder
    // is consumed exactly so the camera ends at the requested drag distance.
    for (let index = dragCount; index < sent.length - 1; index += 1) {
      expect(Math.abs(sent[index]?.deltaX ?? 0)).toBeLessThan(
        Math.abs(sent[index - 1]?.deltaX ?? 0),
      );
    }
    expect(frames).toBeLessThan(60);
    const travelled = sent.reduce((sum, step) => sum + step.deltaX, 0);
    expect(travelled).toBeCloseTo(50, 10);
    expect(Math.abs(sent.at(-1)?.deltaX ?? Infinity)).toBeLessThanOrEqual(0.05);
  });

  it('settles while a drag is held still without adding release travel', () => {
    const { sent, frame, drag, advance } = harness();
    drag(10, 5);
    let frames = 0;
    while (frame() && frames < 60) frames += 1;
    const count = sent.length;
    advance(200);
    expect(frame()).toBe(false);
    expect(sent).toHaveLength(count);
    expect(sent.reduce((sum, step) => sum + step.deltaX, 0)).toBeCloseTo(50, 10);
  });

  it('stops when a new drag or any other input starts', () => {
    const { glide, sent, frame, drag, pending } = harness();
    drag(10, 5);
    frame();
    const count = sent.length;
    glide.stop();
    expect(pending()).toBe(0);
    expect(frame()).toBe(false);
    expect(sent).toHaveLength(count);

    drag(10, 5);
    glide.begin();
    expect(pending()).toBe(0);
  });

  it('does not glide when the operator asks for reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    const { sent, frame, drag, pending } = harness();
    drag(10, 5);
    expect(frame()).toBe(false);
    expect(pending()).toBe(0);
    expect(sent).toEqual(
      Array.from({ length: 5 }, () => ({ kind: 'rotate', deltaX: 10, deltaY: 0 })),
    );
  });
});
