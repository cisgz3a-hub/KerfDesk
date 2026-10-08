import { useState } from 'react';
import type { CncCuttingPreset } from '../../core/scene/cnc-cutting-preset';
import { useStore } from '../state';
import { previewCncPresetImport, type CncPresetImportPreview } from '../state/cnc-preset-transfer';

export function CncPresetTransferRows(props: {
  readonly presets: ReadonlyArray<CncCuttingPreset>;
}): JSX.Element {
  const importPresets = useStore((s) => s.importCncFeedPresets);
  const [json, setJson] = useState('');
  const [preview, setPreview] = useState<CncPresetImportPreview | null>(null);
  return (
    <details style={detailsStyle}>
      <summary title="Review or transfer cutting records with their tool, material, machine and qualification context.">
        Import or copy cutting records
      </summary>
      <p>
        Copy JSON to keep context and source/qualification notes with the values. Imported records
        use new IDs and preserve existing entries.
      </p>
      <button
        type="button"
        title="Show this cutting library as JSON in the text field for copying or saving elsewhere."
        onClick={() => {
          setJson(
            JSON.stringify(
              { schemaVersion: 1, units: 'mm-min-rpm', feedPresets: props.presets },
              null,
              2,
            ),
          );
          setPreview(null);
        }}
      >
        Show library JSON
      </button>
      <textarea
        aria-label="Cutting record JSON"
        title="Paste cutting-library JSON to preview an import, or copy the current library JSON from this field."
        rows={5}
        value={json}
        onChange={(event) => {
          setJson(event.target.value);
          setPreview(null);
        }}
        style={textStyle}
      />
      <button
        type="button"
        title="Validate the pasted records and review context conflicts before importing any copies."
        disabled={json.trim() === ''}
        onClick={() => setPreview(previewCncPresetImport(json, props.presets))}
      >
        Preview import
      </button>
      {preview === null ? null : (
        <ImportPreview
          preview={preview}
          onImport={() => {
            const current = previewCncPresetImport(
              json,
              useStore.getState().cncLibrary.feedPresets,
            );
            if (current.error !== null) {
              setPreview(current);
              return;
            }
            importPresets(current.presets);
            setJson('');
            setPreview(null);
          }}
        />
      )}
    </details>
  );
}

function ImportPreview(props: {
  readonly preview: CncPresetImportPreview;
  readonly onImport: () => void;
}): JSX.Element {
  const { preview } = props;
  return (
    <div>
      {preview.error === null ? null : <p role="alert">{preview.error}</p>}
      <p>
        {preview.presets.length} valid records; {preview.discarded} invalid records omitted.
      </p>
      {preview.conflicts.map((conflict, index) => (
        <p role="note" key={`${conflict}-${index}`}>
          {conflict}
        </p>
      ))}
      {preview.presets.map((preset, index) => (
        <p key={`${preset.id}-${index}`}>
          {preset.name}: {preset.context?.tool.name ?? 'unknown tool'},{' '}
          {preset.context?.materialKey ?? 'unknown material'},{' '}
          {preset.context?.machine.name ?? 'unknown machine'}; source{' '}
          {preset.provenance?.kind ?? 'unknown'}; qualification{' '}
          {preset.qualification?.status ?? 'unverified'}.
        </p>
      ))}
      <button
        type="button"
        title="Import the valid reviewed records with new IDs while preserving existing library entries."
        disabled={preview.error !== null}
        onClick={props.onImport}
      >
        Import as new copies
      </button>
    </div>
  );
}
const detailsStyle: React.CSSProperties = { margin: '6px 0', fontSize: 11 };
const textStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  margin: '6px 0',
  fontSize: 10,
};
