import type { GrblSettingRow } from '../../core/controllers/grbl';
import { LAYER_DEFAULTS, type Layer, type Project } from '../../core/scene';
import { layerFromSubLayer } from '../../core/scene';
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
import { MeasuredScanOffsetApply } from './MeasuredScanOffsetApply';

export function RasterDiagnosticsPanel(): JSX.Element {
  const project = useStore((s) => s.project);
  const rows = useLaserStore((s) => s.grblSettingsRows);
  const lastSettingsReadAt = useLaserStore((s) => s.lastSettingsReadAt);
  const diagnostics = buildRasterDiagnostics(project, rows, lastSettingsReadAt);

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
        <MeasuredScanOffsetApply />
      </section>
    </div>
  );
}

type RasterDiagnostics = {
  readonly scanOffsetSummary: string;
  readonly imageSummary: string;
  readonly fillSummary: string;
  readonly overscanSummary: string;
  readonly recipeSummary: string;
  readonly intervalSummary: string;
  readonly sMaxSummary: string;
  readonly laserModeSummary: string;
  readonly warnings: ReadonlyArray<string>;
  readonly checks: ReadonlyArray<DiagnosticCheck>;
};

type DiagnosticCheck = {
  readonly label: string;
  readonly status: 'check' | 'ok' | 'warn';
  readonly detail: string;
};

function buildRasterDiagnostics(
  project: Project,
  rows: ReadonlyArray<GrblSettingRow>,
  lastSettingsReadAt: number | null,
): RasterDiagnostics {
  const activeLayers = flattenOperationLayers(project).filter((layer) => layer.visible && layer.output);
  const imageLayers = activeLayers.filter((layer) => layer.mode === 'image');
  const fillLayers = activeLayers.filter((layer) => layer.mode === 'fill');
  const bidirectionalImageLayers = imageLayers.filter((layer) => layer.imageBidirectional);
  const bidirectionalFillLayers = fillLayers.filter(
    (layer) => layer.fillStyle === 'scanline' && layer.fillBidirectional,
  );
  const bidirectionalLayers = [...bidirectionalImageLayers, ...bidirectionalFillLayers];
  const lowOverscanLayers = bidirectionalLayers.filter((layer) => layer.fillOverscanMm < 2);
  const defaultRecipeLayers = activeLayers.filter(usesStarterRecipe);
  const defaultLineIntervalLayers = [...imageLayers, ...fillLayers].filter(usesStarterLineInterval);
  const sMax = settingSummary(rows, 30, lastSettingsReadAt);
  const laserMode = settingSummary(rows, 32, lastSettingsReadAt);
  const warnings = rasterWarnings({
    project,
    bidirectionalLayers,
    lowOverscanLayers,
    defaultRecipeLayers,
    defaultLineIntervalLayers,
    laserMode,
    sMax,
  });

  return {
    scanOffsetSummary:
      project.device.scanningOffsets.length === 0
        ? 'No scan-offset calibration'
        : `${project.device.scanningOffsets.length} calibrated speed point(s)`,
    imageSummary: `${imageLayers.length} active, Bidirectional image layers: ${bidirectionalImageLayers.length}`,
    fillSummary: `${fillLayers.length} active, Bidirectional fill layers: ${bidirectionalFillLayers.length}`,
    overscanSummary: `Low overscan layers: ${lowOverscanLayers.length}`,
    recipeSummary: `Default recipe layers: ${defaultRecipeLayers.length}`,
    intervalSummary: `Default line intervals: ${defaultLineIntervalLayers.length}`,
    sMaxSummary: sMax.display,
    laserModeSummary: laserMode.display,
    warnings,
    checks: diagnosticChecks({
      project,
      bidirectionalLayers,
      lowOverscanLayers,
      defaultRecipeLayers,
      defaultLineIntervalLayers,
      laserMode,
      sMax,
    }),
  };
}

function rasterWarnings(args: {
  readonly project: Project;
  readonly bidirectionalLayers: ReadonlyArray<Layer>;
  readonly lowOverscanLayers: ReadonlyArray<Layer>;
  readonly defaultRecipeLayers: ReadonlyArray<Layer>;
  readonly defaultLineIntervalLayers: ReadonlyArray<Layer>;
  readonly laserMode: SettingDiagnostic;
  readonly sMax: SettingDiagnostic;
}): ReadonlyArray<string> {
  const warnings: string[] = [];
  if (args.bidirectionalLayers.length > 0 && args.project.device.scanningOffsets.length === 0) {
    warnings.push(
      'Bidirectional raster or fill is active without scan-offset calibration. This can show up as double or fat small text on one machine while another machine burns cleanly.',
    );
  }
  if (args.lowOverscanLayers.length > 0) {
    warnings.push('Low overscan layers may leave the head accelerating during burn moves.');
  }
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
    warnings.push('$30 differs from the active profile S max. Power scaling may not match previews.');
  }
  if (args.laserMode.kind === 'missing' || args.sMax.kind === 'missing') {
    warnings.push('Read controller settings to compare $30 and $32 against the active profile.');
  }
  return warnings;
}

function diagnosticChecks(args: {
  readonly project: Project;
  readonly bidirectionalLayers: ReadonlyArray<Layer>;
  readonly lowOverscanLayers: ReadonlyArray<Layer>;
  readonly defaultRecipeLayers: ReadonlyArray<Layer>;
  readonly defaultLineIntervalLayers: ReadonlyArray<Layer>;
  readonly laserMode: SettingDiagnostic;
  readonly sMax: SettingDiagnostic;
}): ReadonlyArray<DiagnosticCheck> {
  return [
    bidirectionalCheck(args),
    controllerLaserModeCheck(args.laserMode),
    accelerationMarginCheck(args.lowOverscanLayers),
    materialRecipeCheck(args.defaultRecipeLayers),
    lineIntervalCheck(args.defaultLineIntervalLayers),
    mechanicalFocusCheck(),
  ];
}

function bidirectionalCheck(args: {
  readonly project: Project;
  readonly bidirectionalLayers: ReadonlyArray<Layer>;
}): DiagnosticCheck {
  const missingOffsets =
    args.bidirectionalLayers.length > 0 && args.project.device.scanningOffsets.length === 0;
  return {
    label: 'Bidirectional compensation',
    status: missingOffsets ? 'warn' : 'ok',
    detail:
      args.bidirectionalLayers.length > 0
        ? 'Disable bidirectional output for a test burn, then add calibrated scan offsets if the doubled letters disappear.'
        : 'No active bidirectional raster or fill layers were found.',
  };
}

function controllerLaserModeCheck(laserMode: SettingDiagnostic): DiagnosticCheck {
  return {
    label: 'Controller laser mode',
    status: laserMode.value === 0 || laserMode.kind === 'missing' ? 'warn' : 'ok',
    detail:
      laserMode.kind === 'missing'
        ? 'Read controller settings before trusting raster diagnostics.'
        : `Current controller readback is ${laserMode.display}.`,
  };
}

function accelerationMarginCheck(lowOverscanLayers: ReadonlyArray<Layer>): DiagnosticCheck {
  return {
    label: 'Head acceleration margin',
    status: lowOverscanLayers.length > 0 ? 'check' : 'ok',
    detail:
      lowOverscanLayers.length > 0
        ? 'Increase overscan on bidirectional raster or fill layers if edges look darker, stretched, or uneven.'
        : 'Active bidirectional layers have at least 2 mm overscan.',
  };
}

function materialRecipeCheck(defaultRecipeLayers: ReadonlyArray<Layer>): DiagnosticCheck {
  return {
    label: 'Material recipe',
    status: defaultRecipeLayers.length > 0 ? 'check' : 'ok',
    detail:
      defaultRecipeLayers.length > 0
        ? 'Burn a Material Test on scrap and copy the winning speed, power, and passes into the output layer.'
        : 'Active output layers have moved away from first-run starter settings.',
  };
}

function lineIntervalCheck(defaultLineIntervalLayers: ReadonlyArray<Layer>): DiagnosticCheck {
  return {
    label: 'Line interval',
    status: defaultLineIntervalLayers.length > 0 ? 'check' : 'ok',
    detail:
      defaultLineIntervalLayers.length > 0
        ? 'Use Interval Test to tune hatch spacing or image lines/mm for this material and focus height.'
        : 'Active raster/fill layers are not using the default line interval.',
  };
}

function mechanicalFocusCheck(): DiagnosticCheck {
  return {
    label: 'Mechanical focus and motion',
    status: 'check',
    detail:
      'If unidirectional output still doubles, inspect belt tension, pulley set screws, frame squareness, focus height, lens cleanliness, and workpiece hold-down.',
  };
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
  return { kind: 'known', display: `${row.code} ${row.name}: ${row.rawValue}`, value: row.numericValue };
}

function flattenOperationLayers(project: Project): ReadonlyArray<Layer> {
  return project.scene.layers.flatMap((layer) => [
    layer,
    ...layer.subLayers.map((subLayer) => layerFromSubLayer(layer, subLayer)),
  ]);
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
