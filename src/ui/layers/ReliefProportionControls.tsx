// Keeping an STL relief's proportions (ADR-579). With "Keep proportions" on, a
// Width edit scales Depth by the same factor and a Depth edit scales Width, in
// one undo step, so a 3D model is resized rather than stretched. "Use model
// proportions" sets Depth from the placed width and the model's own height to
// width ratio, the scale at which nothing is squashed.

import { useMemo } from 'react';
import { meshBounds } from '../../core/relief';
import type { MeshReliefObject } from '../../core/scene/relief';
import type { ReliefParamPatch } from '../state/relief-param-actions';
import { useStore } from '../state';

/** The patch a Width or Depth edit commits, carrying its partner when locked. */
export function proportionalReliefPatch(
  relief: { readonly targetWidthMm: number; readonly reliefDepthMm: number },
  key: 'targetWidthMm' | 'reliefDepthMm',
  value: number,
  locked: boolean,
): ReliefParamPatch {
  if (!locked) return { [key]: value };
  const factor = value / (key === 'targetWidthMm' ? relief.targetWidthMm : relief.reliefDepthMm);
  if (!(factor > 0) || !Number.isFinite(factor)) return { [key]: value };
  return key === 'targetWidthMm'
    ? { targetWidthMm: value, reliefDepthMm: relief.reliefDepthMm * factor }
    : { reliefDepthMm: value, targetWidthMm: relief.targetWidthMm * factor };
}

/** Depth at which the model's height keeps its ratio to its placed width. */
export function modelProportionDepthMm(
  relief: MeshReliefObject,
  bounds: ReturnType<typeof meshBounds>,
  targetScaleX: number,
): number | null {
  if (bounds === null) return null;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxZ - bounds.minZ;
  const depth = relief.targetWidthMm * targetScaleX * (height / width);
  return depth > 0 && Number.isFinite(depth) ? depth : null;
}

export function ReliefProportionControls(props: {
  readonly relief: MeshReliefObject;
  readonly targetScaleX: number;
  readonly locked: boolean;
  readonly onLockedChange: (locked: boolean) => void;
}): JSX.Element {
  const { relief } = props;
  const setReliefParams = useStore((s) => s.setReliefParams);
  const positions = relief.reliefSource.meshPositions;
  const bounds = useMemo(() => meshBounds({ positions }), [positions]);
  const depth = modelProportionDepthMm(relief, bounds, props.targetScaleX);
  const matches = depth !== null && Math.abs(depth - relief.reliefDepthMm) <= 1e-6 * depth;
  return (
    <div style={rowStyle}>
      <label style={toggleStyle}>
        <input
          type="checkbox"
          checked={props.locked}
          onChange={(event) => props.onLockedChange(event.currentTarget.checked)}
          aria-label="Keep relief proportions"
          title="Scale Depth with Width (and Width with Depth) so the model keeps its shape."
        />
        Keep proportions
      </label>
      {depth === null ? null : (
        <button
          type="button"
          disabled={matches}
          onClick={() => setReliefParams(relief.id, { reliefDepthMm: depth })}
          title="Set Depth so the model's height keeps its true ratio to its width (nothing squashed or stretched)."
        >
          {matches ? 'Model proportions' : `Use model proportions (${formatMm(depth)} mm)`}
        </button>
      )}
    </div>
  );
}

function formatMm(value: number): string {
  return String(Number(value.toFixed(2)));
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  marginBottom: 6,
};
const toggleStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4 };
