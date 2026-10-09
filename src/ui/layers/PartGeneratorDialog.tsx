import { useState } from 'react';
import type { GeneratedPartObject, PartGeneratorDefinition } from '../../core/parts/part-generator';
import { defaultPartGenerator } from '../../core/parts/part-generator';
import type { PreparedPartGenerator } from '../state/prepare-part-generator';
import { useStore } from '../state';
import { Button, Dialog, DialogActions } from '../kit';
import { PartGeneratorFields } from './PartGeneratorFields';
import { PartGeneratorReview } from './PartGeneratorReview';
import { PartDraftPreview } from './PartDraftPreview';
import './design-authoring-dialog.css';
export function PartGeneratorDialog(props: {
  readonly object?: GeneratedPartObject;
  readonly onClose: () => void;
}): JSX.Element {
  const [definition, setDefinition] = useState<PartGeneratorDefinition>(
    () => props.object?.partGenerator.definition ?? defaultPartGenerator('panel'),
  );
  const [prepared, setPrepared] = useState<PreparedPartGenerator | null>(null);
  const [error, setError] = useState('');
  const project = useStore((state) => state.project),
    epoch = useStore((state) => state.projectDocumentEpoch);
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
        props.object === undefined ? 'Create parametric part' : 'Edit generated part dimensions'
      }
      size="xl"
      panelClassName="lf-authoring-dialog"
      onClose={props.onClose}
    >
      <p className="lf-authoring-intro">
        Choose a part, set its dimensions and review the geometry with its operation assignments.
      </p>
      <div className="lf-authoring-layout">
        <div className="lf-authoring-form">
          <PartGeneratorFields
            definition={definition}
            onChange={(next) => {
              setDefinition(next);
              setPrepared(null);
              setError('');
            }}
          />
        </div>
        <aside className="lf-authoring-review" aria-label="Part geometry review">
          <h3>Geometry preview</h3>
          {prepared === null ? (
            <PartDraftPreview definition={definition} />
          ) : (
            <PartGeneratorReview prepared={prepared} stale={stale} />
          )}
          <Button
            onClick={preview}
            title="Generate a preview of the part geometry and operation bindings"
          >
            Preview geometry and operations
          </Button>
          {error ? <p role="alert">{error}</p> : null}
        </aside>
      </div>
      <DialogActions>
        <Button onClick={props.onClose} title="Close without applying the part preview">
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={prepared === null || stale}
          onClick={accept}
          title="Apply the current reviewed part geometry and operation bindings"
        >
          Apply reviewed part
        </Button>
      </DialogActions>
    </Dialog>
  );
}
