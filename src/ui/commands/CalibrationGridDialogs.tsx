import { generateIntervalTestGrid, type IntervalTestGridOptions } from '../../core/job';
import { generateMaterialTestAxesGrid } from '../../core/job/material-test-axes-grid';
import { insertMaterialTest } from '../../core/job/material-test-insertion';
import { confirmDiscardAsync } from '../app/confirm-discard';
import { usePlatform } from '../app/platform-context';
import { IntervalTestDialog } from '../calibration/IntervalTestDialog';
import { MaterialTestDialog } from '../calibration/MaterialTestDialog';
import type { MaterialTestRequest } from '../calibration/material-test-draft';
import { materialTestInsertionNotice } from '../calibration/material-test-notice';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';

export function IntervalDialog(props: { readonly onClose: () => void }): JSX.Element {
  const replaceSceneWithGeneratedScene = useStore((s) => s.replaceSceneWithGeneratedScene);
  const maxFeedMmPerMin = useStore((s) => s.project.device.maxFeed);
  const pushToast = useToastStore((s) => s.pushToast);
  const onGenerate = (options: IntervalTestGridOptions): void => {
    const grid = generateIntervalTestGrid({ ...options, maxFeedMmPerMin });
    replaceSceneWithGeneratedScene(grid.scene);
    props.onClose();
    pushToast(
      `Generated interval test grid (${grid.cells.length} swatches) at ${grid.cells[0]?.effectiveSpeed ?? 0} mm/min effective feed.`,
      'success',
    );
  };
  return (
    <IntervalTestDialog
      onCancel={props.onClose}
      onGenerate={onGenerate}
      maxFeedMmPerMin={maxFeedMmPerMin}
    />
  );
}

// A Material Test either joins the open design (ADR-381) or opens as a new
// project; it no longer replaces the design in place, so there is nothing to
// confirm before the dialog opens. Opening a new project asks to save first.
export function MaterialDialog(props: { readonly onClose: () => void }): JSX.Element {
  const platform = usePlatform();
  const maxFeedMmPerMin = useStore((s) => s.project.device.maxFeed);
  const pushToast = useToastStore((s) => s.pushToast);
  const onGenerate = (request: MaterialTestRequest): void => {
    const options = { ...request.options, maxFeedMmPerMin };
    if (request.placement === 'insert') {
      const state = useStore.getState();
      const result = insertMaterialTest(state.project.scene, state.project.device, options);
      if (result.kind === 'refused') {
        pushToast(result.reason, 'error');
        return;
      }
      state.insertGeneratedScene(result.scene, result.objectIds);
      props.onClose();
      const notice = materialTestInsertionNotice(result);
      pushToast(notice.message, notice.variant);
      return;
    }
    props.onClose();
    void confirmDiscardAsync(platform, 'open the material test as a new project').then((ok) => {
      if (!ok) return;
      const grid = generateMaterialTestAxesGrid(options);
      const state = useStore.getState();
      state.newProject();
      state.replaceSceneWithGeneratedScene(grid.scene);
      pushToast(
        `Opened a new project with the material test (${grid.cells.length} cells).`,
        'success',
      );
    });
  };
  return (
    <MaterialTestDialog
      onCancel={props.onClose}
      onGenerate={onGenerate}
      maxFeedMmPerMin={maxFeedMmPerMin}
    />
  );
}
