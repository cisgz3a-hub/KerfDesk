import { describe, expect, it } from 'vitest';
import {
  isSectionActive,
  SECTION_DISABLED_FRACTION,
  sectionPlaneConstant,
} from './viewer3d-clipping';
import {
  DEFAULT_DISPLAY_MODE,
  DISPLAY_MODE_CHOICES,
  displayModeFlags,
  type Viewer3DDisplayMode,
} from './viewer3d-display-mode';
import {
  DEFAULT_SCREENSHOT_SCALE,
  MAX_SCREENSHOT_SCALE,
  screenshotFileName,
  screenshotSize,
} from './viewer3d-screenshot';

describe('displayModeFlags', () => {
  it('never hides both the surface and the toolpath', () => {
    // A mode showing nothing is a blank viewport the operator cannot escape
    // except by guessing which button restores it.
    for (const { mode } of DISPLAY_MODE_CHOICES) {
      const flags = displayModeFlags(mode);
      expect(flags.isSurfaceVisible || flags.isToolpathVisible).toBe(true);
    }
  });

  it('shows the carve and the route it took by default', () => {
    const flags = displayModeFlags(DEFAULT_DISPLAY_MODE);
    expect(flags).toEqual({ isSurfaceVisible: true, isToolpathVisible: true, surfaceOpacity: 1 });
  });

  it('makes the surface translucent only in x-ray', () => {
    for (const { mode } of DISPLAY_MODE_CHOICES) {
      const { surfaceOpacity } = displayModeFlags(mode);
      if (mode.kind === 'xray') expect(surfaceOpacity).toBeLessThan(1);
      else expect(surfaceOpacity).toBe(1);
    }
  });

  it('shows the route with no surface in path-only mode', () => {
    const mode: Viewer3DDisplayMode = { kind: 'toolpath' };
    expect(displayModeFlags(mode).isSurfaceVisible).toBe(false);
    expect(displayModeFlags(mode).isToolpathVisible).toBe(true);
  });

  it('offers every mode arm in the toolbar', () => {
    // A union arm with no button is unreachable; this fails the moment someone
    // adds a mode and forgets the toolbar entry.
    const kinds = new Set(DISPLAY_MODE_CHOICES.map((choice) => choice.mode.kind));
    expect(kinds).toEqual(new Set(['shaded', 'shaded-toolpath', 'toolpath', 'xray']));
  });
});

describe('sectionPlaneConstant', () => {
  it('shows the whole part at the far end and nothing at the near end', () => {
    // The geometry is recentred, so it spans -50..50 for a 100mm part.
    expect(sectionPlaneConstant(1, 100)).toBe(50);
    expect(sectionPlaneConstant(0, 100)).toBe(-50);
  });

  it('sweeps linearly across the part', () => {
    expect(sectionPlaneConstant(0.5, 100)).toBe(0);
    expect(sectionPlaneConstant(0.25, 100)).toBe(-25);
  });

  it('clamps a fraction outside 0..1 instead of flying off the part', () => {
    expect(sectionPlaneConstant(-3, 100)).toBe(-50);
    expect(sectionPlaneConstant(9, 100)).toBe(50);
  });

  it('treats a fully-open slider as sectioning switched off', () => {
    expect(isSectionActive(SECTION_DISABLED_FRACTION)).toBe(false);
    expect(isSectionActive(0.99)).toBe(true);
  });
});

describe('screenshotFileName', () => {
  it('strips characters a filesystem will not take', () => {
    const name = screenshotFileName('Sign / Panel #2', '2026-07-25T13:45:07.123Z');
    expect(name).toBe('sign-panel-2-2026-07-25T13-45-07Z.png');
    expect(name).not.toMatch(/[:/#]/);
  });

  it('falls back when the job has no usable name', () => {
    expect(screenshotFileName('', '2026-07-25T00:00:00.000Z')).toMatch(/^cnc-3d-/);
    expect(screenshotFileName('///', '2026-07-25T00:00:00.000Z')).toMatch(/^cnc-3d-/);
  });
});

describe('screenshotSize', () => {
  it('multiplies by the requested scale', () => {
    expect(screenshotSize(300, 200, DEFAULT_SCREENSHOT_SCALE)).toEqual({ width: 600, height: 400 });
  });

  it('clamps past the maximum a GPU will allocate', () => {
    expect(screenshotSize(100, 100, 99)).toEqual({
      width: 100 * MAX_SCREENSHOT_SCALE,
      height: 100 * MAX_SCREENSHOT_SCALE,
    });
  });

  it('never returns a zero or fractional dimension', () => {
    // A zero-sized framebuffer throws in WebGL, so a collapsed pane must still
    // produce something rather than crash the capture.
    expect(screenshotSize(0, 0, 2)).toEqual({ width: 1, height: 1 });
    expect(screenshotSize(100.5, 50.2, 1)).toEqual({ width: 101, height: 51 });
  });
});
