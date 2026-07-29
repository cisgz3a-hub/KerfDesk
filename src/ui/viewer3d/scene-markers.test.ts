// Pins the separation rule the two head markers depend on.
//
// scene-markers.ts states it plainly: confusing a simulated playback position
// for where the machine actually is would be dangerous. That used to be
// guaranteed by the live marker being cyan, nowhere near anything else in the
// scene. It is now bright red (maintainer request, 2026-07-29), which sits in
// the same family as the recessive traversal red — so the property is worth
// asserting rather than assuming.

import { describe, expect, it } from 'vitest';
import { LIVE_MARKER_COLOR, MARKER_COLOR } from './scene-markers';
import { resolveViewer3dTheme } from './viewer3d-theme';

// Resolves to the numeric fallbacks outside a browser, which is what the
// scene actually renders today — no --lf-viewer3d-* variables are defined.
const theme = resolveViewer3dTheme(null);

const channels = (color: number): readonly [number, number, number] => [
  (color >> 16) & 0xff,
  (color >> 8) & 0xff,
  color & 0xff,
];

describe('head marker colours stay separable', () => {
  it('gives the live marker a colour no other scene element uses', () => {
    const others = [...Object.values(theme), MARKER_COLOR];
    expect(others).not.toContain(LIVE_MARKER_COLOR);
  });

  it('keeps the live marker distinct from the playback marker', () => {
    expect(LIVE_MARKER_COLOR).not.toBe(MARKER_COLOR);
  });

  // Travel is the nearest neighbour now that the live marker is red, so
  // equality alone is too weak a guarantee. What separates them is that the
  // live marker is saturated and bright where travel is deliberately
  // recessive: full red channel, and a wider spread between channels.
  it('reads brighter and more saturated than the recessive travel red', () => {
    const [liveR, liveG, liveB] = channels(LIVE_MARKER_COLOR);
    const [travelR, travelG, travelB] = channels(theme.travel);
    expect(liveR).toBe(0xff);
    expect(liveR).toBeGreaterThan(travelR);
    expect(liveG).toBeLessThan(travelG);
    expect(liveB).toBeLessThan(travelB);
    // Chroma: how far the red channel runs ahead of the other two.
    expect(liveR - Math.max(liveG, liveB)).toBeGreaterThan(travelR - Math.max(travelG, travelB));
  });

  it('stays legible against the viewer background', () => {
    const [bgR, bgG, bgB] = channels(theme.background);
    const [liveR, liveG, liveB] = channels(LIVE_MARKER_COLOR);
    // Rec. 601 luma — the marker must be far brighter than the dark body it
    // is drawn over, or it disappears exactly as the cyan one was reported to.
    const luma = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;
    expect(luma(liveR, liveG, liveB) - luma(bgR, bgG, bgB)).toBeGreaterThan(50);
  });
});
