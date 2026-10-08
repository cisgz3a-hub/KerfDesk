import { useEffect, useState } from 'react';
import { isBooleanCompoundObject, type BooleanCompound } from '../../core/scene/boolean-compound';
import type { ImportedSvg, Project } from '../../core/scene';
import { BooleanCompoundEditor } from '../commands/BooleanCompoundEditor';
import { useStore } from '../state';
import { IconButton } from '../kit';

type Session = {
  readonly object: ImportedSvg & { readonly booleanCompound: BooleanCompound };
  readonly project: Project;
  readonly epoch: number;
};
export function BooleanCompoundControls(): JSX.Element | null {
  const project = useStore((state) => state.project);
  const selected = useStore((state) => state.selectedObjectId);
  const additional = useStore((state) => state.additionalSelectedIds);
  const epoch = useStore((state) => state.projectDocumentEpoch);
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    if (session !== null && (session.epoch !== epoch || session.object.id !== selected))
      setSession(null);
  }, [epoch, selected, session]);
  const object = project.scene.objects.find((item) => item.id === selected);
  if (object === undefined || !isBooleanCompoundObject(object) || additional.size !== 0)
    return null;
  return (
    <>
      <IconButton
        icon="nodes"
        label="Edit compound sources"
        title="Edit retained source geometry and reevaluate this compound as one undo step."
        disabled={object.locked === true}
        onClick={() => setSession({ object, project, epoch })}
      />
      <IconButton
        icon="layers"
        label="Expand compound"
        title="Convert this compound to ordinary editable result paths. Undo restores its retained sources."
        disabled={object.locked === true}
        onClick={() => useStore.getState().expandBooleanCompound(object.id, project)}
      />
      {session === null ? null : (
        <BooleanCompoundEditor
          object={session.object}
          project={session.project}
          epoch={session.epoch}
          close={() => setSession(null)}
        />
      )}
    </>
  );
}
