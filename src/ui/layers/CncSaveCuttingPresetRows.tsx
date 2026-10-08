import { useEffect, useState } from 'react';
import { cncCuttingValues } from '../../core/cnc/cutting-preset';
import type { CncLayerSettings, Layer } from '../../core/scene';
import type { CncCuttingContext, CncCuttingProvenance } from '../../core/scene/cnc-cutting-preset';
import { useStore } from '../state';
import { Row, selectStyle } from './CncLayerPrimitives';

type EvidenceDraft = {
  readonly sourceKind: CncCuttingProvenance['kind'];
  readonly reference: string;
  readonly qualifiedFor: string | null;
  readonly notes: string;
};
export function CncSaveCuttingPresetRows(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly context: CncCuttingContext | null;
}): JSX.Element {
  const savePreset = useStore((s) => s.saveCncFeedPreset);
  const [name, setName] = useState('');
  const [evidence, setEvidence] = useState<EvidenceDraft>({
    sourceKind: 'operator',
    reference: '',
    qualifiedFor: null,
    notes: '',
  });
  const qualificationIdentity =
    props.context === null
      ? null
      : JSON.stringify([props.context, cncCuttingValues(props.settings)]);
  const qualified =
    qualificationIdentity !== null && evidence.qualifiedFor === qualificationIdentity;
  useEffect(() => {
    setEvidence((current) =>
      current.qualifiedFor !== null && current.qualifiedFor !== qualificationIdentity
        ? { ...current, qualifiedFor: null }
        : current,
    );
  }, [qualificationIdentity]);
  const canSave = name.trim() !== '' && (!qualified || evidence.notes.trim() !== '');
  return (
    <>
      <Row label="Save preset">
        <input
          type="text"
          value={name}
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
          placeholder="Preset name"
          aria-label={`New feeds preset name for ${props.layer.color}`}
          title="Name these cutting values. Complete context is captured; otherwise the record stays generic and unverified."
          style={inputStyle}
        />
        <button
          type="button"
          disabled={!canSave}
          aria-label={`Save feeds preset for ${props.layer.color}`}
          title="Save current cutting values and supporting notes. Incomplete context creates a generic, unverified record."
          onClick={() => {
            if (!canSave) return;
            savePreset(name.trim(), props.settings, {
              ...(props.context === null ? {} : { context: props.context }),
              provenance: { kind: evidence.sourceKind, reference: evidence.reference },
              qualification: {
                status: qualified ? 'operator-qualified' : 'unverified',
                notes: evidence.notes,
              },
            });
            setName('');
          }}
        >
          Save
        </button>
      </Row>
      {props.context === null ? (
        <p style={hintStyle}>
          Incomplete tool, material or machine context. Save creates a generic, unverified record;
          applying it later requires unknown-context review.
        </p>
      ) : null}
      <PresetEvidenceFields
        evidence={evidence}
        qualificationIdentity={qualificationIdentity}
        qualified={qualified}
        onChange={setEvidence}
      />
    </>
  );
}
function PresetEvidenceFields(props: {
  readonly evidence: EvidenceDraft;
  readonly qualificationIdentity: string | null;
  readonly qualified: boolean;
  readonly onChange: (evidence: EvidenceDraft) => void;
}): JSX.Element {
  const { evidence } = props;
  return (
    <details style={hintStyle}>
      <summary title="Record where these values came from and any supporting material-cut trial evidence.">
        Source and qualification notes
      </summary>
      <Row label="Source">
        <select
          value={evidence.sourceKind}
          aria-label="Cutting preset source"
          title="Identify whether these starting values came from an operator, calculator, toolmaker or imported data."
          style={selectStyle}
          onChange={(event) =>
            props.onChange({
              ...evidence,
              sourceKind: event.target.value as CncCuttingProvenance['kind'],
            })
          }
        >
          <option value="operator">Operator values</option>
          <option value="calculator">Calculator starting values</option>
          <option value="manufacturer">Toolmaker data</option>
          <option value="imported">Imported data</option>
        </select>
      </Row>
      <input
        value={evidence.reference}
        maxLength={3000}
        onChange={(event) => props.onChange({ ...evidence, reference: event.target.value })}
        placeholder="Source reference or trial record"
        aria-label="Cutting preset source reference"
        title="Record the source document, calculation or trial reference that supports these cutting values."
        style={fullInputStyle}
      />
      <label style={checkStyle}>
        <input
          type="checkbox"
          title="Record material-cut qualification for this exact context and cutting values. Complete context and supporting notes are required."
          aria-label="Operator qualification for current cutting values"
          disabled={props.qualificationIdentity === null}
          checked={props.qualified}
          onChange={(event) =>
            props.onChange({
              ...evidence,
              qualifiedFor: event.target.checked ? props.qualificationIdentity : null,
            })
          }
        />
        Operator qualified this context and cutting values in a material cut
      </label>
      <textarea
        value={evidence.notes}
        maxLength={3000}
        onChange={(event) => props.onChange({ ...evidence, notes: event.target.value })}
        placeholder="Trial date, material, workholding and observed result"
        aria-label="Cutting preset qualification notes"
        title="Describe the trial date, material, workholding and observed result supporting the qualification."
        rows={3}
        style={fullInputStyle}
      />
      {props.qualified && evidence.notes.trim() === '' ? (
        <p role="note">Record supporting trial notes before saving this qualification.</p>
      ) : null}
      <p>Without recorded material-cut evidence this remains an unverified starting point.</p>
    </details>
  );
}
const inputStyle: React.CSSProperties = {
  flex: '1 1 120px',
  minWidth: 0,
  padding: '2px 6px',
  fontSize: 12,
};
const fullInputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: 4,
  fontSize: 11,
};
const hintStyle: React.CSSProperties = {
  fontSize: 11,
  margin: '4px 0',
  color: 'var(--lf-text-muted)',
};
const checkStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'start',
  gap: 4,
  margin: '4px 0',
};
