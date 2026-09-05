import type {
  ScanOffsetMeasurementConvention,
  ScanOffsetSpeedUnit,
} from '../../core/devices/scan-offset-measurement-format';
import type { ScanOffsetMeasurementFormat } from './scan-offset-measurement-draft';

export function ScanOffsetMeasurementFormatControls(props: {
  readonly format: ScanOffsetMeasurementFormat;
  readonly onChange: (format: ScanOffsetMeasurementFormat) => void;
}): JSX.Element {
  const isLightBurn = props.format.convention === 'lightburn-half-both-directions';
  return (
    <div style={controlsStyle}>
      <label style={labelStyle}>
        Input convention
        <select
          aria-label="Scan-offset input convention"
          title="Choose how the measured scan-line gap is represented"
          value={props.format.convention}
          onChange={(event) =>
            props.onChange({ ...props.format, convention: conventionFromValue(event.target.value) })
          }
        >
          <option value="laserforge-full-reverse-only">
            LaserForge full gap — reverse rows only
          </option>
          <option value="lightburn-half-both-directions">LightBurn Line Shift — half gap</option>
        </select>
      </label>
      <label style={labelStyle}>
        Speed unit
        <select
          aria-label="Scan-offset speed unit"
          title="Choose the speed unit used by the measurement table"
          value={props.format.speedUnit}
          onChange={(event) =>
            props.onChange({ ...props.format, speedUnit: speedUnitFromValue(event.target.value) })
          }
        >
          <option value="mm-per-minute">mm/min</option>
          <option value="mm-per-second">mm/s</option>
        </select>
      </label>
      <p style={explanationStyle}>
        {isLightBurn
          ? 'LightBurn moves both scan directions by its Line Shift, so LaserForge saves twice that signed magnitude and keeps forward rows anchored. Speed values entered as mm/s are multiplied by 60.'
          : 'LaserForge saves the full signed forward-versus-reverse separation in mm. Do not divide the measurement in half: it shifts reverse rows only, while forward rows remain on design coordinates.'}
      </p>
      {isLightBurn ? (
        <p role="note" style={limitationStyle}>
          Pair-alignment magnitude is converted, but correction sign and absolute placement still
          require a LaserForge coupon. LightBurn Initial Offset and .lbso import are not
          represented, so also verify raster-to-vector placement.
        </p>
      ) : null}
    </div>
  );
}

function conventionFromValue(value: string): ScanOffsetMeasurementConvention {
  return value === 'lightburn-half-both-directions'
    ? 'lightburn-half-both-directions'
    : 'laserforge-full-reverse-only';
}

function speedUnitFromValue(value: string): ScanOffsetSpeedUnit {
  return value === 'mm-per-second' ? 'mm-per-second' : 'mm-per-minute';
}

const controlsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};
const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
};
const explanationStyle: React.CSSProperties = { flexBasis: '100%', margin: 0, fontSize: 12 };
const limitationStyle: React.CSSProperties = {
  flexBasis: '100%',
  margin: 0,
  color: 'var(--lf-warning)',
  fontSize: 12,
};
