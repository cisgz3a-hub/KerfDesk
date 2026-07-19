import { useEffect, useMemo, useState } from 'react';
import type { DeviceProfile } from '../../core/devices';
import {
  effectiveScanOffsetCalibrationStatus,
  mergeScanOffsetTableBySpeed,
  scanOffsetMagnitudeLimitMm,
  type ScanOffsetPoint,
} from '../../core/devices/scan-offset-profile';
import { useStore } from '../state';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
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

type MeasurementValidation = {
  readonly points: ReadonlyArray<ScanOffsetPoint>;
  readonly errors: ReadonlyArray<string>;
};

const DEFAULT_MEASUREMENT_SPEEDS = [1000, 2000, 3000, 4000, 5000] as const;

export function MeasuredScanOffsetApply(): JSX.Element {
  const device = useStore((s) => s.project.device);
  const updateDeviceProfile = useStore((s) => s.updateDeviceProfile);
  const profileRows = useMemo(() => rowsFromProfile(device), [device]);
  const [rows, setRows] = useState<ReadonlyArray<DraftMeasurement>>(profileRows);
  const calibrationStatus = effectiveScanOffsetCalibrationStatus(device);
  const offsetLimitMm = scanOffsetMagnitudeLimitMm(device);
  const validation = useMemo(() => validateMeasuredScanOffsets(rows, device), [rows, device]);

  useEffect(() => {
    setRows(profileRows);
  }, [profileRows]);

  return (
    <div style={panelStyle}>
      <p style={mutedStyle}>
        From the uncorrected baseline coupon, enter the full signed forward-versus-reverse edge
        separation. Do not divide the measurement in half: KerfDesk keeps forward rows on the design
        coordinates and shifts reverse rows only. Positive moves reverse rows along their travel
        direction; negative moves them opposite. Blank offset rows are ignored.
      </p>
      <div style={measurementListStyle}>
        {rows.map((row, index) => (
          <MeasuredRow
            key={index}
            index={index}
            row={row}
            offsetLimitMm={offsetLimitMm}
            onChange={(patch) => setRows((current) => updateRow(current, index, patch))}
          />
        ))}
      </div>
      <MeasurementActions
        applyDisabled={validation.points.length === 0 || validation.errors.length > 0}
        onAdd={() => setRows((current) => [...current, nextRow(current)])}
        onReset={() => setRows(profileRows)}
        onApply={() =>
          updateDeviceProfile({
            scanningOffsets: validation.points,
            scanOffsetCalibrationStatus: 'pending',
          })
        }
      />
      {validation.points.length > 0 ? <CandidateTable points={validation.points} /> : null}
      {validation.errors.length > 0 ? (
        <ul role="alert" style={errorListStyle}>
          {validation.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
      <p style={mutedStyle}>{summaryText(validation)}</p>
      <CalibrationLifecycleStatus
        status={calibrationStatus}
        onMarkVerified={() => {
          if (
            jobAwareConfirm(
              'Mark this scan-offset table verified?\n\nOnly continue after burning and inspecting a corrected “Verify saved table” coupon on this machine. This enables bidirectional 4040 production jobs.',
            )
          ) {
            updateDeviceProfile({ scanOffsetCalibrationStatus: 'verified' });
          }
        }}
      />
      <p style={mutedStyle}>
        Safety limit: |offset| must be at most {offsetLimitMm} mm (1% of the shorter bed axis,
        capped at 5 mm).
      </p>
    </div>
  );
}

function MeasurementActions(props: {
  readonly applyDisabled: boolean;
  readonly onAdd: () => void;
  readonly onReset: () => void;
  readonly onApply: () => void;
}): JSX.Element {
  return (
    <div style={buttonRowStyle}>
      <button
        type="button"
        title="Add another speed point from the burned calibration pattern."
        onClick={props.onAdd}
      >
        Add measurement
      </button>
      <button
        type="button"
        title="Reload the scan-offset values currently saved on the active profile."
        onClick={props.onReset}
      >
        Reset from profile
      </button>
      <button
        type="button"
        disabled={props.applyDisabled}
        title="Save this candidate table; a corrected verification coupon is still required."
        onClick={props.onApply}
      >
        Apply measured offsets
      </button>
    </div>
  );
}

function CalibrationLifecycleStatus(props: {
  readonly status: ReturnType<typeof effectiveScanOffsetCalibrationStatus>;
  readonly onMarkVerified: () => void;
}): JSX.Element | null {
  if (props.status === 'uncalibrated') return null;
  if (props.status === 'pending') {
    return (
      <div role="status" style={verificationStyle}>
        Verification pending: the table is saved, but physical alignment is not proven. Normal 4040
        production jobs remain one-way. Generate “Verify saved table” from Scan Offset Test, inspect
        the burned coupon, then explicitly accept it.
        <div style={buttonRowStyle}>
          <button
            type="button"
            title="Confirm that the physical verification coupon passed and enable this table for bidirectional 4040 output."
            onClick={props.onMarkVerified}
          >
            Mark verification burn passed
          </button>
        </div>
      </div>
    );
  }
  return (
    <p role="status" style={verifiedStyle}>
      {props.status === 'verified'
        ? 'Verification burn passed: this saved table is approved for bidirectional 4040 output.'
        : 'Legacy calibrated table: treated as verified for backward compatibility.'}
    </p>
  );
}

function CandidateTable(props: { readonly points: ReadonlyArray<ScanOffsetPoint> }): JSX.Element {
  return (
    <table aria-label="Candidate scan-offset table" style={previewTableStyle}>
      <caption style={previewCaptionStyle}>Candidate reverse-row correction table</caption>
      <thead>
        <tr>
          <th scope="col">Speed</th>
          <th scope="col">Full signed separation</th>
        </tr>
      </thead>
      <tbody>
        {props.points.map((point) => (
          <tr key={point.speedMmPerMin}>
            <td>{point.speedMmPerMin} mm/min</td>
            <td>{formatSignedOffset(point.offsetMm)} mm</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MeasuredRow(props: {
  readonly index: number;
  readonly row: DraftMeasurement;
  readonly offsetLimitMm: number;
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
          min={-props.offsetLimitMm}
          max={props.offsetLimitMm}
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
  const existing = mergeScanOffsetTableBySpeed(device.scanningOffsets);
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

export function validateMeasuredScanOffsets(
  rows: ReadonlyArray<DraftMeasurement>,
  device: Pick<DeviceProfile, 'bedWidth' | 'bedHeight' | 'maxFeed'>,
): MeasurementValidation {
  const points: ScanOffsetPoint[] = [];
  const errors: string[] = [];
  const seenSpeeds = new Set<number>();
  const offsetLimitMm = scanOffsetMagnitudeLimitMm(device);
  rows.forEach((row, index) => {
    if (row.offset.trim() === '') return;
    const speed = numberFromInput(row.speed);
    const offset = numberFromInput(row.offset);
    const rowNumber = index + 1;
    if (!Number.isFinite(speed) || speed <= 0) {
      errors.push(`Measurement ${rowNumber}: speed must be a positive number.`);
      return;
    }
    if (speed > device.maxFeed) {
      errors.push(
        `Measurement ${rowNumber}: ${speed} mm/min exceeds the profile limit of ${device.maxFeed} mm/min.`,
      );
      return;
    }
    if (!Number.isFinite(offset)) {
      errors.push(`Measurement ${rowNumber}: offset must be a finite signed number.`);
      return;
    }
    if (Math.abs(offset) > offsetLimitMm) {
      errors.push(
        `Measurement ${rowNumber}: offset must be between -${offsetLimitMm} and ${offsetLimitMm} mm for this bed.`,
      );
      return;
    }
    if (seenSpeeds.has(speed)) {
      errors.push(`Measurement ${rowNumber}: speed ${speed} mm/min is duplicated.`);
      return;
    }
    seenSpeeds.add(speed);
    points.push({ speedMmPerMin: speed, offsetMm: offset });
  });
  return {
    points: [...points].sort((left, right) => left.speedMmPerMin - right.speedMmPerMin),
    errors,
  };
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

function summaryText(validation: MeasurementValidation): string {
  if (validation.errors.length > 0) return 'Correct the measurement errors before applying.';
  if (validation.points.length === 0)
    return 'Enter at least one measured offset to apply calibration.';
  return `${validation.points.length} measured speed point(s) ready to apply; verification will still be pending.`;
}

function formatSignedOffset(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
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
const errorListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  color: 'var(--lf-danger)',
  fontSize: 12,
};
const verificationStyle: React.CSSProperties = {
  margin: 0,
  padding: 8,
  border: '1px solid var(--lf-warning)',
  borderRadius: 6,
  color: 'var(--lf-warning)',
  fontSize: 12,
  lineHeight: 1.4,
};
const verifiedStyle: React.CSSProperties = {
  margin: 0,
  padding: 8,
  border: '1px solid var(--lf-success)',
  borderRadius: 6,
  color: 'var(--lf-success)',
  fontSize: 12,
  lineHeight: 1.4,
};
const previewTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 12,
  textAlign: 'left',
};
const previewCaptionStyle: React.CSSProperties = {
  textAlign: 'left',
  fontWeight: 600,
  marginBottom: 4,
};
