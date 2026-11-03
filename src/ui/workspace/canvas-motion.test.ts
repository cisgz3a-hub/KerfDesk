import { describe, expect, it } from 'vitest';
import { CanvasMotion, MOTION_SETTLE_MS } from './canvas-motion';

describe('CanvasMotion (ADR-346 Amendment 1)', () => {
  it('counts a changed view as moving until it has been still for the settle time', () => {
    const motion = new CanvasMotion();
    expect(motion.frame('1|0|0', null, 0)).toBe(false);
    expect(motion.frame('1|5|0', null, 16)).toBe(true);
    expect(motion.frame('1|5|0', null, 16 + MOTION_SETTLE_MS - 1)).toBe(true);
    expect(motion.settlesIn(16 + MOTION_SETTLE_MS - 1)).toBe(1);
    // The settled frame: same view, quiet long enough.
    expect(motion.frame('1|5|0', null, 16 + MOTION_SETTLE_MS)).toBe(false);
    expect(motion.settlesIn(16 + MOTION_SETTLE_MS)).toBe(0);
  });

  it('moves while a drag changes what it drags, not on the press that starts it', () => {
    const motion = new CanvasMotion();
    const first = {};
    const moved = {};
    expect(motion.frame('v', null, 0)).toBe(false);
    // A click: the drag starts, nothing it drags has changed.
    expect(motion.frame('v', [first, null], 500)).toBe(false);
    expect(motion.frame('v', [first, null], 520)).toBe(false);
    expect(motion.frame('v', [moved, null], 540)).toBe(true);
    // Released: the commit frame moves, and the settle time starts there.
    expect(motion.frame('v', null, 560)).toBe(true);
    expect(motion.frame('v', null, 560 + MOTION_SETTLE_MS - 1)).toBe(true);
    expect(motion.frame('v', null, 560 + MOTION_SETTLE_MS)).toBe(false);
  });

  it('keeps a moved drag moving while it is held, however slow its frames', () => {
    const motion = new CanvasMotion();
    const project = {};
    motion.frame('v', null, 0);
    motion.frame('v', [project, null], 100);
    expect(motion.frame('v', [{}, null], 120)).toBe(true);
    // A frame held up by a busy GPU arrives long after the settle time.
    expect(motion.frame('v', [{}, null], 120 + 4 * MOTION_SETTLE_MS)).toBe(true);
    expect(motion.settlesIn(120 + 4 * MOTION_SETTLE_MS)).toBeNull();
    // Still held, not moving: no settled frame yet.
    expect(motion.moving(2000)).toBe(true);
    // Released: the settle time starts at the release.
    expect(motion.frame('v', null, 2000)).toBe(true);
    expect(motion.settlesIn(2000)).toBe(MOTION_SETTLE_MS);
    expect(motion.frame('v', null, 2000 + MOTION_SETTLE_MS)).toBe(false);
  });

  it('treats a marquee change as a drag step', () => {
    const motion = new CanvasMotion();
    const project = {};
    motion.frame('v', [project, { x: 1 }], 0);
    expect(motion.frame('v', [project, { x: 2 }], 16)).toBe(true);
  });
});
