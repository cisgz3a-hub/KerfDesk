import { useEffect, useRef, useState } from 'react';
import { combinedBBox, type ArraySpec, type Project } from '../../core/scene';
import type { RetainedArrayLayout } from '../../core/scene/retained-array';
import { objectVariableTemplate } from '../../core/variables/object-variable-template';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { retainedArrayChanged } from '../state/retained-array-capture';
import { retainedArraySource } from '../state/retained-array-regeneration';
import { prepareVariableArray, type VariableArrayResult } from '../state/prepare-variable-array';
import { variableCopySlices } from '../state/variable-copy-slices';
import { batchVariableTextRenderer } from '../text/render-variable-text';
import { ArrayDialog } from './ArrayDialog';
import { arrayFormFromSpec } from './array-form-from-spec';

export function RetainedArraysButton(): JSX.Element {
  const layouts = useStore((state) => state.project.arrayLayouts);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [status, setStatus] = useState('');
  const project = useStore((state) => state.project);
  const layout = layouts?.find((entry) => entry.id === editing);
  return (
    <>
      <Button disabled={(layouts?.length ?? 0) === 0} onClick={() => setOpen(true)}>
        Saved arrays…
      </Button>
      {open ? (
        <Dialog title="Saved arrays" onClose={() => setOpen(false)} size="md">
          <p>
            Regenerate from the saved source. Individual edits or deleted copies are retained until
            you explicitly expand the array.
          </p>
          <ul>
            {layouts?.map((entry) => (
              <li key={entry.id}>
                {entry.name} · {entry.instances.length} copies ·{' '}
                {retainedArrayChanged(project, entry)
                  ? 'edited or missing members'
                  : 'ready to regenerate'}{' '}
                <Button onClick={() => setEditing(entry.id)}>Edit settings</Button>
                <Button
                  onClick={() => {
                    useStore.getState().expandArrayLayout(entry.id);
                    setStatus(
                      'Expanded to independent copies; current artwork and settings were preserved.',
                    );
                  }}
                >
                  Expand copies
                </Button>
              </li>
            ))}
          </ul>
          <p role="status">{status}</p>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Close</Button>
          </DialogActions>
        </Dialog>
      ) : null}
      {layout === undefined ? null : (
        <RetainedArrayEditor
          key={layout.id}
          layout={layout}
          onClose={() => setEditing(undefined)}
        />
      )}
    </>
  );
}

function RetainedArrayEditor(props: {
  readonly layout: RetainedArrayLayout;
  readonly onClose: () => void;
}): JSX.Element | null {
  const captured = useStore((state) => state.project);
  const source = retainedArraySource(captured, props.layout);
  const owner = useRef(0);
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState<{ readonly done: number; readonly total: number }>();
  const [error, setError] = useState<string>();
  useEffect(
    () => () => {
      owner.current += 1;
    },
    [],
  );
  const selected =
    source?.scene.objects.filter((object) => props.layout.sourceIds.includes(object.id)) ?? [];
  const bounds = combinedBBox(selected);
  if (source === null || bounds === null) return null;
  const apply = createRetainedArrayApply(
    props.layout,
    captured,
    source,
    props.onClose,
    owner,
    (value) => {
      setPreparing(value);
      if (!value) setProgress(undefined);
    },
    setError,
    (done, total) => setProgress({ done, total }),
  );
  return (
    <ArrayDialog
      title="Edit Array"
      actionLabel="Regenerate array"
      selectionBounds={bounds}
      scene={source.scene}
      selected={selected}
      initial={arrayFormFromSpec(props.layout.spec, bounds)}
      initialAdvanceVariables={
        props.layout.advanceVariables ?? props.layout.evaluationTime !== undefined
      }
      hasVariableText={selected.some((object) => objectVariableTemplate(object) !== undefined)}
      preparing={preparing}
      {...(progress === undefined ? {} : { progress })}
      {...(error === undefined ? {} : { errorMessage: error })}
      onApply={(spec, advanceVariables) => {
        void apply(spec, advanceVariables === true);
      }}
      onCancel={props.onClose}
    />
  );
}

function createRetainedArrayApply(
  layout: RetainedArrayLayout,
  captured: Project,
  source: Project,
  onClose: () => void,
  owner: { current: number },
  setPreparing: (value: boolean) => void,
  setError: (value: string | undefined) => void,
  setProgress: (done: number, total: number) => void,
): (spec: ArraySpec, advanceVariables: boolean) => Promise<void> {
  const apply = async (spec: ArraySpec, advanceVariables: boolean): Promise<void> => {
    const token = ++owner.current;
    const isCurrent = (): boolean =>
      owner.current === token && useStore.getState().project === captured;
    setPreparing(true);
    setError(undefined);
    try {
      const materialized = await prepareRetainedValues(
        source,
        layout,
        spec,
        advanceVariables,
        isCurrent,
        (done, total) => {
          if (owner.current === token) setProgress(done, total);
        },
      );
      if (!isCurrent()) return;
      if (materialized !== undefined && !materialized.ok) {
        setError(materialized.message);
        return;
      }
      const result = useStore.getState().regenerateArrayLayout(
        layout.id,
        spec,
        materialized?.ok === true ? materialized.materialized : undefined,
        captured,
        isCurrent,
        // Also closes once a regeneration held for Pro lands after unlock.
        onClose,
      );
      if (result !== null) setError(result);
    } catch (caught) {
      if (isCurrent()) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (owner.current === token) setPreparing(false);
    }
  };
  return apply;
}

async function prepareRetainedValues(
  source: Project,
  layout: RetainedArrayLayout,
  spec: ArraySpec,
  advanceVariables: boolean,
  isCurrent: () => boolean,
  onProgress: (done: number, total: number) => void,
): Promise<VariableArrayResult | undefined> {
  const evaluationTime = layout.evaluationTime;
  if (evaluationTime === undefined) return undefined;
  return prepareVariableArray(
    {
      project: source,
      selectedObjectId: layout.sourceIds[0] ?? null,
      additionalSelectedIds: new Set(layout.sourceIds.slice(1)),
    },
    spec,
    {
      // One parse per font, in slices that let Cancel through (performance audit S7-P2-1).
      render: batchVariableTextRenderer(),
      clock: () => new Date(evaluationTime),
      isCurrent,
      advanceVariables,
      yieldNow: variableCopySlices(),
      onProgress,
    },
  );
}
