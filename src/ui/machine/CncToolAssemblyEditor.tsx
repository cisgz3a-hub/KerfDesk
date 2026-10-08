import { useState } from 'react';
import type { CncTool } from '../../core/scene';
import type { CncToolAssemblyMetadata } from '../../core/cnc/cnc-tool-assembly';
import {
  cncAssemblyDraft,
  parseCncAssemblyDraft,
  type CncAssemblyDraft,
  type CncHolderDraft,
} from './cnc-tool-assembly-draft';
import { CncToolAssemblyPreview } from './CncToolAssemblyPreview';

export function CncToolAssemblyEditor(props: {
  readonly tool: CncTool;
  readonly onChange?: (toolId: string, assembly: CncToolAssemblyMetadata) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(() => cncAssemblyDraft(props.tool));
  const [error, setError] = useState<string | null>(null);
  const save = (): void => {
    const parsed = parseCncAssemblyDraft(draft);
    setError(parsed.error);
    if (parsed.assembly !== null) props.onChange?.(props.tool.id, parsed.assembly);
  };
  return (
    <details style={detailsStyle}>
      <summary title="Inspect optional cutter and holder dimensions used by advisory reach and fixture checks.">
        Assembly and reach for {props.tool.name}
      </summary>
      <CncToolAssemblyPreview tool={props.tool} />
      <p>
        Optional advisory geometry in millimetres. Leave unknown values blank. Holder distance is
        measured upward from the cutter tip. Verify exposed lengths and clamps in the physical
        setup.
      </p>
      {props.onChange === undefined ? (
        <p>Edit assembly geometry in Machine Setup.</p>
      ) : (
        <>
          <AssemblyDimensions draft={draft} onChange={setDraft} />
          <HolderFields
            holders={draft.holders}
            onChange={(holders) => setDraft({ ...draft, holders })}
          />
          <button
            type="button"
            title="Add a cylindrical holder envelope positioned above the cutter tip; up to 32 segments are supported."
            disabled={draft.holders.length >= 32}
            onClick={() =>
              setDraft({
                ...draft,
                holders: [
                  ...draft.holders,
                  { name: '', startMm: '', lengthMm: '', diameterMm: '' },
                ],
              })
            }
          >
            Add holder segment
          </button>{' '}
          <button
            type="button"
            onClick={save}
            aria-label={`Save assembly geometry for ${props.tool.name}`}
            title="Validate and save these optional dimensions for advisory reach analysis. Verify the physical setup separately."
          >
            Save assembly geometry
          </button>
          {error === null ? null : <p role="alert">{error}</p>}
        </>
      )}
    </details>
  );
}

function AssemblyDimensions(props: {
  readonly draft: CncAssemblyDraft;
  readonly onChange: (draft: CncAssemblyDraft) => void;
}): JSX.Element {
  const fields = [
    { key: 'fluteLengthMm', label: 'Flute length (mm)' },
    { key: 'stickoutMm', label: 'Stickout (mm)' },
    { key: 'shankDiameterMm', label: 'Shank diameter (mm)' },
  ] as const;
  return (
    <div style={gridStyle}>
      {fields.map((field) => (
        <label key={field.key}>
          {field.label}
          <input
            type="number"
            min={0}
            step="any"
            value={props.draft[field.key]}
            aria-label={field.label}
            title={assemblyFieldTitles[field.key]}
            onChange={(event) =>
              props.onChange({ ...props.draft, [field.key]: event.target.value })
            }
            style={inputStyle}
          />
        </label>
      ))}
    </div>
  );
}
function HolderFields(props: {
  readonly holders: ReadonlyArray<CncHolderDraft>;
  readonly onChange: (holders: ReadonlyArray<CncHolderDraft>) => void;
}): JSX.Element {
  const fields = [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'startMm', label: 'Above tip (mm)', type: 'number' },
    { key: 'lengthMm', label: 'Length (mm)', type: 'number' },
    { key: 'diameterMm', label: 'Diameter (mm)', type: 'number' },
  ] as const;
  return (
    <>
      {props.holders.map((holder, index) => (
        <fieldset key={index} style={holderStyle}>
          <legend>Holder segment {index + 1}</legend>
          <div style={gridStyle}>
            {fields.map((field) => (
              <label key={field.key}>
                {field.label}
                <input
                  type={field.type}
                  min={field.type === 'number' ? 0 : undefined}
                  step={field.type === 'number' ? 'any' : undefined}
                  value={holder[field.key]}
                  aria-label={`Holder ${index + 1} ${field.label}`}
                  title={holderFieldTitles[field.key]}
                  style={inputStyle}
                  onChange={(event) =>
                    props.onChange(
                      props.holders.map((s, i) =>
                        i === index ? { ...s, [field.key]: event.target.value } : s,
                      ),
                    )
                  }
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            title="Remove this holder envelope from the advisory assembly geometry."
            onClick={() => props.onChange(props.holders.filter((_, i) => i !== index))}
          >
            Remove holder segment {index + 1}
          </button>
        </fieldset>
      ))}
    </>
  );
}
const assemblyFieldTitles = {
  fluteLengthMm:
    'Cutting flute length in millimetres. Leave blank if unknown; deeper cuts may bring noncutting geometry into stock.',
  stickoutMm:
    'Exposed distance from the cutter tip to the holder or collet in millimetres. Leave blank if unknown.',
  shankDiameterMm:
    'Noncutting shank diameter in millimetres for the advisory reach envelope. Leave blank if unknown.',
};
const holderFieldTitles = {
  name: 'Name this holder segment so reach findings identify the relevant part of the assembly.',
  startMm:
    'Distance in millimetres from the cutter tip upward to the bottom of this holder segment.',
  lengthMm: 'Axial length of this cylindrical holder segment in millimetres.',
  diameterMm: 'Outer diameter of this cylindrical holder envelope in millimetres.',
};
const detailsStyle: React.CSSProperties = {
  flexBasis: '100%',
  fontSize: 11,
  width: '100%',
  margin: '4px 0',
};
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(105px, 1fr))',
  gap: 6,
  margin: '4px 0',
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: 3,
  fontSize: 11,
};
const holderStyle: React.CSSProperties = { minWidth: 0, padding: 6, margin: '6px 0' };
