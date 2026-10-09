import { useEffect, useState } from 'react';
import type { ImportedSvg } from '../../core/scene';
import { useStore } from '../state';
import { ConstrainedSketchDialog } from './ConstrainedSketchDialog';
export function ConstrainedSketchControls(
  props: { readonly mode?: 'edit' } = {},
): JSX.Element | null {
  const object = useStore((state) =>
    state.additionalSelectedIds.size === 0
      ? state.project.scene.objects.find((candidate) => candidate.id === state.selectedObjectId)
      : undefined,
  );
  const epoch = useStore((state) => state.projectDocumentEpoch);
  const [session, setSession] = useState<{
    readonly epoch: number;
    readonly source: ImportedSvg | undefined;
  } | null>(null);
  useEffect(() => {
    if (session !== null && session.epoch !== epoch) setSession(null);
  }, [session, epoch]);
  const source =
    object?.kind === 'imported-svg' && object.constrainedSketch !== undefined ? object : undefined;
  if (props.mode === 'edit' && source === undefined) return null;
  return (
    <>
      <button
        title="Create or edit retained sketch dimensions and geometric constraints"
        type="button"
        disabled={source?.locked === true}
        onClick={() => setSession({ epoch, source })}
      >
        {source === undefined ? 'Create constrained sketch…' : 'Edit constrained sketch…'}
      </button>
      {session !== null && session.epoch === epoch ? (
        <ConstrainedSketchDialog object={session.source} onClose={() => setSession(null)} />
      ) : null}
    </>
  );
}
