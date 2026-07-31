// DesignLayerSettings — the active layer's carve settings (ADR-272
// Amendment 1): kind, depth, bit, and the v-carve clearing bit. Numeric entry
// commits on blur or Enter, the numeric-field convention the main inspector
// uses, so half-typed values never thrash the 3D preview.

import { useEffect, useState } from 'react';
import type { CncTool } from '../../../core/scene';
import {
  DESIGN_CUT_TYPES,
  type DesignCutType,
  type DesignLayer,
  type DesignLayerPatch,
} from '../../../core/design/layers';
import { DESIGN_CUT_TYPE_LABELS } from './design-cut-type-labels';

const ACTIVE_BIT_VALUE = '';

export function DesignLayerSettings(props: {
  readonly layer: DesignLayer;
  readonly tools: ReadonlyArray<CncTool>;
  readonly stockThicknessMm: number;
  readonly onPatch: (patch: DesignLayerPatch) => void;
}): JSX.Element {
  const { layer, tools } = props;
  return (
    <div style={settingsStyle}>
      <NameField
        key={`name-${layer.id}`}
        name={layer.name}
        onCommit={(name) => props.onPatch({ name })}
      />
      <label style={fieldStyle}>
        <span style={labelStyle}>Cut</span>
        <select
          value={layer.cutType}
          title="What this layer's shapes become: a pocket, a v-carved groove, a profile cut, an engraving, or drilled holes"
          onChange={(event) => props.onPatch({ cutType: event.target.value as DesignCutType })}
          style={inputStyle}
        >
          {DESIGN_CUT_TYPES.map((cutType) => (
            <option key={cutType} value={cutType}>
              {DESIGN_CUT_TYPE_LABELS[cutType]}
            </option>
          ))}
        </select>
      </label>
      <DepthField
        key={`depth-${layer.id}`}
        depthMm={layer.depthMm}
        stockThicknessMm={props.stockThicknessMm}
        onCommit={(depthMm) => props.onPatch({ depthMm })}
      />
      <BitSelectField
        label="Bit"
        title="The bit this layer cuts with. Layers with different bits become a multi-bit job with tool-change pauses."
        value={layer.toolId}
        emptyLabel="Machine bit (active)"
        tools={tools}
        onSelect={(toolId) => props.onPatch({ toolId })}
      />
      {layer.cutType === 'v-carve' ? (
        <BitSelectField
          label="Clear"
          title="Two-stage v-carve: flat floors beyond the v-bit's reach are pocket-cleared with this bit first"
          value={layer.vClearToolId}
          emptyLabel="Single stage (v-bit only)"
          tools={tools.filter((tool) => tool.kind !== 'v-bit')}
          onSelect={(vClearToolId) => props.onPatch({ vClearToolId })}
        />
      ) : null}
    </div>
  );
}

function BitSelectField(props: {
  readonly label: string;
  readonly title: string;
  readonly value: string | undefined;
  readonly emptyLabel: string;
  readonly tools: ReadonlyArray<CncTool>;
  readonly onSelect: (toolId: string | null) => void;
}): JSX.Element {
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>{props.label}</span>
      <select
        value={props.value ?? ACTIVE_BIT_VALUE}
        title={props.title}
        onChange={(event) =>
          props.onSelect(event.target.value === ACTIVE_BIT_VALUE ? null : event.target.value)
        }
        style={inputStyle}
      >
        <option value={ACTIVE_BIT_VALUE}>{props.emptyLabel}</option>
        {props.tools.map((tool) => (
          <option key={tool.id} value={tool.id}>
            {tool.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function NameField(props: {
  readonly name: string;
  readonly onCommit: (name: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(props.name);
  useEffect(() => setDraft(props.name), [props.name]);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed.length > 0 && trimmed !== props.name) props.onCommit(trimmed);
    else setDraft(props.name);
  };
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>Name</span>
      <input
        type="text"
        value={draft}
        title="Rename this layer — the name becomes the operation name on Apply"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
        style={inputStyle}
      />
    </label>
  );
}

function DepthField(props: {
  readonly depthMm: number;
  readonly stockThicknessMm: number;
  readonly onCommit: (depthMm: number) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(String(props.depthMm));
  useEffect(() => setDraft(String(props.depthMm)), [props.depthMm]);
  const commit = () => {
    const value = Number(draft);
    if (Number.isFinite(value) && value > 0 && value !== props.depthMm) props.onCommit(value);
    else setDraft(String(props.depthMm));
  };
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>Depth</span>
      <input
        type="number"
        min={0}
        step={0.1}
        value={draft}
        title="Total cut depth below the stock top, in millimetres. At or past the stock thickness this is a through cut."
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
        style={{ ...inputStyle, width: 64 }}
      />
      <button
        type="button"
        title={`Set the depth to the stock thickness (${props.stockThicknessMm} mm) — a through cut`}
        onClick={() => props.onCommit(props.stockThicknessMm)}
        style={throughButtonStyle}
      >
        Through
      </button>
    </label>
  );
}

const settingsStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '8px 6px 4px',
  borderTop: '1px solid var(--lf-border)',
};

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: 'var(--lf-text)',
};

const labelStyle: React.CSSProperties = {
  width: 42,
  flexShrink: 0,
  color: 'var(--lf-text-dim)',
  fontSize: 11,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 12,
  padding: '3px 6px',
  borderRadius: 4,
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-input)',
  color: 'var(--lf-text)',
};

const throughButtonStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '3px 8px',
  borderRadius: 4,
  border: '1px solid var(--lf-border)',
  background: 'transparent',
  color: 'var(--lf-text)',
  cursor: 'pointer',
  flexShrink: 0,
};
