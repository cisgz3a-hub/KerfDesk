// Mounts the Optimize Shapes dialog (LightBurn gap LBG-T22) while it is open.
// It reopens with the settings last applied in this session.

import { useCallback, useMemo, useState } from 'react';
import { useStore } from '../state';
import { optimizeShapesSelection } from '../state/optimize-shapes-plan';
import { selectedObjectIds } from '../state/scene-group-actions';
import { useOptimizeShapesDialogStore } from './optimize-shapes-dialog-store';
import { OptimizeShapesDialog } from './OptimizeShapesDialog';
import { DEFAULT_OPTIMIZE_SHAPES_FORM, type OptimizeShapesForm } from './OptimizeShapesFields';

let lastApplied: OptimizeShapesForm | null = null;

export function OptimizeShapesDialogHost(): JSX.Element | null {
  const open = useOptimizeShapesDialogStore((state) => state.open);
  return open ? <OpenOptimizeShapesDialog /> : null;
}

function OpenOptimizeShapesDialog(): JSX.Element {
  const close = useOptimizeShapesDialogStore((state) => state.close);
  const scene = useStore((state) => state.project.scene);
  const selectedObjectId = useStore((state) => state.selectedObjectId);
  const additionalSelectedIds = useStore((state) => state.additionalSelectedIds);
  const optimizeSelectedShapes = useStore((state) => state.optimizeSelectedShapes);
  const selection = useMemo(
    () =>
      optimizeShapesSelection(
        scene,
        selectedObjectIds({ selectedObjectId, additionalSelectedIds }),
      ),
    [scene, selectedObjectId, additionalSelectedIds],
  );
  const [initial] = useState(() => lastApplied ?? DEFAULT_OPTIMIZE_SHAPES_FORM);
  const onApply = useCallback<React.ComponentProps<typeof OptimizeShapesDialog>['onApply']>(
    (options, plan, form) => {
      optimizeSelectedShapes(options, plan);
      lastApplied = form;
      close();
    },
    [optimizeSelectedShapes, close],
  );
  return (
    <OptimizeShapesDialog
      targets={selection.targets}
      locked={selection.locked}
      initial={initial}
      onCancel={close}
      onApply={onApply}
    />
  );
}

/** Test seam: forget the remembered settings. */
export function resetOptimizeShapesDialogMemory(): void {
  lastApplied = null;
}
