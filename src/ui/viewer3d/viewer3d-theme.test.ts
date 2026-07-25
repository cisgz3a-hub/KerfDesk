import { describe, expect, it } from 'vitest';
import { resolveViewer3dTheme } from './viewer3d-theme';

describe('resolveViewer3dTheme', () => {
  it('falls back to numeric defaults when no CSS variables are defined', () => {
    const theme = resolveViewer3dTheme(document.createElement('div'));
    expect(theme.background).toBeGreaterThanOrEqual(0);
    expect(theme.travel).not.toBe(theme.cut);
  });

  it('reads #rrggbb custom properties from the given root', () => {
    const root = document.createElement('div');
    root.style.setProperty('--lf-viewer3d-cut', '#0000ff');
    document.body.appendChild(root);
    try {
      const theme = resolveViewer3dTheme(root);
      expect(theme.cut).toBe(0x0000ff);
    } finally {
      root.remove();
    }
  });
});
