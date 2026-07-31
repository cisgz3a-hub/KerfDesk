import { describe, expect, it } from 'vitest';
import {
  DESIGN_TOOLS,
  DESIGN_TOOL_BY_KIND,
  designToolForShortcut,
  designToolsForRail,
} from './design-tool';

describe('DESIGN_TOOLS', () => {
  it('gives every tool a unique single-key shortcut', () => {
    const shortcuts = DESIGN_TOOLS.map((tool) => tool.shortcut);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
    for (const shortcut of shortcuts) expect(shortcut).toMatch(/^[a-z]$/);
  });

  it('does not collide with the Shift view toggles (f, s, o, g)', () => {
    // The view toggles are Shift+letter precisely so the plain letters stay
    // with Fillet, Offset and Polygon. This test pins that intent.
    const plain = new Set(DESIGN_TOOLS.map((tool) => tool.shortcut));
    expect(plain.has('f')).toBe(true);
    expect(plain.has('o')).toBe(true);
    expect(plain.has('g')).toBe(true);
  });

  it('gives every tool a hint, since the status bar is the discoverability surface', () => {
    for (const tool of DESIGN_TOOLS) {
      expect(tool.hint.length).toBeGreaterThan(10);
      expect(tool.label.length).toBeGreaterThan(0);
    }
  });

  it('splits into exactly two rails, both non-empty', () => {
    expect(designToolsForRail('create').length).toBeGreaterThan(0);
    expect(designToolsForRail('modify').length).toBeGreaterThan(0);
    expect(designToolsForRail('create').length + designToolsForRail('modify').length).toBe(
      DESIGN_TOOLS.length,
    );
  });

  it('starts the create rail with Select', () => {
    expect(designToolsForRail('create')[0]?.kind).toBe('select');
  });
});

describe('DESIGN_TOOL_BY_KIND', () => {
  it('indexes every tool', () => {
    for (const tool of DESIGN_TOOLS) expect(DESIGN_TOOL_BY_KIND[tool.kind]).toBe(tool);
  });
});

describe('designToolForShortcut', () => {
  it('matches case-insensitively', () => {
    expect(designToolForShortcut('R')?.kind).toBe('rect');
    expect(designToolForShortcut('r')?.kind).toBe('rect');
  });

  it('returns null for an unbound key', () => {
    expect(designToolForShortcut('1')).toBeNull();
    expect(designToolForShortcut('q')).toBeNull();
  });
});
