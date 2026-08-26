import type { Toolpath } from '../../core/job';
import type { Project } from '../../core/scene';
import { rasterPreviewDisplayAdvisory } from './draw-raster-preview';
import { previewRouteForDrawing } from './executable-plan-preview-route';
import { hasOutOfBoundsObjects } from './out-of-bounds';
import { previewDisplayDecimation } from './preview-display-decimation';
import { previewHasBurnableContent, previewIssueFor, type PreviewIssue } from './preview-status';

export function previewStatusOverlayModel(project: Project, toolpath: Toolpath) {
  const issue = previewIssueFor(toolpath);
  const computedDecimation = previewDisplayDecimation(previewRouteForDrawing(toolpath));
  const declaredDecimation = issue?.kind === 'display-decimated' ? issue : null;
  const displayDecimation = computedDecimation ?? declaredDecimation;
  const primaryIssue: PreviewIssue | null = issue?.kind === 'display-decimated' ? null : issue;
  const empty =
    primaryIssue === null &&
    displayDecimation === null &&
    !previewHasBurnableContent(project, toolpath);
  const outOfBounds = hasOutOfBoundsObjects(project);
  const rasterDisplay = rasterPreviewDisplayAdvisory(project);
  return {
    primaryIssue,
    displayDecimation,
    empty,
    outOfBounds,
    rasterDisplay,
    visible:
      primaryIssue !== null ||
      displayDecimation !== null ||
      empty ||
      outOfBounds ||
      rasterDisplay !== null,
  };
}
