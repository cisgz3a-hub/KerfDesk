// Routes V-carve preview preparation off the main thread.
//
// The segment budgets in core/job/preparation-complexity.ts model CNC cost as
// input segments x depth passes, which holds for profile and pocket because
// those trace the artwork roughly once per pass. V-carve does not: it resolves
// a medial axis and emits a dense variable-depth route, so the compiled result
// is unbounded in the input's size. Measured on the current engine
// (vcarveMedialPasses, ADR-285): 120 closed contours carrying 480 raw segments
// -- 0.5% of the 100,000 segment budget -- take ~1.5 s to prepare, and real
// glyph outlines carry far more points than that synthetic case.
//
// The consequence was that selecting the V-carve cut type sent every later
// project change straight into a synchronous main-thread prepare, freezing the
// app. Reporting the scene as over-budget hands it to the ADR-244 preparation
// worker instead, which is the path large laser jobs already take.
//
// Routing only, never a refusal (rule 7): the preview still renders, and Save,
// Start and Frame prepare V-carve in full on every path exactly as before.
//
// Applied at buildPreviewToolpath rather than inside previewPreparationIssue,
// because that predicate is shared with computeDesignSceneSource (the 3D carve
// pane, ADR-261), which treats any issue as "render nothing". Reporting V-carve
// as over-budget there would blank the pane rather than move its work. That
// pane calls prepareOutput on the main thread with no worker fallback, so it
// remains a synchronous V-carve compile site this module does not fix.

import { DEFAULT_CNC_LAYER_SETTINGS, type Project } from '../../core/scene';

/** True when this project's preview must be prepared off the main thread
 * because a V-carve layer will amplify a small scene into a large toolpath. */
export function cncVCarvePreparationTooComplex(project: Project): boolean {
  if (project.machine?.kind !== 'cnc') return false;
  return project.scene.layers.some(
    (layer) => layer.output && (layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS).cutType === 'v-carve',
  );
}
