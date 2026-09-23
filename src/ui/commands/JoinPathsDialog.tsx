import { useMemo, useState } from 'react';
import { isVectorPathObject } from '../../core/geometry';
import { joinOpenVectorPaths, type VectorPathJoinPlan } from '../../core/geometry/vector-path-join';
import type { Scene } from '../../core/scene';
import { Button, Dialog, DialogActions } from '../kit';

export function JoinPathsDialog(props: {
  readonly scene: Scene;
  readonly selectedIds: ReadonlyArray<string>;
  readonly onCancel: () => void;
  readonly onApply: (toleranceMm: number) => void;
}): JSX.Element {
  const [toleranceText, setToleranceText] = useState('0.05');
  const tolerance = toleranceText.trim() === '' ? NaN : Number(toleranceText);
  const plan = useMemo(() => {
    const selected = props.scene.objects.filter((object) => props.selectedIds.includes(object.id));
    const vectors = selected.filter(isVectorPathObject);
    if (
      selected.length === 0 ||
      selected.length !== props.selectedIds.length ||
      vectors.length !== selected.length ||
      selected.some((object) => object.locked === true)
    )
      return null;
    return joinOpenVectorPaths(vectors, props.scene.layers, tolerance);
  }, [props.scene, props.selectedIds, tolerance]);
  const summary = plan?.kind === 'ok' ? plan.value : null;
  const canApply = summary !== null && summary.joins + summary.closures > 0;
  return (
    <Dialog
      title="Join paths"
      size="sm"
      onClose={props.onCancel}
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (canApply) props.onApply(tolerance);
      }}
    >
      <label className="lf-field">
        <span>Maximum gap (mm)</span>
        <input
          className="lf-input"
          type="number"
          min="0"
          step="any"
          title="Set the largest endpoint gap that Join paths may bridge."
          value={toleranceText}
          onChange={(event) => setToleranceText(event.currentTarget.value)}
        />
      </label>
      <p>Connect nearby open endpoints with a short line, including paths in separate artwork.</p>
      <p>
        Paths must share the same operations, colour and artwork settings. Ambiguous junctions and
        paths with manual holding tabs stay unchanged.
      </p>
      <div role="status" aria-live="polite">
        <JoinSummary
          summary={summary}
          error={plan?.kind === 'error' ? plan.error.message : 'Select unlocked vector artwork.'}
        />
      </div>
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={!canApply}>
          Join paths
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function JoinSummary(props: {
  readonly summary: VectorPathJoinPlan | null;
  readonly error: string;
}): JSX.Element {
  const summary = props.summary;
  if (summary === null) return <p>{props.error}</p>;
  return (
    <>
      <p>
        {summary.joins} joins and {summary.closures} closures. {summary.remainingOpenPaths} open
        paths will remain.
      </p>
      {summary.ambiguousEndpoints > 0 ? (
        <p>{summary.ambiguousEndpoints} endpoints have more than one nearby match.</p>
      ) : null}
      {summary.tabbedPaths > 0 ? (
        <p>{summary.tabbedPaths} paths have manual holding tabs.</p>
      ) : null}
      {summary.joins + summary.closures === 0 ? (
        <p>
          No matching endpoints within this gap. Assign paths to the same operation in the artwork
          settings, or increase the gap.
        </p>
      ) : null}
    </>
  );
}
