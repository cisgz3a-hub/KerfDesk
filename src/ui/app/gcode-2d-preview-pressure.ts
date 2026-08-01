import type { Toolpath } from '../../core/job';
import type { PreviewToolpath } from '../workspace/preview-status';

export const GCODE_2D_PREVIEW_PRESSURE_THRESHOLD = 250_000;

export function annotateGcode2dPreviewPressure(
  toolpath: Toolpath,
  threshold = GCODE_2D_PREVIEW_PRESSURE_THRESHOLD,
): PreviewToolpath {
  if (toolpath.steps.length <= threshold) return toolpath;
  return {
    ...toolpath,
    previewIssue: {
      kind: 'render-pressure',
      threshold,
      observed: toolpath.steps.length,
    },
  };
}
