// Optimize Shapes dialog (LightBurn gap LBG-T22). A line under the settings
// says how many points become how many segments and how far anything moves,
// from the same plan Apply carries out. Applying while the line is still being
// worked out waits for it, so what is applied is what the line says.

import { useEffect, useMemo, useState } from 'react';
import type { ShapeOptimizeOptions } from '../../core/geometry/shape-optimize/shape-optimize-options';
import type { VectorSceneObject } from '../../core/geometry/vector-path-tools';
import { Button } from '../kit/Button';
import { Dialog, DialogActions } from '../kit/Dialog';
import { optimizeShapesStatus } from '../state/optimize-shapes-notice';
import { optimizedSceneObject, type OptimizeShapesPlan } from '../state/optimize-shapes-plan';
import { isVectorPathObject } from '../../core/geometry';
import { VectorComparisonPreview } from './VectorComparisonPreview';
import {
  FitFields,
  SmoothFields,
  optionsFromForm,
  optimizeFormProblem,
  type OptimizeShapesForm,
} from './OptimizeShapesFields';
import {
  useOptimizeShapesPreview,
  type OptimizeShapesPreview,
} from './use-optimize-shapes-preview';

export function OptimizeShapesDialog(props: {
  /** Unlocked vector artwork in the selection. */
  readonly targets: ReadonlyArray<VectorSceneObject>;
  readonly locked: number;
  readonly initial: OptimizeShapesForm;
  readonly onCancel: () => void;
  readonly onApply: (
    options: ShapeOptimizeOptions,
    plan: OptimizeShapesPlan | null,
    form: OptimizeShapesForm,
  ) => void;
}): JSX.Element {
  const [form, setForm] = useState(props.initial);
  const [applying, setApplying] = useState(false);
  const options = useMemo(() => optionsFromForm(form), [form]);
  const problem = optimizeFormProblem(form);
  const nothingOn = !form.smooth && !form.fit;
  const preview = useOptimizeShapesPreview(props.targets, options);
  const after = useMemo(
    () =>
      preview.kind === 'ready' && problem === null
        ? preview.plan.objects.flatMap((entry) => {
            const object = optimizedSceneObject(entry) ?? entry.source;
            return isVectorPathObject(object) ? [object] : [];
          })
        : [],
    [preview, problem],
  );
  const { onApply } = props;
  useEffect(() => {
    if (applying && problem === null && preview.kind === 'ready')
      onApply(options, preview.plan, form);
  }, [applying, preview, options, form, onApply, problem]);
  const onChange = (patch: Partial<OptimizeShapesForm>): void => {
    setApplying(false);
    setForm((current) => ({ ...current, ...patch }));
  };
  return (
    <Dialog
      title="Optimize Shapes"
      size="sm"
      as="form"
      onClose={props.onCancel}
      onSubmit={(event) => {
        event.preventDefault();
        if (!nothingOn && problem === null) setApplying(true);
      }}
    >
      <div style={fieldsStyle}>
        <SmoothFields form={form} onChange={onChange} />
        <FitFields form={form} onChange={onChange} />
      </div>
      <VectorComparisonPreview
        before={props.targets}
        after={after}
        label="Optimize Shapes before and after"
      />
      <p role="status" aria-live="polite" style={statusStyle}>
        {problem ??
          (nothingOn
            ? 'Turn on Smooth or Fit to change the outlines.'
            : statusText(preview, props.locked))}
      </p>
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button
          variant="primary"
          type="submit"
          disabled={nothingOn || applying || problem !== null}
        >
          {applying ? 'Optimizing...' : 'Optimize'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Past this, the status says how long the work took; Apply reuses it at once.
const SLOW_MS = 1000;

function statusText(preview: OptimizeShapesPreview, locked: number): string {
  if (preview.kind === 'ready') {
    const status = optimizeShapesStatus(preview.plan, locked);
    if (preview.busyMs < SLOW_MS) return status;
    return `${status} Worked out in ${(preview.busyMs / 1000).toFixed(1)} s.`;
  }
  const percent = Math.floor(preview.progress * 100);
  return percent > 0 ? `Working it out... ${percent}%` : 'Working it out...';
}

const fieldsStyle: React.CSSProperties = { display: 'grid', gap: 14, marginBottom: 10 };
const statusStyle: React.CSSProperties = { fontSize: 13, minHeight: '2.6em' };
