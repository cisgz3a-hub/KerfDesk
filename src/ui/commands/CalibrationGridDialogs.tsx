import {
  generateIntervalTestGrid,
  generateMaterialTestGrid,
  type IntervalTestGridOptions,
  type MaterialTestGridOptions,
} from '../../core/job';
import { IntervalTestDialog } from '../calibration/IntervalTestDialog';
import { MaterialTestDialog } from '../calibration/MaterialTestDialog';
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

export function MaterialDialog(props: { readonly onClose: () => void }): JSX.Element {
  const replaceSceneWithGeneratedScene = useStore((s) => s.replaceSceneWithGeneratedScene);
  const maxFeedMmPerMin = useStore((s) => s.project.device.maxFeed);
  const pushToast = useToastStore((s) => s.pushToast);
  const onGenerate = (options: MaterialTestGridOptions): void => {
    const grid = generateMaterialTestGrid({ ...options, maxFeedMmPerMin });
    replaceSceneWithGeneratedScene(grid.scene);
    props.onClose();
    const effectiveFeeds = [...new Set(grid.cells.map((cell) => cell.effectiveSpeed))];
    pushToast(
      `Generated material test grid (${grid.cells.length} cells) with effective feeds ${effectiveFeeds.join(' / ')} mm/min.`,
      'success',
    );
  };
  return (
    <MaterialTestDialog
      onCancel={props.onClose}
      onGenerate={onGenerate}
      maxFeedMmPerMin={maxFeedMmPerMin}
    />
  );
}
