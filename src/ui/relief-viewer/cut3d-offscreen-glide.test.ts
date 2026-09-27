import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCut3DGlide, type Cut3DGlideKind } from './cut3d-offscreen-glide';

type Sent = { readonly kind: Cut3DGlideKind; readonly deltaX: number; readonly deltaY: number };

// A hand-cranked clock and frame queue, so each glide frame is stepped by the test.
function harness() {
  let clock = 0;
  const queued = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  const sent: Sent[] = [];
  const glide = createCut3DGlide(
    (kind, deltaX, deltaY) => sent.push({ kind, deltaX, deltaY }),
    () => clock,
    {
      requestAnimationFrame: (callback) => {
        nextId += 1;
        queued.set(nextId, callback);
        return nextId;
      },
      cancelAnimationFrame: (id) => {
        queued.delete(id);
      },
    },
  );
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
      glide.track(pxPerFrame, 0);
    }
  };
  return { glide, sent, frame, advance, drag, pending: () => queued.size };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createCut3DGlide', () => {
  it('glides on after a flick and fades out like the orbit controls damping', () => {
    const { glide, sent, frame, drag } = harness();
    drag(10, 5);
    glide.release('rotate');
    let frames = 0;
    while (frame() && frames < 500) frames += 1;
    expect(sent.length).toBeGreaterThan(5);
    expect(sent.every((step) => step.kind === 'rotate' && step.deltaY === 0)).toBe(true);
    // Each step is smaller than the last, and it settles well within a second.
    for (let index = 1; index < sent.length; index += 1) {
      expect(Math.abs(sent[index]?.deltaX ?? 0)).toBeLessThan(
        Math.abs(sent[index - 1]?.deltaX ?? 0),
      );
    }
    expect(frames).toBeLessThan(60);
    // The whole glide is what OrbitControls leaves after a steady drag:
    // speed x (1 - damping) / damping, about 7 frames of travel.
    const travelled = sent.reduce((sum, step) => sum + step.deltaX, 0);
    expect(travelled).toBeGreaterThan(10 * 6);
    expect(travelled).toBeLessThan(10 * 9);
  });

  it('does not glide when the drag was held still before letting go', () => {
    const { glide, sent, frame, drag, advance } = harness();
    drag(10, 5);
    advance(200);
    glide.release('pan');
    frame();
    expect(sent).toEqual([]);
  });

  it('stops when a new drag or any other input starts', () => {
    const { glide, sent, frame, drag, pending } = harness();
    drag(10, 5);
    glide.release('pan');
    frame();
    const count = sent.length;
    glide.stop();
    expect(pending()).toBe(0);
    expect(frame()).toBe(false);
    expect(sent).toHaveLength(count);

    drag(10, 5);
    glide.release('pan');
    glide.begin();
    expect(pending()).toBe(0);
  });

  it('does not glide when the operator asks for reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    const { glide, sent, frame, drag } = harness();
    drag(10, 5);
    glide.release('rotate');
    frame();
    expect(sent).toEqual([]);
  });
});
