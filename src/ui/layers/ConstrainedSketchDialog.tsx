import { useState } from 'react';
import type { ImportedSvg } from '../../core/scene';
import { Button, Dialog, DialogActions } from '../kit';
import { SketchParameterEditor } from './SketchParameterEditor';
import { SketchConstraintEditor } from './SketchConstraintEditor';
import { SketchGeometryEditor } from './SketchGeometryEditor';
import { SketchSolveReview } from './SketchSolveReview';
import { SketchDraftPreview } from './SketchDraftPreview';
import { sketchFromTemplate, type SketchTemplate } from './sketch-geometry-draft';
import { useConstrainedSketchDraft } from './use-constrained-sketch-draft';
import './design-authoring-dialog.css';
export function ConstrainedSketchDialog(props: {
  readonly object: ImportedSvg | undefined;
  readonly onClose: () => void;
}): JSX.Element {
  const draft = useConstrainedSketchDraft(props.object, props.onClose);
  const [template, setTemplate] = useState<SketchTemplate>('plate');
  return (
    <Dialog
      title="Constrained 2D sketch"
      size="xl"
      panelClassName="lf-authoring-dialog"
      onClose={props.onClose}
    >
      <p className="lf-authoring-intro">
        Create geometry, control it with dimensions and relations, then review the result.
      </p>
      <div className="lf-authoring-layout">
        <div className="lf-authoring-form">
          {props.object === undefined ? (
            <SketchTemplateSelector
              value={template}
              onChange={(next) => {
                setTemplate(next);
                draft.change(sketchFromTemplate(next));
              }}
            />
          ) : null}
          <label>
            Sketch name
            <input
              title="Name this constrained sketch"
              maxLength={120}
              value={draft.sketch.name}
              onChange={(e) => draft.change({ ...draft.sketch, name: e.currentTarget.value })}
            />
          </label>
          <SketchParameterEditor sketch={draft.sketch} onChange={draft.change} />
          <details>
            <summary title="Add or remove outlines, lines and circles">Sketch geometry</summary>
            <SketchGeometryEditor sketch={draft.sketch} onChange={draft.change} />
          </details>
          <details>
            <summary title="Edit the geometric relations used to solve this sketch">
              Constraint relations
            </summary>
            <SketchConstraintEditor sketch={draft.sketch} onChange={draft.change} />
          </details>
        </div>
        <aside className="lf-authoring-review" aria-label="Sketch geometry review">
          <h3>Geometry preview</h3>
          {draft.review === null ? <SketchDraftPreview sketch={draft.sketch} /> : null}
          <Button
            onClick={draft.solve}
            title="Solve the current constraints and review the resulting geometry"
          >
            Review solved geometry
          </Button>
          <SketchSolveReview result={draft.result} review={draft.review} stale={draft.stale} />
          {draft.error ? <p role="alert">{draft.error}</p> : null}
        </aside>
      </div>
      <SketchDialogActions
        editing={props.object !== undefined}
        draft={draft}
        onBake={draft.bake}
        onClose={props.onClose}
      />
    </Dialog>
  );
}

function SketchTemplateSelector({
  value,
  onChange,
}: {
  readonly value: SketchTemplate;
  readonly onChange: (template: SketchTemplate) => void;
}): JSX.Element {
  return (
    <label>
      Starting geometry
      <select
        title="Choose the initial sketch geometry"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value as SketchTemplate)}
      >
        <option value="plate">Mounting plate</option>
        <option value="rectangle">Rectangle</option>
        <option value="circle">Circle</option>
        <option value="custom">Custom sketch</option>
      </select>
    </label>
  );
}

function SketchDialogActions({
  editing,
  onBake,
  onClose,
  draft,
}: {
  readonly editing: boolean;
  readonly draft: ReturnType<typeof useConstrainedSketchDraft>;
  readonly onBake: () => void;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <DialogActions>
      {editing ? (
        <Button
          onClick={onBake}
          title="Keep the current visible vectors and remove their retained constraints"
        >
          Bake as vectors
        </Button>
      ) : null}
      <Button
        onClick={onClose}
        title="Close the sketch editor without applying an unreviewed solution"
      >
        Cancel
      </Button>
      {draft.review === null ? null : (
        <Button
          variant="primary"
          disabled={draft.stale}
          onClick={draft.apply}
          title="Apply the current reviewed constraint solution as visible geometry"
        >
          Apply reviewed sketch
        </Button>
      )}
    </DialogActions>
  );
}
