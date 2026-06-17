import { useEffect, useMemo, useState } from 'react';
import type { DeviceProfile, ScanOffsetPoint } from '../../core/devices';
import { normalizeScanOffsetTable } from '../../core/devices';
import { useStore } from '../state';
import {
  buttonRowStyle,
  inlineLabelStyle,
  mutedStyle,
  numberInputStyle,
} from './MachineSetupStyles';

type DraftMeasurement = {
  readonly speed: string;
  readonly offset: string;
};

const DEFAULT_MEASUREMENT_SPEEDS = [1000, 2000, 3000, 4000, 5000] as const;

export function MeasuredScanOffsetApply(): JSX.Element {
  const device = useStore((s) => s.project.device);
  const updateDeviceProfile = useStore((s) => s.updateDeviceProfile);
  const profileRows = useMemo(() => rowsFromProfile(device), [device]);
  const [rows, setRows] = useState<ReadonlyArray<DraftMeasurement>>(profileRows);
  const measured = useMemo(() => measuredPoints(rows), [rows]);

  useEffect(() => {
    setRows(profileRows);
  }, [profileRows]);

  return (
    <div style={panelStyle}>
      <p style={mutedStyle}>
        Enter the offset that made each burned speed swatch line up. Blank rows are ignored.
      </p>
      <div style={measurementListStyle}>
        {rows.map((row, index) => (
          <MeasuredRow
            key={index}
            index={index}
            row={row}
            onChange={(patch) => setRows((current) => updateRow(current, index, patch))}
          />
        ))}
      </div>
      <div style={buttonRowStyle}>
        <button
          type="button"
          title="Add another speed point from the burned calibration pattern."
          onClick={() => setRows((current) => [...current, nextRow(current)])}
        >
          Add measurement
        </button>
        <button
          type="button"
          title="Reload the scan-offset values currently saved on the active profile."
          onClick={() => setRows(profileRows)}
        >
          Reset from profile
        </button>
        <button
          type="button"
          disabled={measured.length === 0}
          title="Save these measured offsets to the active machine profile."
          onClick={() => updateDeviceProfile({ scanningOffsets: measured })}
        >
          Apply measured offsets
        </button>
      </div>
      <p style={mutedStyle}>{summaryText(measured)}</p>
    </div>
  );
}

function MeasuredRow(props: {
  readonly index: number;
  readonly row: DraftMeasurement;
  readonly onChange: (patch: Partial<DraftMeasurement>) => void;
}): JSX.Element {
  const rowNumber = props.index + 1;
  return (
    <div style={measurementRowStyle}>
      <label style={inlineLabelStyle}>
        <span style={labelStyle}>Speed</span>
        <input
          type="number"
          min={1}
          step={100}
          value={props.row.speed}
          onChange={(event) => props.onChange({ speed: event.target.value })}
          style={speedInputStyle}
          aria-label={`Measured speed ${rowNumber}`}
          title="Speed label from the burned scan-offset calibration swatch."
        />
      </label>
      <label style={inlineLabelStyle}>
        <span style={labelStyle}>Offset</span>
        <input
          type="number"
          step={0.01}
          value={props.row.offset}
          onChange={(event) => props.onChange({ offset: event.target.value })}
          style={numberInputStyle}
          aria-label={`Measured offset ${rowNumber}`}
          title="Measured correction in millimeters for this speed."
        />
      </label>
      <span style={unitStyle}>mm/min, mm</span>
    </div>
  );
}

function rowsFromProfile(device: DeviceProfile): ReadonlyArray<DraftMeasurement> {
  const existing = normalizeScanOffsetTable(device.scanningOffsets);
  if (existing.length > 0) {
    return existing.map((point) => ({
      speed: String(point.speedMmPerMin),
      offset: String(point.offsetMm),
    }));
  }
  return defaultSpeeds(device.maxFeed).map((speed) => ({ speed: String(speed), offset: '' }));
}

function defaultSpeeds(maxFeed: number): ReadonlyArray<number> {
  const cappedMax = Number.isFinite(maxFeed) && maxFeed > 0 ? maxFeed : 5000;
  const speeds = DEFAULT_MEASUREMENT_SPEEDS.filter((speed) => speed <= cappedMax);
  if (speeds.length > 0) return speeds;
  return [Math.max(1, Math.round(cappedMax))];
}

function measuredPoints(rows: ReadonlyArray<DraftMeasurement>): ReadonlyArray<ScanOffsetPoint> {
  return normalizeScanOffsetTable(
    rows.map((row) => ({
      speedMmPerMin: numberFromInput(row.speed),
      offsetMm: numberFromInput(row.offset),
    })),
  );
}

function updateRow(
  rows: ReadonlyArray<DraftMeasurement>,
  index: number,
  patch: Partial<DraftMeasurement>,
): ReadonlyArray<DraftMeasurement> {
  return rows.map((row, current) => (current === index ? { ...row, ...patch } : row));
}

function nextRow(rows: ReadonlyArray<DraftMeasurement>): DraftMeasurement {
  const speeds = rows.map((row) => numberFromInput(row.speed)).filter(isFinitePositive);
  const nextSpeed = speeds.length === 0 ? 1000 : Math.max(...speeds) + 1000;
  return { speed: String(nextSpeed), offset: '' };
}

function summaryText(points: ReadonlyArray<ScanOffsetPoint>): string {
  if (points.length === 0) return 'Enter at least one measured offset to apply calibration.';
  return `${points.length} measured speed point(s) ready to apply.`;
}

function numberFromInput(value: string): number {
  if (value.trim() === '') return Number.NaN;
  return Number(value);
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const measurementListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const measurementRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};

const speedInputStyle: React.CSSProperties = { width: 84 };
const unitStyle: React.CSSProperties = { color: 'var(--lf-text-faint)', fontSize: 11 };
