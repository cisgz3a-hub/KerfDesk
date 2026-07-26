import { useEffect, useState } from 'react';
import { CHIPLOAD_MATERIALS } from '../../core/cnc';
import { CncMaterialOptions } from '../common/CncMaterialOptions';
import { useStore } from '../state';

const CUSTOM = '';

export function CncProjectMaterialPicker(props: {
  readonly activeMaterialKey: string | undefined;
}): JSX.Element {
  const applyCncStockMaterial = useStore((state) => state.applyCncStockMaterial);
  const layerCount = useStore((state) => state.project.scene.layers.length);
  const activeKey = props.activeMaterialKey ?? CUSTOM;
  const [pendingKey, setPendingKey] = useState(activeKey);
  useEffect(() => setPendingKey(activeKey), [activeKey]);

  const preset = selectedPreset(pendingKey);
  const buttonLabel = preset === null ? 'Use manual feeds' : `Apply ${preset.label} preset`;
  const isCustomActive = pendingKey === CUSTOM && activeKey === CUSTOM;
  return (
    <div style={containerStyle}>
      <div style={rowStyle}>
        <span style={labelStyle}>Material</span>
        <select
          value={pendingKey}
          onChange={(event) => setPendingKey(event.target.value)}
          aria-label="Project material"
          title="Choose stock, review what will change, then apply. Changing this menu alone never rewrites layer settings."
          style={selectStyle}
        >
          <option value={CUSTOM}>Custom (manual feeds)</option>
          <CncMaterialOptions />
        </select>
      </div>
      <p style={hintStyle}>{materialApplyHint(preset, layerCount)}</p>
      <button
        type="button"
        disabled={isCustomActive}
        onClick={() => applyCncStockMaterial(preset?.value ?? null)}
        title="Apply in one undoable update. Existing numeric values remain editable and must be verified with a test cut."
        style={buttonStyle}
      >
        {buttonLabel}
      </button>
    </div>
  );
}

function materialApplyHint(preset: ReturnType<typeof selectedPreset>, layerCount: number): string {
  if (preset === null) {
    return 'Manual mode clears the project preset but keeps every layer’s current numeric values.';
  }
  const familyLabel = preset.family === 'plywood-mdf' ? 'plywood / MDF' : preset.family;
  if (layerCount === 0) {
    return `${preset.label} uses the ${familyLabel} starting model. Apply saves it for new layers. Test on scrap before the final cut.`;
  }
  const layerLabel = layerCount === 1 ? 'layer' : 'layers';
  return `${preset.label} uses the ${familyLabel} starting model. Apply recalculates feed, plunge, and depth/pass for ${layerCount} ${layerLabel} from each bit, spindle, and machine limits. Test on scrap.`;
}

function selectedPreset(value: string) {
  return CHIPLOAD_MATERIALS.find((material) => material.value === value) ?? null;
}

const containerStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--lf-border)',
  paddingBottom: 6,
  marginBottom: 2,
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 28,
  minWidth: 0,
};
const labelStyle: React.CSSProperties = {
  width: 108,
  flex: '0 0 108px',
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
const selectStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 12,
  padding: '2px 4px',
};
const hintStyle: React.CSSProperties = {
  margin: '2px 0 5px 0',
  fontSize: 11,
  lineHeight: 1.35,
  color: 'var(--lf-text-muted)',
};
const buttonStyle: React.CSSProperties = {
  display: 'block',
  marginLeft: 'auto',
  maxWidth: '100%',
  fontSize: 11,
};
