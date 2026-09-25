import { useEffect, useRef, useState } from 'react';
import { combinedBBox, type ArraySpec, type Project } from '../../core/scene';
import { useStore } from '../state';
import { prepareVariableArray } from '../state/prepare-variable-array';
import { renderVariableText } from '../text/render-variable-text';
import { ArrayDialog } from './ArrayDialog';
import { objectVariableTemplate } from '../../core/variables/object-variable-template';

export function ArrayDialogHost(props: { readonly onClose: () => void }): JSX.Element | null {
  const project = useStore((state) => state.project);
  const selectedObjectId = useStore((state) => state.selectedObjectId);
  const additionalSelectedIds = useStore((state) => state.additionalSelectedIds);
  const arraySelection = useStore((state) => state.arraySelection);
  const request = useRef(0);
  const [preparing, setPreparing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );
  const selected = selectedObjects(project, selectedObjectId, additionalSelectedIds);
  const bounds = combinedBBox(selected);
  if (bounds === null) return null;
  const close = (): void => {
    request.current += 1;
    props.onClose();
  };
  const apply = async (spec: ArraySpec, advanceVariables = false): Promise<void> => {
    const owner = ++request.current;
    if (!advanceVariables) {
      arraySelection(spec);
      close();
      return;
    }
    const captured = useStore.getState();
    const isCurrent = (): boolean => {
      const current = useStore.getState();
      return (
        request.current === owner &&
        current.project === captured.project &&
        current.projectDocumentEpoch === captured.projectDocumentEpoch &&
        current.selectedObjectId === captured.selectedObjectId &&
        current.additionalSelectedIds === captured.additionalSelectedIds
      );
    };
    setPreparing(true);
    setErrorMessage(undefined);
    try {
      const result = await prepareVariableArray(captured, spec, {
        render: renderVariableText,
        clock: () => new Date(),
        isCurrent,
      });
      if (request.current !== owner) return;
      setPreparing(false);
      if (!result.ok) {
        setErrorMessage(result.message);
        return;
      }
      if (!isCurrent()) return;
      arraySelection(spec, result.materialized, captured.project);
      close();
    } catch (error) {
      if (request.current !== owner) return;
      setPreparing(false);
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <ArrayDialog
      selectionBounds={bounds}
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

function selectedObjects(
  project: Project,
  primary: string | null,
  additional: ReadonlySet<string>,
) {
  const ids = new Set([...(primary === null ? [] : [primary]), ...additional]);
  return project.scene.objects.filter((object) => ids.has(object.id));
}
