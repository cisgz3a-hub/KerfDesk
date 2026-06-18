import type { MaterialLibraryCalibrationContext as CalibrationContext } from '../state/material-library-calibration';
import {
  calibrationContextStyle,
  calibrationHeadingStyle,
  calibrationTextStyle,
} from './material-library-panel-styles';

export function MaterialLibraryCalibrationContext(props: {
  readonly context: CalibrationContext | null;
}): JSX.Element | null {
  if (props.context === null) return null;
  return (
    <div aria-label="Selected calibration swatch" style={calibrationContextStyle}>
      <strong style={calibrationHeadingStyle}>{contextTitle(props.context.kind)}</strong>
      <span style={calibrationTextStyle}>{contextSummary(props.context)}</span>
    </div>
  );
}

function contextTitle(kind: CalibrationContext['kind']): string {
  return kind === 'material-test' ? 'Material Test' : 'Interval Test';
}

function contextSummary(context: CalibrationContext): string {
  const common = [
    `Layer ${context.layer.color}`,
    `${formatNumber(context.recipe.speed)} mm/min`,
    `${formatNumber(context.recipe.power)}% power`,
  ];
  if (context.kind === 'interval-test') {
    common.push(`${formatNumber(context.recipe.hatchSpacingMm)} mm interval`);
  }
  return common.join(' | ');
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
