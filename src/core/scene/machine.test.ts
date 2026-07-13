import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_STOCK,
  DEFAULT_CNC_TOOLS,
  type CncToolKind,
} from './machine';

const STABLE_DEFAULT_TOOL_IDS = [
  'em-3175',
  'em-1588',
  'em-6350',
  'em-9525',
  'em-1000',
  'em-2000',
  'em-3000',
  'em-6000',
  'dc-3175',
  'cp-6350',
  'bn-3175',
  'bn-1588',
  'bn-6350',
  'vb-30',
  'vb-45',
  'vb-60',
  'vb-90',
  'eng-15',
] as const;

const ANGLED_TOOL_KINDS = new Set<CncToolKind>(['v-bit', 'engraving']);

describe('DEFAULT_CNC_TOOLS', () => {
  it('keeps shipped tool ids stable and append-only', () => {
    const ids = DEFAULT_CNC_TOOLS.map((tool) => tool.id);

    expect(ids.slice(0, STABLE_DEFAULT_TOOL_IDS.length)).toEqual([...STABLE_DEFAULT_TOOL_IDS]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the default active tool in the built-in library', () => {
    const ids = DEFAULT_CNC_TOOLS.map((tool) => tool.id);

    expect(DEFAULT_CNC_MACHINE_CONFIG.tools).toBe(DEFAULT_CNC_TOOLS);
    expect(ids).toContain(DEFAULT_CNC_MACHINE_CONFIG.toolId);
  });

  it('keeps built-in tool geometry finite and kind-specific', () => {
    for (const tool of DEFAULT_CNC_TOOLS) {
      expect(tool.id.length).toBeGreaterThan(0);
      expect(tool.name.length).toBeGreaterThan(0);
      expect(Number.isFinite(tool.diameterMm)).toBe(true);
      expect(tool.diameterMm).toBeGreaterThan(0);

      if (ANGLED_TOOL_KINDS.has(tool.kind)) {
        expect(Number.isFinite(tool.tipAngleDeg)).toBe(true);
        expect(tool.tipAngleDeg).toBeGreaterThan(0);
        expect(tool.tipAngleDeg).toBeLessThan(180);
      } else {
        expect(tool.tipAngleDeg).toBeUndefined();
      }
    }
  });
});

describe('DEFAULT_CNC_LAYER_SETTINGS', () => {
  it('starts with a shallow pass instead of releasing the part', () => {
    expect(DEFAULT_CNC_LAYER_SETTINGS.depthMm).toBeGreaterThan(0);
    expect(DEFAULT_CNC_LAYER_SETTINGS.depthMm).toBeLessThan(DEFAULT_CNC_STOCK.thicknessMm);
    expect(DEFAULT_CNC_LAYER_SETTINGS.tabsEnabled).toBe(false);
  });
});
