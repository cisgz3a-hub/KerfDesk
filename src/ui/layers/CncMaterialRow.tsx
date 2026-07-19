// CncMaterialRow — the beginner-facing "Material" picker on the CNC layer
// card (ADR-111 G-material). Picking a material auto-fills feed / plunge /
// depth-per-pass from the chipload chart using the layer's own bit and
// spindle, so a first-timer never types a feed rate — Easel's material-driven
// "it just works". Full flute/RPM control stays in the (advanced) Feeds
// calculator. CNC-only.

import { CHIPLOAD_MATERIALS, type ChiploadMaterial } from '../../core/cnc';
import {
  DEFAULT_ASSUMED_FLUTE_COUNT,
  findCncMachineStarter,
  findCncMachineStarterById,
} from '../../core/cnc/machine-starters';
import type { DeviceProfile } from '../../core/devices';
import { layerCncTool, type CncLayerSettings, type Layer } from '../../core/scene';
import { useStore } from '../state';
import { materialFeedsPatch } from '../state/cnc-project-material';
import { Row, selectStyle } from './CncLayerPrimitives';

const CUSTOM = '';
const SAVED_MACHINE_STARTER = '__saved-machine-starter__';

type StarterDisplay = {
  readonly optionLabel: string;
  readonly hint: string;
};

export function CncMaterialRow(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element | null {
  const machine = useStore((s) => s.project.machine);
  const profile = useStore((s) => s.project.device);
  const liveCaps = useStore((s) => s.cncLiveCaps);
  const { layer, settings, onCommitSettings } = props;
  if (machine?.kind !== 'cnc') return null;
  const tool = layerCncTool(machine, settings);
  const starterDisplay = machineStarterDisplay(settings, profile);

  const onChange = (value: string): void => {
    if (value === SAVED_MACHINE_STARTER) return;
    if (value === CUSTOM) {
      // Removing an optional key needs a whole-settings commit (spread can't
      // delete). Feeds stay whatever they were — only the label clears.
      const { materialKey: _material, feedSource: _source, ...rest } = settings;
      onCommitSettings(rest);
      return;
    }
    const material = value as ChiploadMaterial;
    const patch = materialFeedsPatch({
      materialKey: material,
      tool,
      spindleRpm: settings.spindleRpm,
      profile,
      machineSpindleMaxRpm: machine.params.spindleMaxRpm,
      liveCaps,
      fluteCount: DEFAULT_ASSUMED_FLUTE_COUNT,
    });
    if (patch !== null) onCommitSettings({ ...settings, ...patch });
  };

  return (
    <>
      <Row label="Material">
        <select
          value={starterDisplay === null ? (settings.materialKey ?? CUSTOM) : SAVED_MACHINE_STARTER}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`Material for ${layer.color}`}
          title="Pick a material to calculate starting feed, plunge, and depth-per-pass values for the layer's bit. Choose Manual to set them by hand."
          style={selectStyle}
        >
          {starterDisplay === null ? null : (
            <option value={SAVED_MACHINE_STARTER}>{starterDisplay.optionLabel}</option>
          )}
          <option value={CUSTOM}>Manual — verify feeds</option>
          {CHIPLOAD_MATERIALS.map((material) => (
            <option key={material.value} value={material.value}>
              {material.label}
            </option>
          ))}
        </select>
      </Row>
      <p style={hintStyle}>{materialHint(settings, tool.name, starterDisplay)}</p>
    </>
  );
}

function materialHint(
  settings: CncLayerSettings,
  toolName: string,
  starterDisplay: StarterDisplay | null,
): string {
  if (starterDisplay !== null) return starterDisplay.hint;
  if (settings.feedSource?.kind === 'material-recipe') {
    return `Automatic starting values calculated for ${toolName} with ${settings.feedSource.fluteCount} flutes and the active machine limits. Editing a value switches to Manual.`;
  }
  if (settings.materialKey !== undefined) {
    const label =
      CHIPLOAD_MATERIALS.find((material) => material.value === settings.materialKey)?.label ??
      settings.materialKey;
    return `Saved ${label} tag is legacy/unscoped. Its feeds are manual; choose Manual, then reselect the material to recalculate.`;
  }
  return 'Manual values are active. Verify them for this bit, stock, and machine before cutting.';
}

function machineStarterDisplay(
  settings: CncLayerSettings,
  profile: DeviceProfile,
): StarterDisplay | null {
  const source = settings.feedSource;
  if (source?.kind !== 'machine-starter') return null;
  const saved = findCncMachineStarterById(source.starterId);
  const identity = saved?.label ?? source.starterId;
  const operatorNotice =
    saved?.operatorNotice ??
    'Starter assumptions are unavailable; verify the cutter and values on this machine.';
  const active = findCncMachineStarter(profile)?.starter;
  const savedRevision = `revision ${source.revision}`;
  if (active?.id !== source.starterId) {
    const catalogNote = saved === null ? 'catalog entry unavailable; ' : '';
    return {
      optionLabel: `${identity} — ${savedRevision} (saved; profile mismatch)`,
      hint: `${operatorNotice} Saved machine starter ${identity} (${savedRevision}) does not match the active profile; ${catalogNote}values were preserved. Choose Manual or the actual material before cutting.`,
    };
  }
  if (active.revision !== source.revision) {
    return {
      optionLabel: `${identity} — saved ${savedRevision} (current revision ${active.revision})`,
      hint: `${operatorNotice} Saved ${identity} ${savedRevision} is outdated; the current catalog is revision ${active.revision}. Values were preserved. Choose Manual or the actual material before cutting.`,
    };
  }
  return {
    optionLabel: `${identity} — ${savedRevision} (engineering starter)`,
    hint: `${operatorNotice} ${identity} ${savedRevision} is active. Select the actual material to recalculate; editing a value switches to Manual.`,
  };
}

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  margin: '2px 0 4px 4px',
};
