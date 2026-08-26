import type { Toolpath } from '../../core/job';
import type { PreviewToolpath } from '../workspace/preview-status';
import { LARGE_SCENE_SEGMENT_THRESHOLD } from '../workspace/draw-complexity';
import { previewDisplayDecimation } from '../workspace/preview-display-decimation';

export const GCODE_2D_PREVIEW_PRESSURE_THRESHOLD = LARGE_SCENE_SEGMENT_THRESHOLD;

export function annotateGcode2dPreviewPressure(
  toolpath: Toolpath,
  threshold = GCODE_2D_PREVIEW_PRESSURE_THRESHOLD,
): PreviewToolpath {
  const decimation = previewDisplayDecimation(toolpath, threshold);
  if (decimation === null) return toolpath;
  return {
    ...toolpath,
    previewIssue: {
      kind: 'display-decimated',
      ...decimation,
    },
  };
}
