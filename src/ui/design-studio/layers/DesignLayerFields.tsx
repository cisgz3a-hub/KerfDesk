import { useEffect, useState } from 'react';
import {
  DESIGN_CUT_TYPES,
  type DesignCutType,
  type DesignLayer,
  type DesignLayerPatch,
} from '../../../core/design/layers';
import { DESIGN_CUT_TYPE_LABELS } from './design-cut-type-labels';
import {
  DESIGN_FIELD_INPUT_STYLE,
  DESIGN_FIELD_LABEL_STYLE,
  DESIGN_FIELD_STYLE,
  DESIGN_THROUGH_BUTTON_STYLE,
} from './design-layer-settings-styles';

/** Renders the active layer's name, cut type, and operation-specific depth controls. */
export function DesignLayerFields(props: {
  readonly layer: DesignLayer;
  readonly stockThicknessMm: number;
  readonly onPatch: (patch: DesignLayerPatch) => void;
}): JSX.Element {
  const { layer } = props;
  return (
    <>
      <NameField
        key={`name-${layer.id}`}
        name={layer.name}
        onCommit={(name) => props.onPatch({ name })}
      />
      <DesignCutTypeField layer={layer} onPatch={props.onPatch} />
      <DesignDepthFields
        layer={layer}
        stockThicknessMm={props.stockThicknessMm}
        onPatch={props.onPatch}
      />
    </>
  );
}

function DesignDepthFields(props: {
  readonly layer: DesignLayer;
  readonly stockThicknessMm: number;
  readonly onPatch: (patch: DesignLayerPatch) => void;
}): JSX.Element {
  const { layer } = props;
  const flatDepthEnabled = layer.vCarveFlatDepthEnabled ?? true;
  if (layer.cutType !== 'v-carve') {
    return (
      <DepthField
        key={`depth-${layer.id}`}
        depthMm={layer.depthMm}
        stockThicknessMm={props.stockThicknessMm}
        onCommit={(depthMm) => props.onPatch({ depthMm })}
      />
    );
  }
  return (
    <>
      <label style={DESIGN_FIELD_STYLE}>
        <span style={DESIGN_FIELD_LABEL_STYLE}>Flat</span>
        <input
          type="checkbox"
          checked={flatDepthEnabled}
          title="Limit the V-carve to a flat floor. Leave off for ordinary flowing depth."
          aria-label={`Flat depth for ${layer.name}`}
          onChange={(event) => props.onPatch({ vCarveFlatDepthEnabled: event.target.checked })}
        />
      </label>
      {flatDepthEnabled ? (
        <DepthField
          key={`depth-${layer.id}`}
          depthMm={layer.depthMm}
          stockThicknessMm={props.stockThicknessMm}
          onCommit={(depthMm) => props.onPatch({ depthMm })}
          flatDepth
        />
      ) : null}
    </>
  );
}

function DesignCutTypeField(props: {
  readonly layer: DesignLayer;
  readonly onPatch: (patch: DesignLayerPatch) => void;
}): JSX.Element {
  return (
    <label style={DESIGN_FIELD_STYLE}>
      <span style={DESIGN_FIELD_LABEL_STYLE}>Cut</span>
      <select
        value={props.layer.cutType}
        title="What this layer's shapes become: a pocket, a v-carved groove, a profile cut, an engraving, or drilled holes"
        onChange={(event) =>
          props.onPatch(designCutTypePatch(props.layer, event.target.value as DesignCutType))
        }
        style={DESIGN_FIELD_INPUT_STYLE}
      >
        {DESIGN_CUT_TYPES.map((cutType) => (
          <option key={cutType} value={cutType}>
            {DESIGN_CUT_TYPE_LABELS[cutType]}
          </option>
        ))}
      </select>
    </label>
  );
}

function designCutTypePatch(layer: DesignLayer, cutType: DesignCutType): DesignLayerPatch {
  return {
    cutType,
    ...(cutType === 'v-carve' && layer.cutType !== 'v-carve'
      ? { vCarveFlatDepthEnabled: false }
      : {}),
  };
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
    <label style={DESIGN_FIELD_STYLE}>
      <span style={DESIGN_FIELD_LABEL_STYLE}>Name</span>
      <input
        type="text"
        value={draft}
        title="Rename this layer — the name becomes the operation name on Apply"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
        style={DESIGN_FIELD_INPUT_STYLE}
      />
    </label>
  );
}

function DepthField(props: {
  readonly depthMm: number;
  readonly stockThicknessMm: number;
  readonly onCommit: (depthMm: number) => void;
  readonly flatDepth?: boolean;
}): JSX.Element {
  const [draft, setDraft] = useState(String(props.depthMm));
  useEffect(() => setDraft(String(props.depthMm)), [props.depthMm]);
  const commit = () => {
    const value = Number(draft);
    if (Number.isFinite(value) && value > 0 && value !== props.depthMm) props.onCommit(value);
    else setDraft(String(props.depthMm));
  };
  return (
    <label style={DESIGN_FIELD_STYLE}>
      <span style={DESIGN_FIELD_LABEL_STYLE}>{props.flatDepth === true ? 'Floor' : 'Depth'}</span>
      <input
        type="number"
        min={0}
        step={0.1}
        value={draft}
        title={
          props.flatDepth === true
            ? 'Maximum V-carve depth; wider areas become a deliberately cleared flat floor.'
            : 'Total cut depth below the stock top, in millimetres. At or past the stock thickness this is a through cut.'
        }
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
        style={{ ...DESIGN_FIELD_INPUT_STYLE, width: 64 }}
      />
      {props.flatDepth === true ? null : (
        <button
          type="button"
          title={`Set the depth to the stock thickness (${props.stockThicknessMm} mm) — a through cut`}
          onClick={() => props.onCommit(props.stockThicknessMm)}
          style={DESIGN_THROUGH_BUTTON_STYLE}
        >
          Through
        </button>
      )}
    </label>
  );
}
