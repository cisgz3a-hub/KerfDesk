import { Button } from '../../kit';
import { useStore } from '../../state/store';
import { extraFillCopyIds, type JobReviewStackedFillCopies } from './job-review-fill-copies';
import { useJobReviewStore } from './job-review-store';
import { revealReviewedArtwork } from './reveal-reviewed-artwork';

// LightBurn's "Show Me" for duplicate Fill shapes (ADR-683): select one copy of
// each stacked pair so a single Delete leaves the other to burn.
export function ShowStackedFillCopiesButton(props: {
  readonly copies: JobReviewStackedFillCopies;
}): JSX.Element {
  const handleShow = (): void => {
    const review = useJobReviewStore.getState().state;
    if (review.kind !== 'open' || review.model.stackedFillCopies !== props.copies) return;
    const eligible = extraFillCopyIds(useStore.getState().project.scene);
    revealReviewedArtwork(props.copies.sources, eligible);
  };
  return (
    <Button
      onClick={handleShow}
      title="Cancel this review and select the extra copy of each stacked Fill shape, ready to delete."
    >
      Show stacked copies
    </Button>
  );
}
