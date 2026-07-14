// CncMaterialRow — the beginner-facing "Material" picker on the CNC layer
// card (ADR-111 G-material). Picking a material auto-fills feed / plunge /
// depth-per-pass from the chipload chart using the layer's own bit and
// spindle, so a first-timer never types a feed rate — Easel's material-driven
// "it just works". Full flute/RPM control stays in the (advanced) Feeds
// calculator. CNC-only.

import { calculateFeeds, CHIPLOAD_MATERIALS, type ChiploadMaterial } from '../../core/cnc';
import { layerCncTool, type CncLayerSettings, type Layer } from '../../core/scene';
import { useStore } from '../state';
import { Row, selectStyle } from './CncLayerPrimitives';

// One-click fill assumes a 2-flute bit (the common hobby default); the Feeds
// calculator lets the user pick any flute count for a precise result.
const ASSUMED_FLUTES = 2;
const CUSTOM = '';

export function CncMaterialRow(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element | null {
  const machine = useStore((s) => s.project.machine);
  const maxFeed = useStore((s) => s.project.device.maxFeed);
  const { layer, settings, onCommit, onCommitSettings } = props;
  if (machine?.kind !== 'cnc') return null;
  const tool = layerCncTool(machine, settings);

  const onChange = (value: string): void => {
    if (value === CUSTOM) {
      // Removing an optional key needs a whole-settings commit (spread can't
      // delete). Feeds stay whatever they were — only the label clears.
      const { materialKey: _cleared, ...rest } = settings;
      onCommitSettings(rest);
      return;
    }
    const material = value as ChiploadMaterial;
    const result = calculateFeeds({
      material,
      bitDiameterMm: tool.diameterMm,
      flutes: ASSUMED_FLUTES,
      rpm: settings.spindleRpm,
      maxFeedMmPerMin: maxFeed,
    });
    if (result.kind === 'error') return;
    onCommit({
      materialKey: material,
      feedMmPerMin: result.feedMmPerMin,
      plungeMmPerMin: result.plungeMmPerMin,
      depthPerPassMm: result.depthPerPassMm,
    });
  };

  return (
    <>
      <Row label="Material">
        <select
          value={settings.materialKey ?? CUSTOM}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`Material for ${layer.color}`}
          title="Pick a material to calculate starting feed, plunge, and depth-per-pass values for the layer's bit. Choose Manual to set them by hand."
          style={selectStyle}
        >
          <option value={CUSTOM}>Manual — verify feeds</option>
          {CHIPLOAD_MATERIALS.map((material) => (
            <option key={material.value} value={material.value}>
              {material.label}
            </option>
          ))}
        </select>
      </Row>
      <p style={hintStyle}>
        {settings.materialKey !== undefined
          ? `Starting values calculated for ${tool.name}. Tune below, or use the Feeds calculator for flute count and RPM.`
          : 'Manual values are active. Verify them for this bit, stock, and machine before cutting.'}
      </p>
    </>
  );
}

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  margin: '2px 0 4px 4px',
};
