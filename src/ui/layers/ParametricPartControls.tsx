import { useEffect, useState } from 'react';
import type { GeneratedPartObject } from '../../core/parts/part-generator';
import { useStore } from '../state';
import { PartGeneratorDialog } from './PartGeneratorDialog';

type PartEditingSession = {
  readonly source: GeneratedPartObject | undefined;
  readonly documentEpoch: number;
};

function useSelectedGeneratedPart(): GeneratedPartObject | undefined {
  return useStore((state) => {
    const selected =
      state.additionalSelectedIds.size === 0
        ? state.project.scene.objects.find((object) => object.id === state.selectedObjectId)
        : undefined;
    return selected?.kind === 'imported-svg' && selected.partGenerator !== undefined
      ? (selected as GeneratedPartObject)
      : undefined;
  });
}

function usePartEditingSession(object: GeneratedPartObject | undefined) {
  const documentEpoch = useStore((state) => state.projectDocumentEpoch);
  const [session, setSession] = useState<PartEditingSession | null>(null);
  const editing =
    session !== null &&
    session.documentEpoch === documentEpoch &&
    (session.source === undefined || session.source.id === object?.id)
      ? session
      : null;
  useEffect(() => {
    if (session !== null && editing === null) setSession(null);
  }, [editing, session]);
  return {
    editing,
    open: (source?: GeneratedPartObject) => setSession({ source, documentEpoch }),
    close: () => setSession(null),
  };
}

export function ParametricPartControls(props: { readonly mode?: 'edit' } = {}): JSX.Element | null {
  const object = useSelectedGeneratedPart();
  const { editing, open, close } = usePartEditingSession(object);
  const [message, setMessage] = useState('');
  function bake(): void {
    if (object === undefined) return;
    const result = useStore.getState().bakePartGenerator(object.id);
    setMessage(
      result.kind === 'invalid'
        ? result.reason
        : 'Baked generated part. Current geometry and operation settings are retained.',
    );
  }
  if (props.mode === 'edit' && object === undefined) return null;
  return (
    <section aria-label="Parametric parts">
      {props.mode === 'edit' ? null : (
        <button
          title="Choose dimensions and operation roles for a new generated part"
          type="button"
          onClick={() => {
            open();
            setMessage('');
          }}
        >
          Create parametric part…
        </button>
      )}
      {object === undefined ? null : (
        <>
          <button
            title="Edit the retained dimensions of the selected generated part"
            type="button"
            disabled={object.locked === true}
            onClick={() => {
              open(object);
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
      {editing === null ? null : (
        <PartGeneratorDialog
          key={editing.documentEpoch + ':' + (editing.source?.id ?? 'new')}
          {...(editing.source === undefined ? {} : { object: editing.source })}
          onClose={close}
        />
      )}
    </section>
  );
}
