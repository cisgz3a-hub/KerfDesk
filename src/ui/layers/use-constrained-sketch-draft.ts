import { useState } from 'react';
import type {
  ConstrainedSketch2d,
  SketchSolveResult,
} from '../../core/sketch-constraints/constrained-sketch';
import { defaultConstrainedSketch } from '../../core/sketch-constraints/default-constrained-sketch';
import type { ImportedSvg } from '../../core/scene';
import { useStore } from '../state';
import type { ConstrainedSketchReview } from '../state/constrained-sketch-actions';
export function useConstrainedSketchDraft(object: ImportedSvg | undefined, onClose: () => void) {
  const [sketch, setSketch] = useState<ConstrainedSketch2d>(
    () => object?.constrainedSketch ?? defaultConstrainedSketch(),
  );
  const [review, setReview] = useState<ConstrainedSketchReview | null>(null);
  const [result, setResult] = useState<SketchSolveResult | null>(null),
    [error, setError] = useState('');
  const project = useStore((state) => state.project),
    epoch = useStore((state) => state.projectDocumentEpoch);
  const stale =
    review !== null && (review.sourceProject !== project || review.documentEpoch !== epoch);
  function change(next: ConstrainedSketch2d): void {
    setSketch(next);
    setReview(null);
    setResult(null);
    setError('');
  }
  function solve(): void {
    const prepared = useStore.getState().reviewConstrainedSketch(sketch, object?.id);
    if (prepared.kind === 'invalid') {
      setError(prepared.reason);
      setResult(prepared.result ?? null);
      setReview(null);
    } else {
      setError('');
      setReview(prepared.review);
      setResult(prepared.review.result);
    }
  }
  function apply(): void {
    if (review === null) return;
    if (useStore.getState().applyConstrainedSketch(review)) onClose();
    else {
      setReview(null);
      setError('The project changed. Review the current sketch again.');
    }
  }
  function bake(): void {
    if (object === undefined) return;
    if (useStore.getState().bakeConstrainedSketch(object, epoch)) onClose();
    else setError('The sketch changed. Reopen it before baking.');
  }
  return { sketch, review, result, error, stale, change, solve, apply, bake };
}
