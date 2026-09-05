import { type DeviceProfile, type ScanOffsetPoint } from '../../core/devices';
import { scanOffsetMeasurementFromLaserForge } from '../../core/devices/scan-offset-measurement-format';
import {
  effectiveScanOffsetCalibrationStatus,
  scanOffsetMagnitudeLimitMm,
} from '../../core/devices/scan-offset-profile';
import { useStore } from '../state';
import type { Project } from '../../core/scene';
import {
  buttonRowStyle,
  inlineLabelStyle,
  mutedStyle,
  numberInputStyle,
} from './MachineSetupStyles';
import { ScanOffsetMeasurementFormatControls } from './ScanOffsetMeasurementFormatControls';
import { ScanOffsetOverrideNotice } from './ScanOffsetOverrideNotice';
import { useMeasuredScanOffsetDraft } from './use-measured-scan-offset-draft';
import {
  nextDraftScanOffsetRow,
  rowsFromScanOffsetProfile,
  type DraftScanOffsetMeasurement,
  type ScanOffsetMeasurementFormat,
  type ScanOffsetMeasurementValidation,
} from './scan-offset-measurement-draft';

export type ScanOffsetCalibrationDraft = {
  readonly project: Project;
  readonly onChange: (patch: Partial<DeviceProfile>) => void;
};

export function MeasuredScanOffsetApply(props: {
  readonly draft?: ScanOffsetCalibrationDraft | undefined;
}): JSX.Element {
  const liveProject = useStore((s) => s.project);
  const liveUpdate = useStore((s) => s.updateDeviceProfile);
  const documentEpoch = useStore((s) => s.projectDocumentEpoch);
  const project = props.draft?.project ?? liveProject;
  const device = project.device;
  const updateDeviceProfile = props.draft?.onChange ?? liveUpdate;
  const { format, rows, setRows, validation, handleFormatChange } = useMeasuredScanOffsetDraft(
    device,
    documentEpoch,
  );
  const calibrationStatus = effectiveScanOffsetCalibrationStatus(device);
  const offsetLimitMm = scanOffsetMagnitudeLimitMm(device);
  const inputOffsetLimitMm = scanOffsetMeasurementFromLaserForge(offsetLimitMm, format.convention);

  return (
    <div style={panelStyle}>
      <ScanOffsetMeasurementFormatControls format={format} onChange={handleFormatChange} />
      <p style={mutedStyle}>
        Sign is preserved from the selected source convention. Positive moves reverse rows along
        their travel direction; negative moves them opposite. Blank offset rows are ignored.
      </p>
      <ScanOffsetOverrideNotice project={project} />
      <div style={measurementListStyle}>
        {rows.map((row, index) => (
          <MeasuredRow
            key={index}
            index={index}
            row={row}
            format={format}
            offsetLimitMm={inputOffsetLimitMm}
            onChange={(patch) => setRows((current) => updateRow(current, index, patch))}
          />
        ))}
      </div>
      <MeasurementActions
        applyDisabled={validation.points.length === 0 || validation.errors.length > 0}
        onAdd={() => setRows((current) => [...current, nextDraftScanOffsetRow(current, format)])}
        onReset={() => setRows(rowsFromScanOffsetProfile(device, format))}
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
        onMarkPending={() => updateDeviceProfile({ scanOffsetCalibrationStatus: 'pending' })}
        onMarkVerified={() => updateDeviceProfile({ scanOffsetCalibrationStatus: 'verified' })}
      />
      <p style={mutedStyle}>
        Saved LaserForge safety limit: |offset| must be at most {offsetLimitMm} mm (1% of the
        shorter bed axis, capped at 5 mm).
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
  readonly onMarkPending: () => void;
  readonly onMarkVerified: () => void;
}): JSX.Element | null {
  if (props.status === 'uncalibrated') return null;
  if (props.status === 'pending') {
    return (
      <div role="status" style={verificationStyle}>
        Verification pending: the table is saved, but physical alignment is not proven. Generate
        “Verify saved table” from Scan Offset Test, inspect the burned coupon, then explicitly mark
        it verified. The table remains available; this warning does not disable output.
        <div style={buttonRowStyle}>
          <button
            type="button"
            title="Record that the physical verification coupon passed. This is provenance, not an output gate."
            onClick={props.onMarkVerified}
          >
            Mark verified
          </button>
        </div>
      </div>
    );
  }
  const legacy = props.status === 'legacy-verified';
  return (
    <div role="status" style={legacy ? verificationStyle : verifiedStyle}>
      {legacy
        ? 'Legacy/statusless table: its source and verification burn were not recorded. It remains active for compatibility; review the values and record the truthful state.'
        : 'Verification recorded: this saved table is marked verified for this profile.'}
      <div style={buttonRowStyle}>
        <button
          type="button"
          title="Record that this table still needs a physical verification coupon. The table remains available."
          onClick={props.onMarkPending}
        >
          Mark pending
        </button>
        {legacy ? (
          <button
            type="button"
            title="Record that the physical verification coupon passed. This is provenance, not an output gate."
            onClick={props.onMarkVerified}
          >
            Mark verified
          </button>
        ) : null}
      </div>
    </div>
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
  readonly row: DraftScanOffsetMeasurement;
  readonly format: ScanOffsetMeasurementFormat;
  readonly offsetLimitMm: number;
  readonly onChange: (patch: Partial<DraftScanOffsetMeasurement>) => void;
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
      <span style={unitStyle}>
        {props.format.speedUnit === 'mm-per-second' ? 'mm/s' : 'mm/min'}, mm
      </span>
    </div>
  );
}

function updateRow(
  rows: ReadonlyArray<DraftScanOffsetMeasurement>,
  index: number,
  patch: Partial<DraftScanOffsetMeasurement>,
): ReadonlyArray<DraftScanOffsetMeasurement> {
  return rows.map((row, current) => {
    if (current !== index) return row;
    const next = { ...row, ...patch };
    if (patch.speed !== undefined) delete next.canonicalSpeedMmPerMin;
    if (patch.offset !== undefined) delete next.canonicalOffsetMm;
    return next;
  });
}

function summaryText(validation: ScanOffsetMeasurementValidation): string {
  if (validation.errors.length > 0) return 'Correct the measurement errors before applying.';
  if (validation.points.length === 0)
    return 'Enter at least one measured offset to apply calibration.';
  return `${validation.points.length} measured speed point(s) ready to apply; verification will still be pending.`;
}

function formatSignedOffset(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
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
