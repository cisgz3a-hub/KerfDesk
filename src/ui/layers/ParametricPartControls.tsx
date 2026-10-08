import { useState } from 'react';
import type { GeneratedPartObject } from '../../core/parts/part-generator';
import { useStore } from '../state';
import { PartGeneratorDialog } from './PartGeneratorDialog';

export function ParametricPartControls(): JSX.Element {
  const selected = useStore((state) =>
    state.additionalSelectedIds.size === 0
      ? state.project.scene.objects.find((object) => object.id === state.selectedObjectId)
      : undefined,
  );
  const [editing, setEditing] = useState<GeneratedPartObject | null | undefined>(undefined);
  const [message, setMessage] = useState('');
  const object =
    selected?.kind === 'imported-svg' && selected.partGenerator !== undefined
      ? (selected as GeneratedPartObject)
      : undefined;
  function bake(): void {
    if (object === undefined) return;
    const result = useStore.getState().bakePartGenerator(object.id);
    setMessage(
      result.kind === 'invalid'
        ? result.reason
        : 'Baked generated part. Current geometry and operation settings are retained.',
    );
  }
  return (
    <section aria-label="Parametric parts">
      <button
        title="Choose dimensions and operation roles for a new generated part"
        type="button"
        onClick={() => {
          setEditing(null);
          setMessage('');
        }}
      >
        Create parametric part…
      </button>
      {object === undefined ? null : (
        <>
          <button
            title="Edit the retained dimensions of the selected generated part"
            type="button"
            disabled={object.locked === true}
            onClick={() => {
              setEditing(object);
              setMessage('');
            }}
          >
            Edit generated part dimensions…
          </button>
          <button
            title="Keep the selected part as ordinary vectors and remove its generator"
            type="button"
            disabled={object.locked === true}
            onClick={bake}
          >
            Bake selected generated part
          </button>
        </>
      )}
      {message ? <p role="status">{message}</p> : null}
      {editing === undefined ? null : (
        <PartGeneratorDialog
          {...(editing === null ? {} : { object: editing })}
          onClose={() => setEditing(undefined)}
        />
      )}
    </section>
  );
}
