import { findRegistrationBoxBounds, type Project } from '../../../core/scene';
import { computeView, type ViewState } from '../view-transform';

export const JIG_BED_VIEW: ViewState = { zoomFactor: 1, panX: 0, panY: 0 };

export function fitJigCanvasView(
  project: Project,
  size: { readonly width: number; readonly height: number },
): ViewState {
  const bounds = findRegistrationBoxBounds(project.scene);
  if (bounds === null) return JIG_BED_VIEW;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (width <= 0 || height <= 0 || size.width <= 0 || size.height <= 0) return JIG_BED_VIEW;
  const bed = project.device;
  const base = computeView(size.width, size.height, bed.bedWidth, bed.bedHeight);
  // Leave room for the outline, size labels, and editing around its edges.
  const scale = Math.min((size.width * 0.84) / width, (size.height * 0.84) / height);
  return {
    zoomFactor: scale / base.scale,
    panX: bed.bedWidth / 2 - (bounds.minX + bounds.maxX) / 2,
    panY: bed.bedHeight / 2 - (bounds.minY + bounds.maxY) / 2,
  };
}
