import { describe, expect, it } from 'vitest';
import type { Move3dKind } from '../../core/toolpath3d';
import { viewer3dTheme } from '../theme/viewer3d-theme';
import { toolpathLineStyle } from './viewer3d-toolpath-colors';

const ALL_KINDS: readonly Move3dKind[] = ['cut', 'rapid', 'feed-travel', 'plunge', 'retract'];

describe('toolpathLineStyle', () => {
  it('returns a usable style for every move kind', () => {
    for (const kind of ALL_KINDS) {
      const style = toolpathLineStyle(kind);
      expect(Number.isInteger(style.color)).toBe(true);
      expect(style.widthMm).toBeGreaterThan(0);
      expect(style.opacity).toBeGreaterThan(0);
      expect(style.opacity).toBeLessThanOrEqual(1);
    }
  });

  it('dashes moves that remove no material and keeps cutting moves solid', () => {
    // This is the whole point of the table: a glance must separate "the bit is
    // in the work" from "the bit is in the air".
    expect(toolpathLineStyle('cut').dashed).toBe(false);
    expect(toolpathLineStyle('plunge').dashed).toBe(false);
    expect(toolpathLineStyle('rapid').dashed).toBe(true);
    expect(toolpathLineStyle('feed-travel').dashed).toBe(true);
    expect(toolpathLineStyle('retract').dashed).toBe(true);
  });

  it('draws traversals recessive to the cuts they connect', () => {
    const cut = toolpathLineStyle('cut');
    for (const kind of ['rapid', 'feed-travel', 'retract'] as const) {
      const travel = toolpathLineStyle(kind);
      expect(travel.opacity).toBeLessThan(cut.opacity);
      expect(travel.widthMm).toBeLessThan(cut.widthMm);
    }
  });

  it('keeps cutting moves at full opacity', () => {
    expect(toolpathLineStyle('cut').opacity).toBe(1);
    expect(toolpathLineStyle('plunge').opacity).toBe(1);
  });

  it('gives every kind a distinct colour', () => {
    // Two kinds sharing a colour would silently merge in the viewport, which
    // reads as a single continuous move that does not exist.
    const colors = ALL_KINDS.map((kind) => toolpathLineStyle(kind).color);
    expect(new Set(colors).size).toBe(ALL_KINDS.length);
  });

  it('keeps the 3D depth ramp identical to the 2D canvas ramp', () => {
    // draw-cnc-removal.ts ramps the 2D depth map between these exact RGB
    // endpoints. If the two drift, the same cut reads as two different depths
    // depending on which preview the operator happens to be looking at — and
    // nothing else in the suite would notice.
    expect(viewer3dTheme.toolpath.depthShallow).toBe((196 << 16) | (160 << 8) | 116);
    expect(viewer3dTheme.toolpath.depthDeep).toBe((74 << 16) | (48 << 8) | 28);
  });

  it('distinguishes rapid from feed travel', () => {
    // Both are traversals, but they run at different speeds; collapsing them
    // would hide why a job is slower than expected.
    expect(toolpathLineStyle('rapid').color).not.toBe(toolpathLineStyle('feed-travel').color);
  });
});
