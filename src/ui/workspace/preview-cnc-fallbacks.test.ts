import { describe, expect, it } from 'vitest';
import type { Job } from '../../core/job';
import { createLayer, createProject, type Project } from '../../core/scene';
import { previewCncFallbackNotices, withPreviewCncFallbacks } from './preview-cnc-fallbacks';

const project: Project = {
  ...createProject(),
  scene: {
    objects: [],
    layers: [
      { ...createLayer({ id: 'rest', color: '#ff0000' }), name: 'Rest' },
      { ...createLayer({ id: 'carve', color: '#00ff00' }), name: 'Letters' },
    ],
  },
};

describe('previewCncFallbackNotices', () => {
  it('names each operation the compile cut another way, by layer name', () => {
    const job: Job = {
      groups: [],
      cncCompilation: {
        vcarveOperations: [
          {
            operationIndex: 1,
            layerId: 'carve',
            entryIssue: 'The requested entry angle was not applied.',
            offsetFailed: false,
            thinResidual: false,
            passLimited: false,
          },
        ],
        strategyFallbacks: [
          {
            layerId: 'rest',
            kind: 'rest-full-pocket',
            reason: 'The retained stock source is invalid.',
          },
        ],
      },
    };
    expect(previewCncFallbackNotices(project, job)).toEqual([
      'Rest: Rest machining will clear the whole pocket with the finishing bit instead: The retained stock source is invalid. No previous-stock subtraction is used.',
      'Letters: The requested entry angle was not applied. Set Ramp entry to 0 to remove this notice.',
    ]);
  });

  it('leaves a route with nothing to disclose as it is', () => {
    const toolpath = { steps: [], totalLength: 0 };
    const job: Job = { groups: [], cncCompilation: { vcarveOperations: [] } };
    expect(withPreviewCncFallbacks(toolpath, project, job)).toBe(toolpath);
    expect(withPreviewCncFallbacks(toolpath, project, { groups: [] })).toBe(toolpath);
  });
});
