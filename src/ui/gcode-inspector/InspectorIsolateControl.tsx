// Isolate controls for the Inspector's readout column (ADR-470): a Z range
// that keeps the heights between two stops, and a section that cuts the job
// through at an X or Y position so its profile shows. Both clip the drawn
// toolpath only; the program, timing and readouts are unchanged.

import { useMemo } from 'react';
import type { GcodeRenderModel } from '../../core/gcode-view';
import { zStops, type IsolateState, type SectionAxis } from './isolate';

const SECTION_STEPS = 200;

export function InspectorIsolateControl(props: {
  readonly model: GcodeRenderModel;
  readonly isolate: IsolateState;
  readonly onChange: (next: IsolateState) => void;
}): JSX.Element {
  const stops = useMemo(() => zStops(props.model), [props.model]);
  const bounds = props.model.stats.motionBounds;
  if (stops === null || bounds === null) return <p style={noteStyle}>No moves to isolate.</p>;
  return (
    <div style={columnStyle}>
      <ZRange stops={stops} isolate={props.isolate} onChange={props.onChange} />
      <Section bounds={bounds} isolate={props.isolate} onChange={props.onChange} />
    </div>
  );
}

function ZRange(props: {
  readonly stops: ReadonlyArray<number>;
  readonly isolate: IsolateState;
  readonly onChange: (next: IsolateState) => void;
}): JSX.Element {
  const { stops, isolate } = props;
  const last = stops.length - 1;
  const lowIndex = isolate.zRange === null ? 0 : nearestStop(stops, isolate.zRange.low);
  const highIndex = isolate.zRange === null ? last : nearestStop(stops, isolate.zRange.high);
  const setRange = (low: number, high: number): void => {
    const whole = low === 0 && high === last;
    props.onChange({
      ...isolate,
      zRange: whole ? null : { low: stops[low] ?? 0, high: stops[high] ?? 0 },
    });
  };
  const zText = (index: number): string => `${(stops[index] ?? 0).toFixed(2)} mm`;
  return (
    <div style={groupStyle}>
      <label style={sliderLabelStyle}>
        <span style={labelRowStyle}>
          <span>Highest Z</span>
          <span style={valueStyle}>{zText(highIndex)}</span>
        </span>
        <input
          type="range"
          style={rangeStyle}
          min={0}
          max={last}
          step={1}
          value={highIndex}
          aria-valuetext={zText(highIndex)}
          title="Hide every move above this height"
          disabled={last === 0}
          onChange={(event) => {
            const high = Number(event.currentTarget.value);
            setRange(Math.min(lowIndex, high), high);
          }}
        />
      </label>
      <label style={sliderLabelStyle}>
        <span style={labelRowStyle}>
          <span>Lowest Z</span>
          <span style={valueStyle}>{zText(lowIndex)}</span>
        </span>
        <input
          type="range"
          style={rangeStyle}
          min={0}
          max={last}
          step={1}
          value={lowIndex}
          aria-valuetext={zText(lowIndex)}
          title="Hide every move below this height"
          disabled={last === 0}
          onChange={(event) => {
            const low = Number(event.currentTarget.value);
            setRange(low, Math.max(highIndex, low));
          }}
        />
      </label>
      {isolate.zRange !== null ? (
        <button
          type="button"
          style={resetStyle}
          title="Remove the Z range filter to show moves at every height"
          onClick={() => setRange(0, last)}
        >
          Show all heights
        </button>
      ) : null}
    </div>
  );
}

function Section(props: {
  readonly bounds: NonNullable<GcodeRenderModel['stats']['motionBounds']>;
  readonly isolate: IsolateState;
  readonly onChange: (next: IsolateState) => void;
}): JSX.Element {
  const { bounds, isolate } = props;
  const section = isolate.section;
  const range = (axis: SectionAxis): { readonly min: number; readonly max: number } =>
    axis === 'x' ? { min: bounds.minX, max: bounds.maxX } : { min: bounds.minY, max: bounds.maxY };
  const setAxis = (value: string): void => {
    if (value !== 'x' && value !== 'y') {
      props.onChange({ ...isolate, section: null });
      return;
    }
    const { min, max } = range(value);
    props.onChange({ ...isolate, section: { axis: value, at: (min + max) / 2, flip: false } });
  };
  const span = section === null ? null : range(section.axis);
  return (
    <div style={groupStyle}>
      <label style={selectLabelStyle}>
        <span>Section</span>
        <select
          value={section?.axis ?? 'off'}
          aria-label="Section"
          title="Cut the view through the job to see its profile"
          onChange={(event) => setAxis(event.currentTarget.value)}
        >
          <option value="off">Off</option>
          <option value="x">Through X</option>
          <option value="y">Through Y</option>
        </select>
      </label>
      {section !== null && span !== null ? (
        <>
          <label style={sliderLabelStyle}>
            <span style={labelRowStyle}>
              <span>Cut at {section.axis.toUpperCase()}</span>
              <span style={valueStyle}>{`${section.at.toFixed(2)} mm`}</span>
            </span>
            <input
              type="range"
              style={rangeStyle}
              min={span.min}
              max={span.max}
              step={Math.max((span.max - span.min) / SECTION_STEPS, 0.001)}
              value={section.at}
              aria-label="Section position"
              aria-valuetext={`${section.at.toFixed(2)} mm`}
              title="Move the section through the job along the selected axis"
              onChange={(event) =>
                props.onChange({
                  ...isolate,
                  section: { ...section, at: Number(event.currentTarget.value) },
                })
              }
            />
          </label>
          <label style={toggleStyle}>
            <input
              type="checkbox"
              checked={section.flip}
              title="Show the opposite side of the section"
              onChange={(event) =>
                props.onChange({
                  ...isolate,
                  section: { ...section, flip: event.currentTarget.checked },
                })
              }
            />
            Show the other side
          </label>
        </>
      ) : null}
    </div>
  );
}

function nearestStop(stops: ReadonlyArray<number>, value: number): number {
  let best = 0;
  for (let index = 1; index < stops.length; index += 1) {
    if (Math.abs((stops[index] ?? 0) - value) < Math.abs((stops[best] ?? 0) - value)) best = index;
  }
  return best;
}

const columnStyle: React.CSSProperties = { display: 'grid', gap: 8 };
const groupStyle: React.CSSProperties = { display: 'grid', gap: 4 };
const sliderLabelStyle: React.CSSProperties = { display: 'grid', gap: 2 };
const labelRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
};
const selectLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};
const valueStyle: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };
const noteStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-text-muted)' };
const toggleStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const resetStyle: React.CSSProperties = { justifySelf: 'start' };
const rangeStyle: React.CSSProperties = { width: '100%', margin: 0 };
