// DesignDimensionFields — the Dimension tool's options bar (ADR-272 Amendment
// 7, DS-7).
//
// The dimension just placed (or clicked) is edited here: its value, whether it
// DRIVES the geometry or only reports it, and Delete. A driving value typed
// here re-solves the shape as one undo step; a driven (reference) dimension
// cannot be typed into — make it driving first, which is how Fusion and
// Onshape treat a reference dimension.

import { useState } from 'react';
import { parseEntryValue } from '../../core/design/entry';
import {
  measureDimension,
  sketchDimensions,
  type SketchDimension,
} from '../../core/design/dimensions';
import { dimensionKindLabel } from './design-dimension-annotation';
import { useDesignStudioStore } from './design-studio-store';

export function DesignDimensionFields(): JSX.Element | null {
  const session = useDesignStudioStore((state) => state.session);
  const setDimensionDriving = useDesignStudioStore((state) => state.setDimensionDriving);
  const deleteSelected = useDesignStudioStore((state) => state.deleteSelected);
  const activeId = session?.activeDimensionId ?? null;
  if (session === null || activeId === null) return null;
  const sketch = session.history.present;
  const dimension = sketchDimensions(sketch).find((candidate) => candidate.id === activeId);
  if (dimension === undefined) return null;
  return (
    <>
      {/* Keyed by id: picking another dimension starts its box fresh. */}
      <DimensionValueField
        key={dimension.id}
        dimension={dimension}
        reading={measureDimension(sketch, dimension)}
      />
      <label
        style={fieldStyle}
        title="A driving dimension owns its geometry; a driven one only reports it."
      >
        <input
          type="checkbox"
          checked={dimension.driving}
          onChange={(event) => setDimensionDriving(dimension.id, event.target.checked)}
        />
        <span style={labelStyle}>Driving</span>
      </label>
      <button type="button" style={buttonStyle} onClick={deleteSelected}>
        Delete dimension
      </button>
    </>
  );
}

function DimensionValueField(props: {
  readonly dimension: SketchDimension;
  readonly reading: number | null;
}): JSX.Element {
  const { dimension, reading } = props;
  const driveDimension = useDesignStudioStore((state) => state.driveDimension);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const angular = dimension.kind === 'angle';
  const shown = text ?? (reading === null ? '' : reading.toFixed(angular ? 1 : 2));
  const commit = (): void => {
    if (text === null) return;
    const parsed = parseEntryValue(angular ? 'angle' : 'length', text);
    if (parsed.kind !== 'ok') {
      setError(parsed.kind === 'clear' ? 'the box is empty' : parsed.message);
      return;
    }
    const before = useDesignStudioStore.getState().session?.history.present;
    driveDimension(dimension.id, parsed.value);
    const after = useDesignStudioStore.getState().session?.history.present;
    const honoured = after !== before || reading === parsed.value;
    setError(honoured ? null : 'that value leaves no shape to cut');
    if (honoured) setText(null);
  };
  const label = dimensionKindLabel(dimension);
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={shown}
        disabled={!dimension.driving}
        aria-label={`Dimension ${label.toLowerCase()} in ${angular ? 'degrees' : 'mm'}`}
        aria-invalid={error !== null}
        title={valueTitle(error, dimension.driving)}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => setText(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Escape') {
            event.stopPropagation();
            setText(null);
            setError(null);
          }
        }}
        style={{ ...inputStyle, ...(error === null ? null : invalidStyle) }}
      />
      <span style={unitStyle}>{angular ? '°' : 'mm'}</span>
    </label>
  );
}

function valueTitle(error: string | null, driving: boolean): string {
  if (error !== null) return `Not used: ${error}.`;
  return driving
    ? 'Type a value and press Enter: the shape re-solves to it as one undo step.'
    : 'A driven (reference) dimension only reports. Tick Driving to type a value.';
}

const fieldStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4 };

const labelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-muted)' };

const inputStyle: React.CSSProperties = {
  width: 70,
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
  padding: '1px 5px',
  borderRadius: 4,
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-input)',
  color: 'var(--lf-text)',
};

const invalidStyle: React.CSSProperties = { borderColor: 'var(--lf-danger)' };

const unitStyle: React.CSSProperties = { fontSize: 10, color: 'var(--lf-text-muted)' };

const buttonStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '1px 8px',
  borderRadius: 4,
  border: '1px solid var(--lf-border)',
  background: 'transparent',
  color: 'var(--lf-text)',
  cursor: 'pointer',
};
