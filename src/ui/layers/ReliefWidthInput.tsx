import type { ReliefObject } from '../../core/scene';
import { useStore } from '../state';
import { reliefPlanningWidthTitle } from './ReliefPlanningWidthDisclosure';
import { useDebouncedCommit } from './use-debounced-commit';

const WIDTH_STEP_MM = 1;
const LABEL_COLUMN_WIDTH_PX = 92;
const ROW_GAP_PX = 8;
const ROW_MARGIN_BOTTOM_PX = 6;
const CONTROL_GAP_PX = 6;
const INPUT_PADDING = '4px 6px';
const INPUT_BORDER_RADIUS_PX = 4;
const UNIT_FONT_SIZE_PX = 12;

/** Commits one relief's displayed machine-space Width without a lossy native divide. */
export function ReliefWidthInput(props: {
  readonly relief: ReliefObject;
  readonly widthMm: number;
}): JSX.Element {
  const setReliefParams = useStore((state) => state.setReliefParams);
  const debounced = useDebouncedCommit<number>({
    value: props.widthMm,
    commit: (value) => setReliefParams(props.relief.id, { machineWidthMm: value }),
    parse: (input) => {
      const parsed = Number.parseFloat(input);
      return positiveFinite(parsed) ? parsed : props.widthMm;
    },
  });
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>Width</span>
      <span style={controlStyle}>
        <input
          type="number"
          step={WIDTH_STEP_MM}
          value={debounced.displayValue}
          onChange={debounced.onChange}
          onBlur={debounced.onBlur}
          aria-label="Relief width (mm)"
          title={reliefPlanningWidthTitle(props.relief)}
          style={inputStyle}
        />
        <span style={unitStyle}>mm</span>
      </span>
    </label>
  );
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: `${LABEL_COLUMN_WIDTH_PX}px 1fr`,
  alignItems: 'center',
  gap: ROW_GAP_PX,
  marginBottom: ROW_MARGIN_BOTTOM_PX,
};
const labelStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
const controlStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: CONTROL_GAP_PX,
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: INPUT_PADDING,
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-input)',
  color: 'var(--lf-text)',
  borderRadius: INPUT_BORDER_RADIUS_PX,
};
const unitStyle: React.CSSProperties = {
  fontSize: UNIT_FONT_SIZE_PX,
  color: 'var(--lf-text-faint)',
};
