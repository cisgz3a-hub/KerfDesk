// DesignOptionsBar — the context-sensitive strip under the title row
// (ADR-271, DS-6b).
//
// LightBurn's convention, and the reason its toolbars stay readable: controls that
// belong to the ARMED TOOL live here and swap with it, rather than crowding one
// static bar. A tool with nothing to configure shows its hint instead of an empty
// strip, so the row never looks broken.

import { useState } from 'react';
import { formatFieldNumber, parseFieldNumber } from './design-field-format';
import { DESIGN_TOOL_BY_KIND } from './design-tool';
import { useDesignStudioStore } from './design-studio-store';

export function DesignOptionsBar(): JSX.Element | null {
  const session = useDesignStudioStore((state) => state.session);
  const setFilletRadiusMm = useDesignStudioStore((state) => state.setFilletRadiusMm);
  const setChamferDistanceMm = useDesignStudioStore((state) => state.setChamferDistanceMm);
  if (session === null) return null;
  const tool = DESIGN_TOOL_BY_KIND[session.tool];
  return (
    <div style={barStyle} role="toolbar" aria-label={`${tool.label} options`}>
      <span style={toolNameStyle}>{tool.label}</span>
      {session.tool === 'fillet' ? (
        <SizeField
          label="Radius"
          valueMm={session.filletRadiusMm}
          onCommit={setFilletRadiusMm}
          title="Fillet radius in mm. Click a corner to round it; a corner too short for this radius is left alone."
        />
      ) : null}
      {session.tool === 'chamfer' ? (
        <SizeField
          label="Distance"
          valueMm={session.chamferDistanceMm}
          onCommit={setChamferDistanceMm}
          title="Chamfer setback in mm, measured along both legs. Click a corner to flatten it."
        />
      ) : null}
      <span style={hintStyle}>{tool.hint}</span>
    </div>
  );
}

function SizeField(props: {
  readonly label: string;
  readonly valueMm: number;
  readonly onCommit: (valueMm: number) => void;
  readonly title: string;
}): JSX.Element {
  const shown = formatFieldNumber({
    key: 'radius',
    label: props.label,
    value: props.valueMm,
    unit: 'mm',
    editable: true,
    group: 'shape',
  });
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft === null) return;
    const parsed = parseFieldNumber(draft);
    setDraft(null);
    if (parsed !== null && parsed > 0) props.onCommit(parsed);
  };
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>{props.label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={draft ?? shown}
        aria-label={`${props.label} in mm`}
        title={props.title}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit();
            event.preventDefault();
            return;
          }
          if (event.key === 'Escape') {
            setDraft(null);
            event.stopPropagation();
          }
        }}
        style={inputStyle}
      />
      <span style={unitStyle}>mm</span>
    </label>
  );
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--lf-space-3)',
  padding: '3px 10px',
  borderBottom: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-2)',
  minHeight: 26,
  flexShrink: 0,
};

const toolNameStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--lf-text)',
  minWidth: 74,
};

const fieldStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4 };

const labelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-muted)' };

const inputStyle: React.CSSProperties = {
  width: 62,
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
  padding: '1px 5px',
  borderRadius: 4,
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-input)',
  color: 'var(--lf-text)',
};

const unitStyle: React.CSSProperties = { fontSize: 10, color: 'var(--lf-text-muted)' };

const hintStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
