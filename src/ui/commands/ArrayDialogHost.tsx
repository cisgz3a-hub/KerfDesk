import { useEffect, useMemo, useRef, useState } from 'react';
import { combinedBBox, type ArraySpec, type Project } from '../../core/scene';
import { useStore } from '../state';
import type { ArrayActions } from '../state/array-actions';
import { sceneObjectCopyClosure } from '../state/scene-object-copy-dependencies';
import { prepareVariableArray } from '../state/prepare-variable-array';
import { renderVariableText } from '../text/render-variable-text';
import { ArrayDialog } from './ArrayDialog';
import { objectVariableTemplate } from '../../core/variables/object-variable-template';
import { rememberedArrayForm, type ArrayForm } from './array-dialog-form';

// Reopens with the settings last applied in this session (LightBurn gap
// LBG-T13), so adjusting an array is Undo, Array..., change, Create array.
let lastApplied: ArrayForm | null = null;

export function ArrayDialogHost(props: { readonly onClose: () => void }): JSX.Element | null {
  const project = useStore((state) => state.project);
  const epoch = useStore((state) => state.projectDocumentEpoch);
  const selectedObjectId = useStore((state) => state.selectedObjectId);
  const additionalSelectedIds = useStore((state) => state.additionalSelectedIds);
  const arraySelection = useStore((state) => state.arraySelection);
  const request = useRef(0);
  const submitted = useRef<ArrayForm | null>(null);
  const retainedName = useRef<string | undefined>(undefined);
  const [initial] = useState(() => lastApplied);
  const [preparing, setPreparing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );
  const selected = useMemo(
    () => selectedObjects(project, selectedObjectId, additionalSelectedIds),
    [project, selectedObjectId, additionalSelectedIds],
  );
  const bounds = useMemo(() => combinedBBox(selected), [selected]);
  if (bounds === null) return null;
  const close = (): void => {
    request.current += 1;
    props.onClose();
  };
  const applied = (): void => {
    if (submitted.current !== null) lastApplied = rememberedArrayForm(submitted.current);
    close();
  };
  const apply = async (spec: ArraySpec, advanceVariables = false): Promise<void> => {
    const owner = ++request.current;
    const retainedVariable = retainedVariableSelection(project, selected, retainedName.current);
    if (!advanceVariables && !retainedVariable) {
      arraySelection(
        spec,
        undefined,
        project,
        retainedName.current === undefined ? undefined : { name: retainedName.current },
        applied,
        () =>
          currentArrayRequest(request, owner, {
            project,
            projectDocumentEpoch: epoch,
            selectedObjectId,
            additionalSelectedIds,
          }),
      );
      return;
    }
    await applyVariableArray(spec, owner, {
      request,
      arraySelection,
      setPreparing,
      setErrorMessage,
      applied,
      retainedName: retainedName.current,
      advanceVariables,
    });
  };
  return (
    <ArrayDialog
      selectionBounds={bounds}
      scene={project.scene}
      selected={selected}
      {...(initial === null ? {} : { initial })}
      onSubmitForm={setCurrent(submitted)}
      onRetainChange={setCurrent(retainedName)}
      hasVariableText={selected.some((object) => objectVariableTemplate(object) !== undefined)}
      preparing={preparing}
      {...(errorMessage === undefined ? {} : { errorMessage })}
      onCancel={close}
      onApply={(spec, advanceVariables) => {
        void apply(spec, advanceVariables);
      }}
    />
  );
}

// Every copy's variable values are rendered before any is placed; a newer
// request, a closed dialog or a changed design drops the result.
async function applyVariableArray(
  spec: ArraySpec,
  owner: number,
  host: {
    readonly request: { readonly current: number };
    readonly arraySelection: ArrayActions['arraySelection'];
    readonly setPreparing: (preparing: boolean) => void;
    readonly setErrorMessage: (message: string | undefined) => void;
    readonly applied: () => void;
    readonly retainedName: string | undefined;
    readonly advanceVariables: boolean;
  },
): Promise<void> {
  const { request } = host;
  const captured = useStore.getState();
  const isCurrent = (): boolean => currentArrayRequest(request, owner, captured);
  host.setPreparing(true);
  host.setErrorMessage(undefined);
  try {
    const result = await prepareVariableArray(captured, spec, {
      render: renderVariableText,
      clock: () => new Date(),
      advanceVariables: host.advanceVariables,
      isCurrent,
    });
    if (request.current !== owner) return;
    host.setPreparing(false);
    if (!result.ok) {
      host.setErrorMessage(result.message);
      return;
    }
    if (!isCurrent()) return;
    host.arraySelection(
      spec,
      result.materialized,
      captured.project,
      host.retainedName === undefined
        ? undefined
        : { name: host.retainedName, advanceVariables: host.advanceVariables },
      host.applied,
      isCurrent,
    );
  } catch (error) {
    if (request.current !== owner) return;
    host.setPreparing(false);
    host.setErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

function selectedObjects(
  project: Project,
  primary: string | null,
  additional: ReadonlySet<string>,
) {
  const ids = new Set([...(primary === null ? [] : [primary]), ...additional]);
  return project.scene.objects.filter((object) => ids.has(object.id));
}

/** Test seam: forget the remembered settings. */
export function resetArrayDialogMemory(): void {
  lastApplied = null;
}

function retainedVariableSelection(
  project: Project,
  selected: Project['scene']['objects'],
  name: string | undefined,
): boolean {
  return (
    name !== undefined &&
    sceneObjectCopyClosure(
      project.scene.objects,
      new Set(selected.map((object) => object.id)),
    ).some((object) => objectVariableTemplate(object) !== undefined)
  );
}

function currentArrayRequest(
  request: { readonly current: number },
  owner: number,
  captured: {
    readonly project: Project;
    readonly projectDocumentEpoch: number;
    readonly selectedObjectId: string | null;
    readonly additionalSelectedIds: ReadonlySet<string>;
  },
): boolean {
  const current = useStore.getState();
  return (
    request.current === owner &&
    current.project === captured.project &&
    current.projectDocumentEpoch === captured.projectDocumentEpoch &&
    current.selectedObjectId === captured.selectedObjectId &&
    current.additionalSelectedIds === captured.additionalSelectedIds
  );
}

function setCurrent<T>(ref: { current: T }): (value: T) => void {
  return (value) => {
    ref.current = value;
  };
}
