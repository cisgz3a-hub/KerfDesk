import type { Toolpath } from '../../core/job';
import type { PreviewToolpath } from '../workspace/preview-status';

export const GCODE_2D_PREVIEW_STEP_LIMIT = 250_000;

export function limitGcode2dPreview(
  toolpath: Toolpath,
  maximum = GCODE_2D_PREVIEW_STEP_LIMIT,
): PreviewToolpath {
  if (toolpath.steps.length <= maximum) return toolpath;
  const steps = toolpath.steps.slice(0, maximum);
  const totalLength = steps.reduce((sum, step) => sum + step.length, 0);
  return {
    steps,
    totalLength,
    previewIssue: {
      kind: 'render-limited',
      maximum,
      observed: toolpath.steps.length,
    },
  };
}
