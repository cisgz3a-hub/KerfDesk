// Text for the Material Test results view (ADR-381): axis captions, header
// values and a one-line summary of what a cell burned with.

import {
  formatMaterialTestInterval,
  type MaterialTestParameter,
} from '../../core/job/material-test-axes';
import {
  materialTestSettingValue,
  type MaterialTestCellResult,
  type MaterialTestResult,
} from '../../core/job/material-test-cells';
import type { LayerOperationSettings } from '../../core/scene';

export const PARAMETER_CAPTIONS: Readonly<Record<MaterialTestParameter, string>> = {
  power: 'Power (%)',
  speed: 'Speed (mm/min)',
  interval: 'Interval (mm)',
  passes: 'Passes',
};

export function axisCaption(parameter: MaterialTestParameter | null): string {
  return parameter === null ? 'No change' : PARAMETER_CAPTIONS[parameter];
}

/** Header text for one row or column: its value, as the burned labels show it. */
export function axisValueText(
  parameter: MaterialTestParameter | null,
  burned: LayerOperationSettings | undefined,
  index: number,
): string {
  const value =
    parameter === null || burned === undefined
      ? undefined
      : materialTestSettingValue(burned, parameter);
  if (parameter === null || value === undefined) return String(index + 1);
  return parameter === 'interval' ? formatMaterialTestInterval(value) : formatNumber(value);
}

export function cellName(test: MaterialTestResult, cell: MaterialTestCellResult): string {
  return `${test.name}, row ${cell.row + 1}, column ${cell.column + 1}`;
}

export function settingsSummary(settings: LayerOperationSettings): string {
  const parts = [
    modeName(settings.mode),
    `${formatNumber(settings.power)}%`,
    `${formatNumber(settings.speed)} mm/min`,
    `${settings.passes} ${settings.passes === 1 ? 'pass' : 'passes'}`,
  ];
  const interval = materialTestSettingValue(settings, 'interval');
  if (interval !== undefined) parts.push(`${formatMaterialTestInterval(interval)} mm interval`);
  parts.push(settings.airAssist ? 'air on' : 'air off');
  return parts.join(' · ');
}

export function modeName(mode: LayerOperationSettings['mode']): string {
  if (mode === 'line') return 'Line';
  if (mode === 'fill') return 'Fill';
  return 'Image';
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
}
