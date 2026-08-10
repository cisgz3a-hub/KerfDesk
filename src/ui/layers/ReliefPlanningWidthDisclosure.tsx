import type { ReliefObject } from '../../core/scene';
import { reliefMachineSpacePlanningWidthMm } from '../../core/cnc/relief-machine-space-planning-width';

const NOTE_FONT_SIZE_PX = 11;
const NOTE_LINE_HEIGHT = 1.25;
const NOTE_MARGIN = '-2px 0 6px 0';

/** Names the existing mesh width or the canonical field's compatibility/native CAM representation. */
export function reliefPlanningWidthTitle(relief: ReliefObject): string {
  if (relief.reliefSource.kind === 'legacy-mesh') {
    return 'Carved width on the stock after object scale. Editing preserves the current scale.';
  }
  return relief.transform.scaleX === 0
    ? 'Stored planning width. This zero-scale compatibility axis collapses after planning; editing width remains available.'
    : 'Heightmap planning width from the canonical source after native binary64 absolute object X scale. Field geometry uses exact-factor display math. Editing synchronizes the object target and source widths; an exact bounded local re-factor may change both scale axes without changing transformed geometry.';
}

/** Resolves the editable Width authority while preserving mesh and exact-zero compatibility. */
export function reliefPropertyWidthMm(relief: ReliefObject, targetScaleX: number): number {
  return reliefMachineSpacePlanningWidthMm(relief) * targetScaleX;
}

/** Explains a positive source-factor magnitude lost by native heightmap planning arithmetic. */
export function ReliefPlanningWidthDisclosure(props: {
  readonly relief: ReliefObject;
  readonly widthMm: number;
}): JSX.Element | null {
  if (
    props.relief.reliefSource.kind !== 'heightfield-v1' ||
    props.relief.transform.scaleX === 0 ||
    (props.widthMm !== 0 && props.widthMm !== Number.POSITIVE_INFINITY)
  ) {
    return null;
  }
  return (
    <p aria-label="Relief CAM planning width precision" role="note" style={noteStyle}>
      Native binary64 heightmap planning{' '}
      {props.widthMm === 0
        ? 'rounds this positive canonical source axis to 0 mm.'
        : 'overflows this finite canonical source-axis magnitude to Infinity.'}{' '}
      Field geometry above preserves its source-factor magnitude as a six-significant-digit readout.
      Heightmap materialization requires the width to be finite and positive.
    </p>
  );
}

const noteStyle: React.CSSProperties = {
  color: 'var(--lf-warning-fg)',
  fontSize: NOTE_FONT_SIZE_PX,
  lineHeight: NOTE_LINE_HEIGHT,
  margin: NOTE_MARGIN,
};
