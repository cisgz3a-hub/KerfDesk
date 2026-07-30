import { describe, expect, it } from 'vitest';
import type { Toolpath } from '../../core/job';
import { annotateGcode2dPreviewPressure } from './gcode-2d-preview-pressure';

describe('annotateGcode2dPreviewPressure', () => {
  it('keeps small previews unchanged', () => {
    const toolpath: Toolpath = {
      steps: [{ kind: 'travel', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, length: 1 }],
      totalLength: 1,
    };
    expect(annotateGcode2dPreviewPressure(toolpath, 2)).toBe(toolpath);
  });

  it('warns about a large preview without dropping any parsed step', () => {
    const toolpath: Toolpath = {
      steps: [
        { kind: 'travel', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, length: 1 },
        { kind: 'travel', from: { x: 1, y: 0 }, to: { x: 3, y: 0 }, length: 2 },
        { kind: 'travel', from: { x: 3, y: 0 }, to: { x: 6, y: 0 }, length: 3 },
      ],
      totalLength: 6,
    };
    const annotated = annotateGcode2dPreviewPressure(toolpath, 2);
    expect(annotated.steps).toBe(toolpath.steps);
    expect(annotated.totalLength).toBe(6);
    expect(annotated.previewIssue).toEqual({
      kind: 'render-pressure',
      threshold: 2,
      observed: 3,
    });
  });
});
