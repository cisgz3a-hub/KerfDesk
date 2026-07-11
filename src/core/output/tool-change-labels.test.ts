import { describe, expect, it } from 'vitest';
import { extractToolChangeLabels, TOOL_CHANGE_LOAD_PREFIX } from './tool-change-labels';

describe('extractToolChangeLabels (R5)', () => {
  it('returns the load-comment payloads in stream order', () => {
    const gcode = [
      'G21',
      `${TOOL_CHANGE_LOAD_PREFIX}6.35 mm end mill`,
      'M0',
      'G1 X10',
      `${TOOL_CHANGE_LOAD_PREFIX}3.175 mm end mill`,
      'M0',
    ].join('\n');
    expect(extractToolChangeLabels(gcode)).toEqual(['6.35 mm end mill', '3.175 mm end mill']);
  });

  it('is empty for a program with no tool-change comments', () => {
    expect(extractToolChangeLabels('G21\nG90\nM0\nM5')).toEqual([]);
  });

  it('does not match the first-tool "load before starting" comment', () => {
    // That comment uses a different prefix (`; tool: X ...`) and is not an M0 change.
    expect(extractToolChangeLabels('; tool: 6 mm (load before starting)\nG21')).toEqual([]);
  });
});
