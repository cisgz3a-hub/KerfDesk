import {
  generateIntervalTestGrid,
  generateMaterialTestGrid,
  type IntervalTestGridOptions,
  type MaterialTestGrid,
  type MaterialTestGridOptions,
} from '../../core/job';
import type { MaterialTestParameter } from '../../core/job/material-test-axes';
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
  const accelMmPerSec2 = useStore((s) => s.project.device.accelMmPerSec2);
  const pushToast = useToastStore((s) => s.pushToast);
  const onGenerate = (options: MaterialTestGridOptions): void => {
    const grid = generateMaterialTestGrid({ ...options, maxFeedMmPerMin, accelMmPerSec2 });
    replaceSceneWithGeneratedScene(grid.scene);
    props.onClose();
    pushToast(materialTestSummary(grid), 'success');
  };
  return (
    <MaterialTestDialog
      onCancel={props.onClose}
      onGenerate={onGenerate}
      maxFeedMmPerMin={maxFeedMmPerMin}
      accelMmPerSec2={accelMmPerSec2}
    />
  );
}

// ADR-497: what the grid varies, in the toast after Generate.
function materialTestSummary(grid: MaterialTestGrid): string {
  const kind = grid.mode === 'line' ? 'cut test grid' : 'material test grid';
  const axes =
    `${PARAMETER_WORDS[grid.rowParameter]} by row, ` +
    `${PARAMETER_WORDS[grid.columnParameter]} by column`;
  const effectiveFeeds = [...new Set(grid.cells.map((cell) => cell.effectiveSpeed))];
  return (
    `Generated ${kind} (${grid.cells.length} cells): ${axes}, with effective feeds ` +
    `${effectiveFeeds.join(' / ')} mm/min.`
  );
}

const PARAMETER_WORDS: Readonly<Record<MaterialTestParameter, string>> = {
  speed: 'speed',
  power: 'power',
  passes: 'passes',
  interval: 'hatch spacing',
};
