import { useMemo, type FormEvent } from 'react';
import { generateScanOffsetTestGrid } from '../../core/job';
import {
  normalizeRasterCalibration,
  type RasterCalibration,
  type RasterBidirectionalOffsetPoint,
} from '../../core/devices';
import { Button, Field, PanelHeading } from '../kit';
import { useStore } from '../state';

const DEFAULT_TEST_SPEEDS = [600, 1200, 1800] as const;
const DEFAULT_TEST_POWER = 12;

export function MachineCalibrationPanel(): JSX.Element {
  const device = useStore((s) => s.project.device);
  const updateDeviceProfile = useStore((s) => s.updateDeviceProfile);
  const replaceSceneWithGeneratedScene = useStore((s) => s.replaceSceneWithGeneratedScene);
  const calibration = device.rasterCalibration;
  const sortedPoints = useMemo(
    () =>
      [...calibration.bidirectionalOffsetPoints].sort((a, b) => a.speedMmPerMin - b.speedMmPerMin),
    [calibration.bidirectionalOffsetPoints],
  );
  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const speed = numberValue(form.get('speed'));
    const measuredSeparation = numberValue(form.get('measuredSeparation'));
    const initialXOffsetMm = numberValue(form.get('initialXOffset'));
    const offsetPoint = measuredPoint(speed, measuredSeparation);
    const nextPoints = upsertPoint(calibration.bidirectionalOffsetPoints, offsetPoint);
    updateDeviceProfile({
      rasterCalibration: normalizeRasterCalibration({
        ...calibration,
        enabled: true,
        source: 'calibration-test',
        initialXOffsetMm,
        bidirectionalOffsetPoints: nextPoints,
      }),
    });
  };
  const generateTestScene = (): void => {
    const grid = generateScanOffsetTestGrid({
      speeds: DEFAULT_TEST_SPEEDS,
      power: DEFAULT_TEST_POWER,
    });
    replaceSceneWithGeneratedScene(grid.scene);
  };

  return (
    <form style={panelStyle} onSubmit={handleSubmit}>
      <PanelHeading>Raster calibration</PanelHeading>
      <CalibrationStatus calibration={calibration} pointCount={sortedPoints.length} />
      <CalibrationFields initialXOffsetMm={calibration.initialXOffsetMm} />
      <CalibrationActions onGenerate={generateTestScene} />
      <CalibrationPointsTable points={sortedPoints} />
    </form>
  );
}

function CalibrationStatus(props: {
  readonly calibration: RasterCalibration;
  readonly pointCount: number;
}): JSX.Element {
  return (
    <div style={statusRowStyle}>
      <strong>{props.calibration.enabled ? 'Enabled' : 'Disabled'}</strong>
      <span>
        {props.pointCount === 0
          ? 'No scan-offset points saved'
          : `${props.pointCount} scan-offset point${props.pointCount === 1 ? '' : 's'} saved`}
      </span>
    </div>
  );
}

function CalibrationFields(props: { readonly initialXOffsetMm: number }): JSX.Element {
  return (
    <div style={fieldGridStyle}>
      <Field label="Speed">
        <input
          aria-label="Calibration speed"
          name="speed"
          type="number"
          min={1}
          step={1}
          defaultValue="1200"
          title="Speed used by the scan-offset calibration swatch."
        />
      </Field>
      <Field label="Separation">
        <input
          aria-label="Measured line separation"
          name="measuredSeparation"
          type="number"
          min={0}
          step={0.01}
          defaultValue="0"
          title="Measured distance between forward and reverse burn lines."
        />
      </Field>
      <Field label="Initial X">
        <input
          aria-label="Initial X offset"
          name="initialXOffset"
          type="number"
          step={0.01}
          defaultValue={String(props.initialXOffsetMm)}
          title="Base X offset applied to every raster scanline."
        />
      </Field>
    </div>
  );
}

function CalibrationActions(props: { readonly onGenerate: () => void }): JSX.Element {
  return (
    <div style={actionsStyle}>
      <Button type="button" onClick={props.onGenerate}>
        Generate scan offset test
      </Button>
      <Button type="submit" variant="primary">
        Save scan offset
      </Button>
    </div>
  );
}

function CalibrationPointsTable(props: {
  readonly points: ReadonlyArray<RasterBidirectionalOffsetPoint>;
}): JSX.Element | null {
  if (props.points.length === 0) return null;
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={cellStyle}>Speed</th>
          <th style={cellStyle}>Offset</th>
        </tr>
      </thead>
      <tbody>
        {props.points.map((point) => (
          <tr key={point.speedMmPerMin}>
            <td style={cellStyle}>{point.speedMmPerMin}</td>
            <td style={cellStyle}>{point.offsetMm.toFixed(3)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function measuredPoint(
  speedMmPerMin: number,
  measuredSeparationMm: number,
): RasterBidirectionalOffsetPoint {
  return {
    speedMmPerMin,
    offsetMm: measuredSeparationMm / 2,
  };
}

function upsertPoint(
  points: ReadonlyArray<RasterBidirectionalOffsetPoint>,
  next: RasterBidirectionalOffsetPoint,
): ReadonlyArray<RasterBidirectionalOffsetPoint> {
  return [...points.filter((point) => point.speedMmPerMin !== next.speedMmPerMin), next];
}

function numberValue(value: FormDataEntryValue | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const statusRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  color: 'var(--lf-text-muted)',
};

const fieldGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 10,
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
};

const tableStyle: React.CSSProperties = {
  borderCollapse: 'collapse',
  width: '100%',
  fontSize: 13,
};

const cellStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  padding: '6px 8px',
  textAlign: 'left',
};
