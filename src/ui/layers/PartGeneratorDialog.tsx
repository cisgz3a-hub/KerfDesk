import { useState } from 'react';
import type { GeneratedPartObject, PartGeneratorDefinition } from '../../core/parts/part-generator';
import { defaultPartGenerator } from '../../core/parts/part-generator';
import type { PreparedPartGenerator } from '../state/prepare-part-generator';
import { useStore } from '../state';
import { Dialog } from '../kit';
import { PartGeneratorFields } from './PartGeneratorFields';
import { PartGeneratorReview } from './PartGeneratorReview';

export function PartGeneratorDialog(props: {
  readonly object?: GeneratedPartObject;
  readonly onClose: () => void;
}): JSX.Element {
  const [definition, setDefinition] = useState<PartGeneratorDefinition>(
    props.object?.partGenerator.definition ?? defaultPartGenerator('panel'),
  );
  const [prepared, setPrepared] = useState<PreparedPartGenerator | null>(null);
  const [error, setError] = useState('');
  const project = useStore((state) => state.project);
  const epoch = useStore((state) => state.projectDocumentEpoch);
  const stale =
    prepared !== null && (prepared.project !== project || prepared.documentEpoch !== epoch);
  function preview(): void {
    const result = useStore.getState().preparePartGenerator(definition, props.object?.id);
    setPrepared(result.kind === 'ok' ? result.value : null);
    setError(result.kind === 'invalid' ? result.reason : '');
  }
  function accept(): void {
    if (prepared === null) return;
    const result = useStore.getState().acceptPartGenerator(prepared);
    if (result.kind === 'invalid') setError(result.reason);
    else props.onClose();
  }
  return (
    <Dialog
      title={
        props.object === undefined ? 'Create generated part' : 'Edit generated part dimensions'
      }
      size="lg"
      onClose={props.onClose}
    >
      <PartGeneratorFields
        definition={definition}
        onChange={(next) => {
          setDefinition(next);
          setPrepared(null);
          setError('');
        }}
      />
      <button
        title="Generate a preview of the part geometry and operation bindings"
        type="button"
        onClick={preview}
      >
        Preview geometry and operations
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {prepared === null ? (
        <p>Review the generated geometry before applying it.</p>
      ) : (
        <PartGeneratorReview prepared={prepared} stale={stale} />
      )}
      <button
        title="Apply the current reviewed part geometry and operation bindings"
        type="button"
        disabled={prepared === null || stale}
        onClick={accept}
      >
        Apply reviewed part
      </button>
      <button title="Close without applying the part preview" type="button" onClick={props.onClose}>
        Cancel
      </button>
    </Dialog>
  );
}
