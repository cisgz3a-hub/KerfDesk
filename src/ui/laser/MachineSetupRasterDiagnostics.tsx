import type { GrblSettingRow } from '../../core/controllers/grbl';
import type { Layer, Project } from '../../core/scene';
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
    </div>
  );
}

type RasterDiagnostics = {
  readonly scanOffsetSummary: string;
  readonly imageSummary: string;
  readonly fillSummary: string;
  readonly overscanSummary: string;
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
  const sMax = settingSummary(rows, 30, lastSettingsReadAt);
  const laserMode = settingSummary(rows, 32, lastSettingsReadAt);
  const warnings = rasterWarnings({
    project,
    bidirectionalLayers,
    lowOverscanLayers,
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
    sMaxSummary: sMax.display,
    laserModeSummary: laserMode.display,
    warnings,
    checks: diagnosticChecks({
      project,
      bidirectionalLayers,
      lowOverscanLayers,
      laserMode,
      sMax,
    }),
  };
}

function rasterWarnings(args: {
  readonly project: Project;
  readonly bidirectionalLayers: ReadonlyArray<Layer>;
  readonly lowOverscanLayers: ReadonlyArray<Layer>;
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
  readonly laserMode: SettingDiagnostic;
  readonly sMax: SettingDiagnostic;
}): ReadonlyArray<DiagnosticCheck> {
  return [
    {
      label: 'Bidirectional compensation',
      status:
        args.bidirectionalLayers.length > 0 && args.project.device.scanningOffsets.length === 0
          ? 'warn'
          : 'ok',
      detail:
        args.bidirectionalLayers.length > 0
          ? 'Disable bidirectional output for a test burn, then add calibrated scan offsets if the doubled letters disappear.'
          : 'No active bidirectional raster or fill layers were found.',
    },
    {
      label: 'Controller laser mode',
      status: args.laserMode.value === 0 || args.laserMode.kind === 'missing' ? 'warn' : 'ok',
      detail:
        args.laserMode.kind === 'missing'
          ? 'Read controller settings before trusting raster diagnostics.'
          : `Current controller readback is ${args.laserMode.display}.`,
    },
    {
      label: 'Head acceleration margin',
      status: args.lowOverscanLayers.length > 0 ? 'check' : 'ok',
      detail:
        args.lowOverscanLayers.length > 0
          ? 'Increase overscan on bidirectional raster or fill layers if edges look darker, stretched, or uneven.'
          : 'Active bidirectional layers have at least 2 mm overscan.',
    },
    {
      label: 'Mechanical focus and motion',
      status: 'check',
      detail:
        'If unidirectional output still doubles, inspect belt tension, pulley set screws, frame squareness, focus height, lens cleanliness, and workpiece hold-down.',
    },
  ];
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
