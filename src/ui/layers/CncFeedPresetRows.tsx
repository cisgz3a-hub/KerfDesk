import { useState } from 'react';
import type { CncLayerSettings, Layer } from '../../core/scene';
import type { CncCuttingContext, CncCuttingPreset } from '../../core/scene/cnc-cutting-preset';
import { cncCuttingPresetPatch, previewCncCuttingPreset } from '../../core/cnc/cutting-preset';
import { useStore } from '../state';
import { currentCncCuttingContext } from '../state/cnc-cutting-context';
import { Row, selectStyle } from './CncLayerPrimitives';
import { CncCuttingPresetPreview, CncSavedCuttingRecord } from './CncCuttingPresetPreview';
import { CncSaveCuttingPresetRows } from './CncSaveCuttingPresetRows';
import { CncPresetTransferRows } from './CncPresetTransferRows';

type Props = {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
};
export function CncFeedPresetRows(props: Props): JSX.Element {
  const presets = useStore((s) => s.cncLibrary.feedPresets);
  const machine = useStore((s) => s.project.machine);
  const device = useStore((s) => s.project.device);
  const [selectedId, setSelectedId] = useState('');
  const context = currentCncCuttingContext(
    props.settings,
    machine?.kind === 'cnc' ? machine : null,
    device,
  );
  const selected = presets.find((preset) => preset.id === selectedId);
  return (
    <>
      <CncSavedCuttingRecord settings={props.settings} context={context} />
      <Row label="Apply preset">
        <select
          value={selectedId}
          disabled={presets.length === 0}
          onChange={(event) => setSelectedId(event.target.value)}
          aria-label={`Apply feeds preset for ${props.layer.color}`}
          style={selectStyle}
          title="Preview saved cutting data and context before applying values."
        >
          <option value="">{presets.length === 0 ? 'No saved presets' : 'Choose preset…'}</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </Row>
      {selected === undefined ? null : (
        <SelectedPresetPanel
          key={selected.id}
          {...props}
          preset={selected}
          context={context}
          canApply={machine?.kind === 'cnc'}
          onClose={() => setSelectedId('')}
        />
      )}
      <CncSaveCuttingPresetRows layer={props.layer} settings={props.settings} context={context} />
      <CncPresetTransferRows presets={presets} />
    </>
  );
}
function SelectedPresetPanel(
  props: Props & {
    readonly preset: CncCuttingPreset;
    readonly context: CncCuttingContext | null;
    readonly canApply: boolean;
    readonly onClose: () => void;
  },
): JSX.Element {
  const deletePreset = useStore((s) => s.deleteCncFeedPreset);
  const [acknowledgedContext, setAcknowledgedContext] = useState<string | null>(null);
  const preview = previewCncCuttingPreset(props.preset, props.settings, props.context);
  const acknowledgementKey = JSON.stringify([props.preset, props.context]);
  const acknowledged = acknowledgedContext === acknowledgementKey;
  return (
    <div style={previewStyle}>
      <CncCuttingPresetPreview preset={props.preset} preview={preview} />
      {preview.compatible ? null : (
        <label style={acknowledgeStyle}>
          <input
            type="checkbox"
            title="Acknowledge the different or unknown tool, material or machine context before copying these values once."
            checked={acknowledged}
            onChange={(event) =>
              setAcknowledgedContext(event.target.checked ? acknowledgementKey : null)
            }
          />
          I reviewed the different or unknown context; copy these values once.
        </label>
      )}
      <button
        type="button"
        disabled={!props.canApply || (!preview.compatible && !acknowledged)}
        aria-label={`Apply reviewed feeds preset for ${props.layer.color}`}
        title="Copy the reviewed cutting values into this operation and retain a snapshot of the record."
        onClick={() => {
          props.onCommit(cncCuttingPresetPatch(props.preset));
          props.onClose();
        }}
      >
        Apply reviewed values
      </button>{' '}
      <button
        type="button"
        title="Delete this library record; existing jobs retain their saved snapshots and cutting values."
        onClick={() => {
          deletePreset(props.preset.id);
          props.onClose();
        }}
      >
        Delete saved record
      </button>
    </div>
  );
}
const previewStyle: React.CSSProperties = {
  fontSize: 11,
  margin: '6px 0',
  padding: 6,
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
};
const acknowledgeStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'start',
  marginBottom: 6,
};
