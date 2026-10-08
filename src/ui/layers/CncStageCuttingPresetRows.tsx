import type { CncLayerSettings, CncTool, Layer } from '../../core/scene';
import type { CncStageRecipe } from '../../core/scene/cnc-stage-recipe';
import { CncFeedPresetRows } from './CncFeedPresetRows';

export function CncStageCuttingPresetRows(props: {
  readonly layer: Layer;
  readonly effective: CncLayerSettings;
  readonly tool: CncTool;
  readonly recipe: CncStageRecipe;
  readonly onChange: (recipe: CncStageRecipe) => void;
}): JSX.Element {
  const { cuttingPreset: _primaryPreset, ...settings } = props.effective;
  const stageSettings: CncLayerSettings = {
    ...settings,
    toolId: props.tool.id,
    ...(props.recipe.cuttingPreset === undefined
      ? {}
      : { cuttingPreset: props.recipe.cuttingPreset }),
  };
  return (
    <details>
      <summary title="Review saved cutting data for this stage’s cutter. Apply changes its independent feed, plunge, RPM and depth per pass.">
        Saved cutting data for this stage
      </summary>
      <p className="lf-cnc-settings-hint">
        Applying a record changes this stage's four independent cutting values. Stepover remains the
        operation's spacing; it is not copied by a stage Apply.
      </p>
      <CncFeedPresetRows
        layer={props.layer}
        settings={stageSettings}
        onCommit={(patch) =>
          props.onChange({
            ...props.recipe,
            feedMmPerMin: patch.feedMmPerMin ?? props.recipe.feedMmPerMin,
            plungeMmPerMin: patch.plungeMmPerMin ?? props.recipe.plungeMmPerMin,
            spindleRpm: patch.spindleRpm ?? props.recipe.spindleRpm,
            depthPerPassMm: patch.depthPerPassMm ?? props.recipe.depthPerPassMm,
            ...(patch.cuttingPreset === undefined ? {} : { cuttingPreset: patch.cuttingPreset }),
          })
        }
      />
    </details>
  );
}
