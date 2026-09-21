import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canvasTheme } from './canvas-theme';

// ADR-047: the chrome palette lives in tokens.css (custom properties) and
// the Canvas2D palette lives in canvas-theme.ts — a deliberate partition.
// Exactly two values are shared across that boundary: the canvas selection
// blue and the out-of-bounds red, which doubles as the chrome danger color.
// Pin them so the two files cannot drift.
//
// ADR-339 split selection off --lf-accent: the chrome accent is copper, and
// the bed's own language is already warm (scorch, tab handles, safety red),
// so a copper selection box would read as machine state. --lf-canvas-selection
// exists to keep that shared value pinned rather than merely uncoupled.

function tokenValue(css: string, name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
  if (match?.[1] === undefined) throw new Error(`token ${name} not found in tokens.css`);
  return match[1].trim();
}

describe('theme sync (tokens.css ↔ canvas-theme.ts)', () => {
  const css = readFileSync(join(process.cwd(), 'src/ui/theme/tokens.css'), 'utf8');

  it('the canvas selection token matches the canvas selection color', () => {
    expect(tokenValue(css, '--lf-canvas-selection')).toBe(canvasTheme.selection);
  });

  it('keeps the chrome accent off the bed, so selection cannot read as scorch', () => {
    expect(tokenValue(css, '--lf-accent')).not.toBe(canvasTheme.selection);
  });

  it('chrome danger matches the canvas out-of-bounds color', () => {
    expect(tokenValue(css, '--lf-danger')).toBe(canvasTheme.outOfBounds);
  });
});
