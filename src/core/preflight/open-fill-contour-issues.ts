import { openFillContours, summarizeOpenFillContours } from '../job/open-fill-contours';
import type { Scene } from '../scene';
import type { PreflightIssue } from './preflight';

export function openFillContourIssues(scene: Scene): ReadonlyArray<PreflightIssue> {
  const summary = summarizeOpenFillContours(openFillContours(scene));
  if (summary.contourCount === 0) return [];
  const contours = summary.contourCount === 1 ? 'contour' : 'contours';
  return [
    {
      // Retain the historical advisory key for saved/consumer compatibility.
      // It now covers every Fill style, not just Offset Fill.
      code: 'offset-fill-open-contour',
      message:
        'Fill output omits ' +
        summary.contourCount +
        ' open ' +
        contours +
        ' in ' +
        summary.objectIds.length +
        ' artwork. Close the shapes, or use Line to engrave their outlines. ' +
        'Scanline, Island and Offset Fill all require closed contours.',
    },
  ];
}
