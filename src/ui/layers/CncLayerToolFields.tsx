// Per-layer bit selectors (Phase H.7 multi-tool). LayerBitSelect assigns
// the bit a layer cuts with (default = the machine's active bit);
// VClearToolSelect arms the two-stage v-carve's flat-floor clearing bit.
// Split from CncLayerFields.tsx, which sits near the file-size cap.

import { useState } from 'react';
import {
  DEFAULT_CNC_TOOLS,
  type CncLayerSettings,
  type CncTool,
  type Layer,
} from '../../core/scene';
import { useStore } from '../state';
import { feedPresetPatch } from '../state/cnc-library-actions';

export function useCncTools(): ReadonlyArray<CncTool> {
  return useStore((s) =>
    s.project.machine?.kind === 'cnc' ? s.project.machine.tools : DEFAULT_CNC_TOOLS,
  );
}

// Relief roughing (H.5) reads depth-per-pass + stepover from the layer but
// takes total depth from the relief object — CncLayerFields keys its
// honest-card hints on this (handoff §7.C contract fix).
export function useLayerHasReliefObjects(color: string): boolean {
  return useStore((s) =>
    s.project.scene.objects.some((o) => o.kind === 'relief' && o.color === color),
  );
}

export function LayerBitSelect(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  const tools = useCncTools();
  return (
    <Row label="Bit">
      <select
        value={props.settings.toolId ?? ''}
        onChange={(e) => {
          if (e.target.value === '') {
            // Clearing the override removes the key (exact optional field).
            const { toolId: _removed, ...rest } = props.settings;
            props.onCommitSettings(rest);
          } else {
            props.onCommit({ toolId: e.target.value });
          }
        }}
        aria-label={`Bit for ${props.layer.color}`}
        title="Which bit cuts this layer. Layers with different bits become a multi-bit job with M0 tool-change pauses."
        style={selectStyle}
      >
        <option value="">Machine bit (active)</option>
        {tools.map((tool) => (
          <option key={tool.id} value={tool.id}>
            {tool.name}
          </option>
        ))}
      </select>
    </Row>
  );
}

export function VClearToolSelect(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  const tools = useCncTools();
  const flatTools = tools.filter((tool) => tool.kind !== 'v-bit');
  return (
    <Row label="Clear floors">
      <select
        value={props.settings.vClearToolId ?? ''}
        onChange={(e) => {
          if (e.target.value === '') {
            const { vClearToolId: _removed, ...rest } = props.settings;
            props.onCommitSettings(rest);
          } else {
            props.onCommit({ vClearToolId: e.target.value });
          }
        }}
        aria-label={`Clearing bit for ${props.layer.color}`}
        title="Two-stage v-carve: pocket the flat floors (regions wider than the v-bit reaches) with this bit first, then run the v-bit."
        style={selectStyle}
      >
        <option value="">Single stage (v-bit only)</option>
        {flatTools.map((tool) => (
          <option key={tool.id} value={tool.id}>
            {tool.name}
          </option>
        ))}
      </select>
    </Row>
  );
}

// The relief block for layers carrying relief objects: the honest-card
// hint (which fields drive roughing) plus the H.8 finishing controls.
export function ReliefLayerRows(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  return (
    <>
      <div style={reliefHintStyle}>
        Reliefs on this layer rough with Depth/pass + Stepover; total depth comes from the
        relief&apos;s own Depth (select the relief to edit it). Cut depth applies to the other
        shapes only.
      </div>
      <ReliefFinishRow
        layer={props.layer}
        settings={props.settings}
        onCommit={props.onCommit}
        onCommitSettings={props.onCommitSettings}
      />
    </>
  );
}

// Relief finishing controls (H.8): the skim bit + scallop target. Rendered
// only for layers that carry relief objects.
function ReliefFinishRow(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  const tools = useCncTools();
  return (
    <Row label="Finish with">
      <select
        value={props.settings.reliefFinishToolId ?? ''}
        onChange={(e) => {
          if (e.target.value === '') {
            const { reliefFinishToolId: _removed, ...rest } = props.settings;
            props.onCommitSettings(rest);
          } else {
            props.onCommit({ reliefFinishToolId: e.target.value });
          }
        }}
        aria-label={`Relief finishing bit for ${props.layer.color}`}
        title="H.8 finishing: after roughing, skim the true surface with this bit (ball nose recommended). None = roughing only."
        style={selectStyle}
      >
        <option value="">Roughing only</option>
        {tools.map((tool) => (
          <option key={tool.id} value={tool.id}>
            {tool.name}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={0.005}
        max={1}
        step={0.005}
        value={props.settings.reliefScallopMm ?? 0.025}
        onChange={(e) => {
          const parsed = Number.parseFloat(e.target.value);
          if (Number.isFinite(parsed) && parsed > 0) {
            props.onCommit({ reliefScallopMm: parsed });
          }
        }}
        aria-label={`Relief scallop height for ${props.layer.color}`}
        title="Scallop height target (mm) — smaller = finer finishing rows, longer job."
        style={scallopInputStyle}
      />
    </Row>
  );
}

// Feeds/speeds presets (H.7, F-CNC12): apply-on-select patches the layer's
// feed/plunge/spindle/depth-per-pass/stepover; Save snapshots the current
// values under a name into the app-level library.
export function FeedPresetRow(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  const presets = useStore((s) => s.cncLibrary.feedPresets);
  const saveCncFeedPreset = useStore((s) => s.saveCncFeedPreset);
  const [saveName, setSaveName] = useState('');
  return (
    <Row label="Feeds preset">
      <select
        value=""
        onChange={(e) => {
          const preset = presets.find((candidate) => candidate.id === e.target.value);
          if (preset !== undefined) props.onCommit(feedPresetPatch(preset));
        }}
        aria-label={`Feeds preset for ${props.layer.color}`}
        title="Apply a saved feeds/speeds preset to this layer."
        style={selectStyle}
      >
        <option value="">Apply…</option>
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={saveName}
        onChange={(e) => setSaveName(e.target.value)}
        placeholder="Name"
        aria-label={`New feeds preset name for ${props.layer.color}`}
        title="Name for saving this layer's feeds/speeds as a preset."
        style={presetNameStyle}
      />
      <button
        type="button"
        onClick={() => {
          if (saveName.trim() === '') return;
          saveCncFeedPreset(saveName.trim(), props.settings);
          setSaveName('');
        }}
        aria-label={`Save feeds preset for ${props.layer.color}`}
        title="Save this layer's feed, plunge, spindle, depth/pass, and stepover under a name."
      >
        Save
      </button>
    </Row>
  );
}

function Row(props: { readonly label: string; readonly children: React.ReactNode }): JSX.Element {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{props.label}</span>
      <div style={valueStyle}>{props.children}</div>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 28,
};
const labelStyle: React.CSSProperties = { width: 96, fontSize: 12, color: 'var(--lf-text-muted)' };
const valueStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, flex: 1 };
const selectStyle: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: 12, padding: '2px 4px' };
const presetNameStyle: React.CSSProperties = { width: 72, padding: '2px 6px', fontSize: 12 };
const scallopInputStyle: React.CSSProperties = { width: 64, padding: '2px 6px' };
const reliefHintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  padding: '2px 0 2px 4px',
  lineHeight: 1.35,
};
