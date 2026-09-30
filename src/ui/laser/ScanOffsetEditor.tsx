import type { ScanOffsetPoint } from '../../core/devices';
import { mergeScanOffsetTableBySpeed } from '../../core/devices';
import { numInputStyle, Row, unitStyle } from './device-settings-shared';
import { DraftNumberInput } from '../kit/DraftNumberInput';
import { useRef } from 'react';

type ScanOffsetEditorProps = {
  readonly value: ReadonlyArray<ScanOffsetPoint>;
  readonly maxOffsetMagnitudeMm: number;
  readonly onChange: (next: ReadonlyArray<ScanOffsetPoint>) => void;
};

export function ScanOffsetEditor(props: ScanOffsetEditorProps): JSX.Element {
  const points = mergeScanOffsetTableBySpeed(props.value);
  const keys = useRef(new Map<number, number>());
  const nextKey = useRef(0);
  keys.current = new Map(
    points.map((point) => [
      point.speedMmPerMin,
      keys.current.get(point.speedMmPerMin) ?? nextKey.current++,
    ]),
  );
  const changePoint = (index: number, patch: Partial<ScanOffsetPoint>): void => {
    // Preserve each row while a speed edit sorts it. Like the canonical merge,
    // later points win a duplicate speed, including the surviving row's key.
    keys.current = new Map(
      points.map((point, current) => [
        current === index ? (patch.speedMmPerMin ?? point.speedMmPerMin) : point.speedMmPerMin,
        keys.current.get(point.speedMmPerMin) ?? nextKey.current++,
      ]),
    );
    props.onChange(updatePoint(points, index, patch));
  };
  return (
    <Row label="Scan offset">
      <div
        style={editorStyle}
        title="Calibrated bidirectional scan compensation. Positive values shift reverse raster/fill sweeps along their travel direction. This only changes generated G-code; it does not write firmware."
      >
        <p style={conventionNoteStyle}>
          Stored values are LaserForge mm/min plus the full signed separation; reverse rows move and
          forward rows stay on design coordinates. A LightBurn Line Shift is half the pair gap, so
          double its signed magnitude here. LightBurn Initial Offset and .lbso import are not
          represented; Raster Diagnostics provides assisted conversion.
        </p>
        {points.length === 0 ? (
          <span style={emptyStyle}>No calibrated offsets</span>
        ) : (
          points.map((point, index) => (
            <ScanOffsetRow
              key={keys.current.get(point.speedMmPerMin)}
              point={point}
              index={index}
              maxOffsetMagnitudeMm={props.maxOffsetMagnitudeMm}
              onChange={(patch) => changePoint(index, patch)}
              onRemove={() => props.onChange(removePoint(points, index))}
            />
          ))
        )}
        <button
          type="button"
          title="Add a calibrated scan-offset speed point."
          onClick={() => props.onChange(addPoint(points))}
        >
          Add offset
        </button>
      </div>
    </Row>
  );
}

function ScanOffsetRow(props: {
  readonly point: ScanOffsetPoint;
  readonly index: number;
  readonly maxOffsetMagnitudeMm: number;
  readonly onChange: (patch: Partial<ScanOffsetPoint>) => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const rowNumber = props.index + 1;
  return (
    <div style={rowEditorStyle}>
      <DraftNumberInput
        min={1}
        step={100}
        value={props.point.speedMmPerMin}
        commitOnBlur
        normalize={(value) => (value > 0 ? value : props.point.speedMmPerMin)}
        onValueChange={(speedMmPerMin) => props.onChange({ speedMmPerMin })}
        style={speedInputStyle}
        aria-label={`Scan offset speed ${rowNumber}`}
        title="Engraving speed this calibration point applies to."
      />
      <span style={unitStyle}>mm/min</span>
      <DraftNumberInput
        min={-props.maxOffsetMagnitudeMm}
        max={props.maxOffsetMagnitudeMm}
        step={0.01}
        value={props.point.offsetMm}
        normalize={(value) =>
          Math.abs(value) <= props.maxOffsetMagnitudeMm ? value : props.point.offsetMm
        }
        onValueChange={(offsetMm) => props.onChange({ offsetMm })}
        style={numInputStyle}
        aria-label={`Scan offset value ${rowNumber}`}
        title="Offset in millimeters. Positive shifts reverse scanlines along their travel direction."
      />
      <span style={unitStyle}>mm</span>
      <button
        type="button"
        aria-label={`Remove scan offset ${rowNumber}`}
        title="Remove this calibrated scan-offset point."
        onPointerDown={(event) => {
          // Remove discards this row's draft. Do not first blur/reorder it out
          // from under the pointer before the click can reach the button.
          if (event.button === 0) event.preventDefault();
        }}
        onClick={props.onRemove}
      >
        Remove
      </button>
    </div>
  );
}

function addPoint(points: ReadonlyArray<ScanOffsetPoint>): ReadonlyArray<ScanOffsetPoint> {
  const last = points.length > 0 ? (points[points.length - 1]?.speedMmPerMin ?? 0) : 0;
  return mergeScanOffsetTableBySpeed([
    ...points,
    { speedMmPerMin: Math.max(3000, last + 3000), offsetMm: 0 },
  ]);
}

function updatePoint(
  points: ReadonlyArray<ScanOffsetPoint>,
  index: number,
  patch: Partial<ScanOffsetPoint>,
): ReadonlyArray<ScanOffsetPoint> {
  return mergeScanOffsetTableBySpeed(
    points.map((point, current) => (current === index ? { ...point, ...patch } : point)),
  );
}

function removePoint(
  points: ReadonlyArray<ScanOffsetPoint>,
  index: number,
): ReadonlyArray<ScanOffsetPoint> {
  return mergeScanOffsetTableBySpeed(points.filter((_, current) => current !== index));
}

const editorStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 4,
};
const rowEditorStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexWrap: 'wrap',
};
const speedInputStyle: React.CSSProperties = { width: 74 };
const emptyStyle: React.CSSProperties = {
  color: 'var(--lf-text-faint)',
  fontSize: 11,
};
const conventionNoteStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 11,
  lineHeight: 1.4,
};
