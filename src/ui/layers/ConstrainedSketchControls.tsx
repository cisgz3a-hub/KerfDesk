import { useState } from 'react';
import { useStore } from '../state';
import { ConstrainedSketchDialog } from './ConstrainedSketchDialog';
export function ConstrainedSketchControls(): JSX.Element {
  const object = useStore((state) =>
    state.project.scene.objects.find((candidate) => candidate.id === state.selectedObjectId),
  );
  const [open, setOpen] = useState(false);
  const source =
    object?.kind === 'imported-svg' && object.constrainedSketch !== undefined ? object : undefined;
  return (
    <>
      <button
        title="Create or edit retained sketch dimensions and geometric constraints"
        type="button"
        disabled={source?.locked === true}
        onClick={() => setOpen(true)}
      >
        {source === undefined ? 'Create constrained sketch…' : 'Edit constrained sketch…'}
      </button>
      {open ? (
        <ConstrainedSketchDialog
          key={source?.id ?? 'new'}
          object={source}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
