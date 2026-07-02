// SelectedReliefProperties — the relief carve-parameter editor (width /
// depth / background), promised when H.5 roughing landed. CNC-only: relief
// objects are inert in laser mode, so the section only renders for a CNC
// project with exactly one relief selected (the laser Shape Properties
// panel is the mirror case — ADR-100 §3).

import { machineKindOf, type ReliefObject } from '../../core/scene';
import { useStore } from '../state';
import { useDebouncedCommit } from './use-debounced-commit';

const MIN_WIDTH_MM = 1;
const MAX_WIDTH_MM = 1500;
const MIN_DEPTH_MM = 0.1;
const MAX_DEPTH_MM = 200;
const VERTICES_PER_TRIANGLE_FLOATS = 9;

export function SelectedReliefProperties(): JSX.Element | null {
  const relief = useStore((s) => {
    if (machineKindOf(s.project.machine) !== 'cnc') return null;
    if (s.selectedObjectId === null || s.additionalSelectedIds.size > 0) return null;
    const selected = s.project.scene.objects.find((o) => o.id === s.selectedObjectId);
    return selected?.kind === 'relief' ? selected : null;
  });
  if (relief === null) return null;
  return (
    <section aria-label="Relief properties" style={sectionStyle}>
      <h3 style={headingStyle}>Relief</h3>
      <p style={metaStyle}>
        {relief.source} — {Math.round(relief.meshPositions.length / VERTICES_PER_TRIANGLE_FLOATS)}{' '}
        triangles
      </p>
      <ReliefNumberField
        relief={relief}
        label="Width"
        value={relief.targetWidthMm}
        min={MIN_WIDTH_MM}
        max={MAX_WIDTH_MM}
        step={1}
        title="Carved width on the stock. Height follows the mesh aspect ratio."
        commitKey="targetWidthMm"
      />
      <ReliefNumberField
        relief={relief}
        label="Depth"
        value={relief.reliefDepthMm}
        min={MIN_DEPTH_MM}
        max={MAX_DEPTH_MM}
        step={0.5}
        title="Total relief depth: the mesh's Z range maps to [-depth, 0] below the stock top."
        commitKey="reliefDepthMm"
      />
      <BackgroundSelect relief={relief} />
    </section>
  );
}

function ReliefNumberField(props: {
  readonly relief: ReliefObject;
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly title: string;
  readonly commitKey: 'targetWidthMm' | 'reliefDepthMm';
}): JSX.Element {
  const setReliefParams = useStore((s) => s.setReliefParams);
  const debounced = useDebouncedCommit<number>({
    value: props.value,
    commit: (value) => setReliefParams(props.relief.id, { [props.commitKey]: value }),
    parse: (input) => {
      const parsed = Number.parseFloat(input);
      if (!Number.isFinite(parsed)) return props.value;
      return Math.max(props.min, Math.min(props.max, parsed));
    },
  });
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>{props.label}</span>
      <span style={controlStyle}>
        <input
          type="number"
          min={props.min}
          max={props.max}
          step={props.step}
          value={debounced.displayValue}
          onChange={debounced.onChange}
          onBlur={debounced.onBlur}
          aria-label={`Relief ${props.label.toLowerCase()} (mm)`}
          title={props.title}
          style={inputStyle}
        />
        <span style={unitStyle}>mm</span>
      </span>
    </label>
  );
}

function BackgroundSelect(props: { readonly relief: ReliefObject }): JSX.Element {
  const setReliefParams = useStore((s) => s.setReliefParams);
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>Background</span>
      <span style={controlStyle}>
        <select
          value={props.relief.emptyCells}
          onChange={(e) =>
            setReliefParams(props.relief.id, {
              emptyCells: e.target.value === 'top' ? 'top' : 'floor',
            })
          }
          aria-label="Relief background"
          title="Where mesh-free cells sit: carved to the floor (model stands proud) or kept at the stock top."
          style={selectStyle}
        >
          <option value="floor">Carve away (floor)</option>
          <option value="top">Keep at stock top</option>
        </select>
      </span>
    </label>
  );
}

const sectionStyle: React.CSSProperties = {
  borderTop: '1px solid var(--lf-border)',
  marginTop: 12,
  paddingTop: 10,
};
const headingStyle: React.CSSProperties = { fontSize: 13, margin: '0 0 4px 0' };
const metaStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-faint)',
  margin: '0 0 8px 0',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '92px 1fr',
  alignItems: 'center',
  gap: 8,
  marginBottom: 6,
};
const labelStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
const controlStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 6px',
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-input)',
  color: 'var(--lf-text)',
  borderRadius: 4,
};
const selectStyle: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: 12, padding: '2px 4px' };
const unitStyle: React.CSSProperties = { fontSize: 12, color: 'var(--lf-text-faint)' };
