// OffsetPathsRow — inset/outset the selected closed vector shapes by a
// distance (ADR-103 G1). Machine-agnostic (kerf compensation on a laser,
// clearing outlines and inlay gaps on a router), so it mounts OUTSIDE the
// laser-only Shape Properties gate. The result is a NEW object; the
// sources stay (VCarve/Offsetter convention).

import { TutorialButton } from '../tutorials/TutorialButton';
import { useState } from 'react';
import { NumberField as ClearableNumberField } from '../common/NumberField';
import { useStore } from '../state';
import { selectionCanWeld } from '../commands/selection-command-state';

const DEFAULT_OFFSET_MM = 1;
const MIN_OFFSET_MM = 0.01;
const MAX_OFFSET_MM = 100;

export function OffsetPathsRow(): JSX.Element | null {
  const project = useStore((s) => s.project);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const offsetSelection = useStore((s) => s.offsetSelection);
  const [distanceMm, setDistanceMm] = useState(DEFAULT_OFFSET_MM);
  const selectedIds = [
    ...(selectedObjectId === null ? [] : [selectedObjectId]),
    ...additionalSelectedIds,
  ];
  // Same eligibility as Weld: unlocked, closed-contour vector selection.
  if (!selectionCanWeld(project, selectedIds)) return null;
  return (
    <section aria-label="Offset paths" className="lf-artwork-tool">
      <div className="lf-artwork-tool__heading">
        <h4>Offset outlines</h4>
        <TutorialButton tutorialId="offset" compact label="Offset paths" />
      </div>
      <p className="lf-artwork-hint">Keep the original and add a larger or smaller outline.</p>
      <label className="lf-artwork-tool__field">
        <span>Distance</span>
        <ClearableNumberField
          ariaLabel="Offset distance"
          title="Distance in millimeters between the shape and its offset copy."
          min={MIN_OFFSET_MM}
          max={MAX_OFFSET_MM}
          step={0.1}
          value={distanceMm}
          onCommit={setDistanceMm}
          style={inputStyle}
        />
        <span style={unitStyle}>mm</span>
      </label>
      <div className="lf-artwork-tool__actions">
        <button
          type="button"
          onClick={() => offsetSelection(distanceMm)}
          title="Add a new path outside the selected shapes at this distance."
        >
          Outward copy
        </button>
        <button
          type="button"
          onClick={() => offsetSelection(-distanceMm)}
          title="Add a new path inside the selected shapes at this distance."
        >
          Inward copy
        </button>
      </div>
    </section>
  );
}

const inputStyle: React.CSSProperties = { width: 64, boxSizing: 'border-box' };
const unitStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-faint)' };
