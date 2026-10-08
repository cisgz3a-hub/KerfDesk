import { collectLayerContours } from '../../../core/cnc/collect-cnc-contours';
import { cncOpenContourOmissions } from '../../../core/cnc/cnc-open-contour-omissions';
import { CncStrokeGeometryError } from '../../../core/cnc/cnc-stroke-geometry-error';
import { DEFAULT_CNC_LAYER_SETTINGS, machineKindOf, type Project } from '../../../core/scene';
import { cutTypeNeedsClosedContours } from '../../../core/cnc/closed-contour-cut-types';
import { Button } from '../../kit';
import { useStore } from '../../state/store';
import type { JobReviewCncContourOmissions } from './job-review-cnc-omissions';
import { useJobReviewStore } from './job-review-store';
import { matchingReviewArtworkIds, type ReviewArtworkSource } from './review-artwork-sources';
import { revealReviewedArtwork } from './reveal-reviewed-artwork';

export function ShowOmittedCncArtworkButton(props: {
  readonly omissions: JobReviewCncContourOmissions;
}): JSX.Element {
  const handleShow = (): void => {
    const review = useJobReviewStore.getState().state;
    if (
      review.kind !== 'open' ||
      review.model.openCncContourOmissions !== props.omissions ||
      review.purpose === 'laser-second-pass' ||
      review.isPreparing ||
      review.blocker !== null
    )
      return;
    const eligible = currentOmittedArtworkIds(useStore.getState().project, props.omissions.sources);
    revealReviewedArtwork(props.omissions.sources, eligible);
  };
  return (
    <Button
      onClick={handleShow}
      title="Cancel this review and select the unchanged artwork with omitted open CNC contours."
    >
      Show omitted artwork
    </Button>
  );
}

/** Navigation-only eligibility; the review count remains the compiled Job's evidence. */
function currentOmittedArtworkIds(
  project: Project,
  sources: ReadonlyArray<ReviewArtworkSource>,
): ReadonlySet<string> {
  const eligible = new Set<string>();
  if (machineKindOf(project.machine) !== 'cnc') return eligible;
  const matching = new Set(matchingReviewArtworkIds(sources, project.scene.objects));
  const objects = project.scene.objects.filter((object) => matching.has(object.id));
  for (const layer of project.scene.layers) {
    if (
      !layer.output ||
      !cutTypeNeedsClosedContours((layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS).cutType)
    )
      continue;
    try {
      const contours = collectLayerContours(objects, layer, project.device);
      for (const source of cncOpenContourOmissions(layer, contours).sources)
        eligible.add(source.objectId);
    } catch (error) {
      if (!(error instanceof CncStrokeGeometryError)) throw error;
    }
  }
  return eligible;
}
