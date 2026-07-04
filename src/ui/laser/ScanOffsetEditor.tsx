import type { ScanOffsetPoint } from '../../core/devices';
import { mergeScanOffsetTableBySpeed } from '../../core/devices';
import { numInputStyle, Row, unitStyle } from './device-settings-shared';

type ScanOffsetEditorProps = {
  readonly value: ReadonlyArray<ScanOffsetPoint>;
  readonly onChange: (next: ReadonlyArray<ScanOffsetPoint>) => void;
};

export function ScanOffsetEditor(props: ScanOffsetEditorProps): JSX.Element {
  const points = mergeScanOffsetTableBySpeed(props.value);
  return (
    <Row label="Scan offset">
      <div
        style={editorStyle}
        title="Calibrated bidirectional scan compensation. Positive values shift reverse raster/fill sweeps along their travel direction. This only changes generated G-code; it does not write firmware."
      >
        {points.length === 0 ? (
          <span style={emptyStyle}>No calibrated offsets</span>
        ) : (
          points.map((point, index) => (
            <ScanOffsetRow
              key={`${point.speedMmPerMin}:${index}`}
              point={point}
              index={index}
              onChange={(patch) => props.onChange(updatePoint(points, index, patch))}
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
  readonly onChange: (patch: Partial<ScanOffsetPoint>) => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const rowNumber = props.index + 1;
  return (
    <div style={rowEditorStyle}>
      <input
        type="number"
        min={1}
        step={100}
        value={props.point.speedMmPerMin}
        onChange={(event) =>
          props.onChange({
            speedMmPerMin: parsePositiveFinite(event.target.value, props.point.speedMmPerMin),
          })
        }
        style={speedInputStyle}
        aria-label={`Scan offset speed ${rowNumber}`}
        title="Engraving speed this calibration point applies to."
      />
      <span style={unitStyle}>mm/min</span>
      <input
        type="number"
        step={0.01}
        value={props.point.offsetMm}
        onChange={(event) =>
          props.onChange({ offsetMm: parseFinite(event.target.value, props.point.offsetMm) })
        }
        style={numInputStyle}
        aria-label={`Scan offset value ${rowNumber}`}
        title="Offset in millimeters. Positive shifts reverse scanlines along their travel direction."
      />
      <span style={unitStyle}>mm</span>
      <button
        type="button"
        aria-label={`Remove scan offset ${rowNumber}`}
        title="Remove this calibrated scan-offset point."
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

function parsePositiveFinite(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFinite(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
