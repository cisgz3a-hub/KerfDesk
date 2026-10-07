import { openFillContours, summarizeOpenFillContours } from '../../../core/job/open-fill-contours';
import { Button } from '../../kit';
import { useStore } from '../../state/store';
import type { JobReviewFillOmissions } from './job-review-fill-omissions';
import { useJobReviewStore } from './job-review-store';
import { revealReviewedArtwork } from './reveal-reviewed-artwork';

export function ShowOmittedFillArtworkButton(props: {
  readonly omissions: JobReviewFillOmissions;
}): JSX.Element {
  const handleShow = (): void => {
    const review = useJobReviewStore.getState().state;
    if (review.kind !== 'open' || review.model.openFillOmissions !== props.omissions) return;
    const project = useStore.getState().project;
    const reviewedIds = new Set(props.omissions.objectIds);
    const eligible = summarizeOpenFillContours(openFillContours(project.scene, reviewedIds));
    revealReviewedArtwork(props.omissions.sources, new Set(eligible.objectIds));
  };
  return (
    <Button
      onClick={handleShow}
      title="Cancel this review and select the unchanged artwork with open Fill contours."
    >
      Show omitted artwork
    </Button>
  );
}
