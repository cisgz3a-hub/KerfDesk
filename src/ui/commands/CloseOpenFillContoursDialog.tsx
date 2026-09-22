import { useMemo, useState } from 'react';
import type { Project } from '../../core/scene';
import {
  CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM,
  selectedOpenFillContourRepairSummary,
} from '../common/fill-diagnostics';
import { Button, Dialog, DialogActions } from '../kit';

const DEFAULT_REVIEW_TOLERANCE_MM = 1;

export function CloseOpenFillContoursDialog(props: {
  readonly project: Project;
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly onCancel: () => void;
  readonly onApply: (toleranceMm: number) => void;
}): JSX.Element {
  const [toleranceText, setToleranceText] = useState(String(DEFAULT_REVIEW_TOLERANCE_MM));
  const toleranceMm = parseTolerance(toleranceText);
  const summary = useMemo(
    () =>
      selectedOpenFillContourRepairSummary(
        props.project,
        props.selectedObjectId,
        props.additionalSelectedIds,
        toleranceMm ?? 0,
      ),
    [props.additionalSelectedIds, props.project, props.selectedObjectId, toleranceMm],
  );
  const closableCount = summary.safeCount + summary.reviewedCount;
  const canApply = toleranceMm !== null && closableCount > 0;

  return (
    <Dialog
      title="Close Fill Contours With Tolerance"
      size="sm"
      onClose={props.onCancel}
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (canApply) props.onApply(toleranceMm);
      }}
    >
      <label className="lf-field">
        <span>Tolerance</span>
        <input
          className="lf-input"
          type="number"
          min={CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM}
          step="0.1"
          title="Maximum endpoint gap in millimeters to close after reviewing the counts."
          value={toleranceText}
          onChange={(event) => setToleranceText(event.currentTarget.value)}
        />
        <span>mm</span>
      </label>
      <div className="lf-dialog-body">
        <p>{plural(summary.openCount, 'open Fill contour')} selected.</p>
        <p>
          {plural(summary.safeCount, 'can use', 'can use')} the{' '}
          {CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM} mm quick close.
        </p>
        <p>{plural(summary.reviewedCount, 'additional contour')} will close after review.</p>
        <p>{plural(summary.remainingCount, 'contour')} will remain open.</p>
      </div>
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={!canApply}>
          Apply Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function parseTolerance(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function plural(count: number, singular: string, pluralText = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralText}`;
}
