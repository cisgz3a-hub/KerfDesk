// Preview emptiness, raster-aware (M27, AUDIT-2026-06-10). The scrubber
// toolpath only walks vector cuts/travels — raster groups are a continuous
// sweep with no toolpath steps — so `totalLength === 0` alone would call an
// image-only job "empty" and show a misleading hint over a legitimate
// preview (the raster sim renders separately).

import type { Toolpath } from '../../core/job';
import type { Project } from '../../core/scene';

export type PreviewIssue =
  | { readonly kind: 'too-complex' }
  | { readonly kind: 'preparation-failed'; readonly messages: ReadonlyArray<string> }
  // resolveJobPlacement refused (e.g. custom origin with no live position);
  // carries the placement failure messages so the overlay can name the reason
  // instead of the scope-oriented "enable Output" hint.
  | { readonly kind: 'placement-unavailable'; readonly messages: ReadonlyArray<string> };

export type PreviewToolpath = Toolpath & {
  readonly previewIssue?: PreviewIssue;
};

export function previewIssueFor(toolpath: Toolpath): PreviewIssue | null {
  return (toolpath as PreviewToolpath).previewIssue ?? null;
}

export function previewHasBurnableContent(project: Project, toolpath: Toolpath): boolean {
  if (toolpath.totalLength > 0) return true;
  return sceneHasOutputRaster(project);
}

function sceneHasOutputRaster(project: Project): boolean {
  const imageColors = new Set(
    project.scene.layers
      .filter((layer) => layer.output && layer.mode === 'image')
      .map((layer) => layer.color),
  );
  if (imageColors.size === 0) return false;
  return project.scene.objects.some(
    (obj) =>
      obj.kind === 'raster-image' && obj.role !== 'trace-source' && imageColors.has(obj.color),
  );
}
