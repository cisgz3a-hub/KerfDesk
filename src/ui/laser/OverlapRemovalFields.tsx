// Remove overlapping lines and its merge tolerance (LightBurn gap LBG-C13), in
// the laser-only Cut Planner. The tolerance is kept as typed while editing and
// stored clamped; a project that never sets it keeps no value at all, so its
// file and its G-code stay exactly as before.

import { useState } from 'react';
import {
  clampOverlapMergeTolerance,
  OVERLAP_MERGE_TOLERANCE_RANGE_MM,
  type ProjectOptimizationSettings,
} from '../../core/scene/project';
import { MERGE_ANGLE_DEG } from '../../core/job/remove-near-cut-overlaps';
import { NumberInput } from '../kit/NumberInput';

type Update = (patch: Partial<ProjectOptimizationSettings>) => void;

export function OverlapRemovalFields(props: {
  readonly checked: boolean;
  readonly toleranceMm: number | undefined;
  readonly update: Update;
}): JSX.Element {
  const [text, setText] = useState(String(props.toleranceMm ?? 0));
  return (
    <>
      <label style={checkboxRowStyle}>
        <input
          name="removeOverlappingLines"
          type="checkbox"
          className="lf-checkbox"
          checked={props.checked}
          title="Cut shared Line spans once within each operation. Separate operations and pass counts are preserved."
          onChange={(event) =>
            props.update({ removeOverlappingLines: event.currentTarget.checked })
          }
        />
        <span>Remove overlapping lines</span>
      </label>
      <label style={rowStyle}>
        <span>Merge tolerance (mm)</span>
        <NumberInput
          name="overlapMergeToleranceMm"
          value={text}
          step={0.01}
          disabled={!props.checked}
          title={
            props.checked
              ? `How far apart two Line spans running the same way (within ${MERGE_ANGLE_DEG}°) may lie and still be cut once. 0, the default, merges only spans that coincide exactly. ${OVERLAP_MERGE_TOLERANCE_RANGE_MM.min} to ${OVERLAP_MERGE_TOLERANCE_RANGE_MM.max} mm: keep it under half your kerf so the one cut still covers both lines. Crossing lines are never merged.`
              : 'Turn on Remove overlapping lines to merge near-coincident lines as well.'
          }
          onChange={(event) => {
            const typed = event.currentTarget.value;
            setText(typed);
            const value = Number(typed);
            if (typed.trim() !== '' && Number.isFinite(value)) {
              props.update({ overlapMergeToleranceMm: clampOverlapMergeTolerance(value) });
            }
          }}
        />
      </label>
    </>
  );
}

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
};
const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(110px, 1fr) minmax(150px, 1.4fr)',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  paddingLeft: 24,
};
