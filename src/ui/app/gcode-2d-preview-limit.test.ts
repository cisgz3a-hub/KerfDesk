import { describe, expect, it } from 'vitest';
import type { Toolpath } from '../../core/job';
import { limitGcode2dPreview } from './gcode-2d-preview-limit';

describe('limitGcode2dPreview', () => {
  it('keeps small previews unchanged', () => {
    const toolpath: Toolpath = {
      steps: [{ kind: 'travel', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, length: 1 }],
      totalLength: 1,
    };
    expect(limitGcode2dPreview(toolpath, 2)).toBe(toolpath);
  });

  it('returns an honest visible prefix without refusing the preview', () => {
    const toolpath: Toolpath = {
      steps: [
        { kind: 'travel', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, length: 1 },
        { kind: 'travel', from: { x: 1, y: 0 }, to: { x: 3, y: 0 }, length: 2 },
        { kind: 'travel', from: { x: 3, y: 0 }, to: { x: 6, y: 0 }, length: 3 },
      ],
      totalLength: 6,
    };
    const limited = limitGcode2dPreview(toolpath, 2);
    expect(limited.steps).toHaveLength(2);
    expect(limited.totalLength).toBe(3);
    expect(limited.previewIssue).toEqual({
      kind: 'render-limited',
      maximum: 2,
      observed: 3,
    });
  });
});
