// Per-layer bit selectors (Phase H.7 multi-tool). LayerBitSelect assigns
// the bit a layer cuts with (default = the machine's active bit);
// VClearToolSelect arms the two-stage v-carve's flat-floor clearing bit.
// Split from CncLayerFields.tsx, which sits near the file-size cap.

import {
  DEFAULT_CNC_TOOLS,
  type CncLayerSettings,
  type CncTool,
  type Layer,
} from '../../core/scene';
import { useStore } from '../state';

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
