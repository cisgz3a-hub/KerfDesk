import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canvasTheme } from './canvas-theme';

// ADR-047: the chrome palette lives in tokens.css (custom properties) and
// the Canvas2D palette lives in canvas-theme.ts — a deliberate partition.
// Exactly two values are shared across that boundary: the selection blue
// (canvas) doubles as the chrome accent, and the out-of-bounds red doubles
// as the chrome danger color. Pin them so the two files cannot drift.

function tokenValue(css: string, name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
  if (match?.[1] === undefined) throw new Error(`token ${name} not found in tokens.css`);
  return match[1].trim();
}

describe('theme sync (tokens.css ↔ canvas-theme.ts)', () => {
  const css = readFileSync(join(process.cwd(), 'src/ui/theme/tokens.css'), 'utf8');

  it('chrome accent matches the canvas selection color', () => {
    expect(tokenValue(css, '--lf-accent')).toBe(canvasTheme.selection);
  });

  it('chrome danger matches the canvas out-of-bounds color', () => {
    expect(tokenValue(css, '--lf-danger')).toBe(canvasTheme.outOfBounds);
  });
});
