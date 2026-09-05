import { useMemo } from 'react';
import type { GrblSettingRow } from '../../core/controllers/grbl';
import { effectiveScanOffsetCalibrationStatus } from '../../core/devices/scan-offset-profile';
import { LAYER_DEFAULTS, type Layer, type Project } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import {
  badgeStyle,
  cardStyle,
  definitionGridStyle,
  mutedStyle,
  notesStyle,
  sectionHeadingStyle,
  sectionStyle,
  stackStyle,
} from './MachineSetupStyles';
import {
  MeasuredScanOffsetApply,
  type ScanOffsetCalibrationDraft,
} from './MeasuredScanOffsetApply';
import {
  machineSetupFillHeatRisk,
  machineSetupFillHeatRiskWarning,
  type MachineSetupFillHeatRisk,
} from './machine-setup-fill-heat-risk';
import { buildMachineSetupScanFacts } from './machine-setup-scan-facts';
import { diagnosticChecks, type DiagnosticCheck } from './machine-setup-raster-diagnostic-checks';

export function RasterDiagnosticsPanel(props: {
  readonly draft?: ScanOffsetCalibrationDraft;
}): JSX.Element {
  const liveProject = useStore((s) => s.project);
  const project = props.draft?.project ?? liveProject;
  const rows = useLaserStore((s) => s.grblSettingsRows);
  const lastSettingsReadAt = useLaserStore((s) => s.lastSettingsReadAt);
  const diagnostics = useMemo(
    () => buildRasterDiagnostics(project, rows, lastSettingsReadAt),
    [project, rows, lastSettingsReadAt],
  );

  return (
    <div style={stackStyle}>
      <section style={sectionStyle}>
        <h3 style={sectionHeadingStyle}>Raster Diagnostics</h3>
        <dl style={definitionGridStyle}>
          <dt>Profile</dt>
          <dd>{project.device.name}</dd>
          <dt>Scan-offset calibration</dt>
          <dd>{diagnostics.scanOffsetSummary}</dd>
          <dt>Image layers</dt>
          <dd>{diagnostics.imageSummary}</dd>
          <dt>Fill layers</dt>
          <dd>{diagnostics.fillSummary}</dd>
          <dt>Scan direction</dt>
          <dd>{diagnostics.directionSummary}</dd>
          <dt>Overscan</dt>
          <dd>{diagnostics.overscanSummary}</dd>
          <dt>Recipe calibration</dt>
          <dd>{diagnostics.recipeSummary}</dd>
          <dt>Line interval</dt>
          <dd>{diagnostics.intervalSummary}</dd>
          <dt>$30 S max</dt>
          <dd>{diagnostics.sMaxSummary}</dd>
          <dt>$32 Laser mode</dt>
          <dd>{diagnostics.laserModeSummary}</dd>
        </dl>
      </section>

      <section style={sectionStyle}>
        <h3 style={sectionHeadingStyle}>Likely Causes</h3>
        {diagnostics.warnings.length === 0 ? (
          <p style={mutedStyle}>No raster calibration warnings for the current project.</p>
        ) : (
          <ul style={notesStyle}>
            {diagnostics.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </section>

      <section style={sectionStyle}>
        <h3 style={sectionHeadingStyle}>Isolation Checks</h3>
        <div style={checkGridStyle}>
          {diagnostics.checks.map((check) => (
            <article key={check.label} style={cardStyle}>
              <span style={badgeStyle}>{check.status}</span>
              <strong style={checkTitleStyle}>{check.label}</strong>
              <p style={mutedStyle}>{check.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={sectionStyle}>
        <h3 style={sectionHeadingStyle}>Measured Offsets</h3>
        <MeasuredScanOffsetApply draft={props.draft} />
      </section>
    </div>
  );
}

type RasterDiagnostics = {
  readonly scanOffsetSummary: string;
  readonly imageSummary: string;
  readonly fillSummary: string;
  readonly directionSummary: string;
  readonly overscanSummary: string;
  readonly recipeSummary: string;
  readonly intervalSummary: string;
  readonly sMaxSummary: string;
  readonly laserModeSummary: string;
  readonly warnings: ReadonlyArray<string>;
  readonly checks: ReadonlyArray<DiagnosticCheck>;
};

export function buildRasterDiagnostics(
  project: Project,
  rows: ReadonlyArray<GrblSettingRow>,
  lastSettingsReadAt: number | null,
): RasterDiagnostics {
  const scanFacts = buildMachineSetupScanFacts(project);
  const activeLayers = scanFacts.operationLayers;
  const imageLayers = activeLayers.filter((layer) => layer.mode === 'image');
  const fillLayers = activeLayers.filter((layer) => layer.mode === 'fill');
  const defaultRecipeLayers = activeLayers.filter(usesStarterRecipe);
  const defaultLineIntervalLayers = [...imageLayers, ...fillLayers].filter(usesStarterLineInterval);
  const sMax = settingSummary(rows, 30, lastSettingsReadAt);
  const laserMode = settingSummary(rows, 32, lastSettingsReadAt);
  const scanOffsetStatus = effectiveScanOffsetCalibrationStatus(project.device);
  const fillHeatRisk = machineSetupFillHeatRisk(project, fillLayers, scanFacts.compiledJob);
  const warnings = rasterWarnings({
    project,
    requestedBidirectionalOperations: scanFacts.requestedBidirectionalOperations,
    effectiveBidirectionalGroups: scanFacts.effectiveBidirectionalGroups,
    profileFallbackGroups: scanFacts.profileFallbackGroups,
    lowOverscanGroups: scanFacts.lowOverscanGroups,
    defaultRecipeLayers,
    defaultLineIntervalLayers,
    fillHeatRisk,
    laserMode,
    sMax,
  });

  return {
    scanOffsetSummary: scanOffsetSummary(project, scanOffsetStatus),
    imageSummary: `${imageLayers.length} requested output operation(s)`,
    fillSummary: `${fillLayers.length} requested output operation(s)`,
    directionSummary:
      scanFacts.effectiveBidirectionalGroups === null
        ? `${scanFacts.requestedBidirectionalOperations} requested bidirectional operation(s); effective groups are prepared in Job Review`
        : `${scanFacts.requestedBidirectionalOperations} requested bidirectional operation(s), ${scanFacts.effectiveBidirectionalGroups} executable bidirectional group(s), ${scanFacts.profileFallbackGroups ?? 0} profile fallback group(s)`,
    overscanSummary:
      scanFacts.lowOverscanGroups === null
        ? 'Effective overscan is prepared in Job Review for this large canvas'
        : `${scanFacts.lowOverscanGroups} executable bidirectional group(s) below 5%-of-speed calibration guidance`,
    recipeSummary: `Default recipe layers: ${defaultRecipeLayers.length}`,
    intervalSummary: `Default line intervals: ${defaultLineIntervalLayers.length}`,
    sMaxSummary: sMax.display,
    laserModeSummary: laserMode.display,
    warnings,
    checks: diagnosticChecks({
      project,
      requestedBidirectionalOperations: scanFacts.requestedBidirectionalOperations,
      effectiveBidirectionalGroups: scanFacts.effectiveBidirectionalGroups,
      profileFallbackGroups: scanFacts.profileFallbackGroups,
      lowOverscanGroups: scanFacts.lowOverscanGroups,
      defaultRecipeLayers,
      defaultLineIntervalLayers,
      fillHeatRisk,
      laserMode,
      sMax,
    }),
  };
}

function scanOffsetSummary(
  project: Project,
  status: ReturnType<typeof effectiveScanOffsetCalibrationStatus>,
): string {
  const count = project.device.scanningOffsets.length;
  switch (status) {
    case 'uncalibrated':
      return 'No scan-offset calibration';
    case 'pending':
      return `${count} saved speed point(s), verification pending`;
    case 'verified':
      return `${count} verified speed point(s)`;
    case 'legacy-verified':
      return `${count} legacy speed point(s), treated as verified`;
  }
}

function scanOffsetWarnings(
  project: Project,
  effectiveBidirectionalGroupCount: number | null,
  profileFallbackGroupCount: number | null,
  requestedBidirectionalOperationCount: number,
): ReadonlyArray<string> {
  const status = effectiveScanOffsetCalibrationStatus(project.device);
  if (status === 'legacy-verified') {
    return [
      'The scan-offset table is legacy/statusless: its source and verification burn were not recorded. It remains active; use the calibration panel to mark its truthful state.',
    ];
  }
  if (status === 'pending') {
    return [
      'The saved scan-offset table has no recorded verification burn. It remains available; inspect a verification coupon and mark its truthful state.',
    ];
  }
  if (effectiveBidirectionalGroupCount === null) {
    return requestedBidirectionalOperationCount > 0
      ? ['Effective scan direction for this large canvas is prepared in Job Review.']
      : [];
  }
  if ((profileFallbackGroupCount ?? 0) > 0) {
    return [
      `${profileFallbackGroupCount} executable scan group(s) requested bidirectional output but the active profile forced one-way until scan-offset verification.`,
    ];
  }
  if (effectiveBidirectionalGroupCount === 0) return [];
  if (status === 'uncalibrated') {
    return [
      'Bidirectional raster or fill is active without scan-offset calibration. This can show up as double or fat small text on one machine while another machine burns cleanly.',
    ];
  }
  return [];
}

function rasterWarnings(args: {
  readonly project: Project;
  readonly requestedBidirectionalOperations: number;
  readonly effectiveBidirectionalGroups: number | null;
  readonly profileFallbackGroups: number | null;
  readonly lowOverscanGroups: number | null;
  readonly defaultRecipeLayers: ReadonlyArray<Layer>;
  readonly defaultLineIntervalLayers: ReadonlyArray<Layer>;
  readonly fillHeatRisk: MachineSetupFillHeatRisk;
  readonly laserMode: SettingDiagnostic;
  readonly sMax: SettingDiagnostic;
}): ReadonlyArray<string> {
  const warnings = [
    ...scanOffsetWarnings(
      args.project,
      args.effectiveBidirectionalGroups,
      args.profileFallbackGroups,
      args.requestedBidirectionalOperations,
    ),
  ];
  if ((args.lowOverscanGroups ?? 0) > 0) {
    warnings.push(
      'Runway below the 5%-of-speed calibration reference may leave the head accelerating during burn moves; actual axis acceleration can require more.',
    );
  }
  const fillHeatWarning = machineSetupFillHeatRiskWarning(args.fillHeatRisk);
  if (fillHeatWarning !== null) warnings.push(fillHeatWarning);
  if (args.defaultRecipeLayers.length > 0) {
    warnings.push('Run Material Test on scrap before production.');
  }
  if (args.defaultLineIntervalLayers.length > 0) {
    warnings.push(
      'Run Interval Test on the same material before trusting fine raster or fill detail.',
    );
  }
  if (args.laserMode.value === 0) {
    warnings.push('Laser mode is off; GRBL $32 should normally be 1 for diode laser engraving.');
  }
  if (args.sMax.value !== null && args.sMax.value !== args.project.device.maxPowerS) {
    warnings.push(
      '$30 differs from the active profile S max. Power scaling may not match previews.',
    );
  }
  if (args.laserMode.kind === 'missing' || args.sMax.kind === 'missing') {
    warnings.push('Read controller settings to compare $30 and $32 against the active profile.');
  }
  return warnings;
}

function usesStarterRecipe(layer: Layer): boolean {
  return (
    layer.power === LAYER_DEFAULTS.power &&
    layer.speed === LAYER_DEFAULTS.speed &&
    layer.passes === LAYER_DEFAULTS.passes
  );
}

function usesStarterLineInterval(layer: Layer): boolean {
  if (layer.mode === 'image') return layer.linesPerMm === LAYER_DEFAULTS.linesPerMm;
  if (layer.mode === 'fill') return layer.hatchSpacingMm === LAYER_DEFAULTS.hatchSpacingMm;
  return false;
}

type SettingDiagnostic = {
  readonly kind: 'known' | 'missing';
  readonly display: string;
  readonly value: number | null;
};

function settingSummary(
  rows: ReadonlyArray<GrblSettingRow>,
  id: number,
  lastSettingsReadAt: number | null,
): SettingDiagnostic {
  const row = rows.find((candidate) => candidate.id === id);
  if (row === undefined || lastSettingsReadAt === null) {
    return { kind: 'missing', display: 'not read this session', value: null };
  }
  return {
    kind: 'known',
    display: `${row.code} ${row.name}: ${row.rawValue}`,
    value: row.numericValue,
  };
}

const checkGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: 10,
};

const checkTitleStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 6,
};
