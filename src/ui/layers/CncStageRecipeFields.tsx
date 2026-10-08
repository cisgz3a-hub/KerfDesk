import { CncStageCuttingPresetRows } from './CncStageCuttingPresetRows';
import { cncSettingsForStage, cncStageRecipe } from '../../core/cnc/cnc-stage-settings';
import { nominalChiploadMm } from '../../core/cnc/nominal-chipload';
import {
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Layer,
} from '../../core/scene';
import type { CncCuttingStage, CncStageRecipe } from '../../core/scene/cnc-stage-recipe';
import { RailSection } from '../kit';
import { useStore } from '../state';
import { materialFeedsPatch } from '../state/cnc-project-material';
import { NumberField } from './CncLayerPrimitives';

type Stage = { readonly id: CncCuttingStage; readonly label: string; readonly tool: CncTool };
type Props = {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly hasReliefObjects: boolean;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
};

export function CncStageRecipeFields(props: Props): JSX.Element | null {
  const machine = useStore((s) => s.project.machine);
  if (machine?.kind !== 'cnc') return null;
  const stages = stagesFor(props.settings, machine, props.hasReliefObjects);
  if (stages.length === 0) return null;
  return (
    <RailSection
      label="Stage cutting values"
      hint="Give clearing and finishing their own feed, plunge, spindle speed and depth passes."
    >
      <p className="lf-cnc-settings-hint">
        Stages share the operation values until you enable separate values. Separate values stay
        manual when material changes and belong to the selected cutter.
      </p>
      {stages.map((stage) => (
        <StageFields key={`${stage.id}:${stage.tool.id}`} {...props} stage={stage} />
      ))}
    </RailSection>
  );
}

function useStageValues(props: Props & { readonly stage: Stage }) {
  const { stage, settings } = props;
  const machine = useStore((s) => s.project.machine);
  const profile = useStore((s) => s.project.device);
  const liveCaps = useStore((s) => s.cncLiveCaps);
  const recipe = cncStageRecipe(settings, stage.id, stage.tool);
  const effective = cncSettingsForStage(settings, stage.id, stage.tool);
  const setRecipe = (value: CncStageRecipe | undefined): void => {
    const next = Object.fromEntries(
      Object.entries(settings.stageRecipes ?? {}).filter(([key]) => key !== stage.id),
    );
    if (value !== undefined) next[stage.id] = value;
    props.onCommit({ stageRecipes: next });
  };
  const seed: CncStageRecipe = recipe ?? {
    toolId: stage.tool.id,
    feedMmPerMin: settings.feedMmPerMin,
    plungeMmPerMin: settings.plungeMmPerMin,
    spindleRpm: settings.spindleRpm,
    depthPerPassMm: stage.id === 'profile-finish' ? settings.depthMm : settings.depthPerPassMm,
  };
  const patch = (value: Partial<CncStageRecipe>): void => setRecipe({ ...seed, ...value });
  const material =
    settings.materialKey ??
    (settings.feedSource?.kind === 'material-recipe' ? settings.feedSource.materialKey : undefined);
  const starter =
    machine?.kind === 'cnc' && material !== undefined
      ? materialFeedsPatch({
          materialKey: material,
          tool: stage.tool,
          spindleRpm: effective.spindleRpm,
          profile,
          machineParams: machine.params,
          liveCaps,
        })
      : null;
  const chipload =
    stage.tool.fluteCount === undefined
      ? null
      : nominalChiploadMm(effective.feedMmPerMin, effective.spindleRpm, stage.tool.fluteCount);
  return { recipe, effective, setRecipe, seed, starter, patch, chipload };
}

function StageFields(props: Props & { readonly stage: Stage }): JSX.Element {
  const { stage, settings } = props;
  const { recipe, effective, setRecipe, seed, starter, patch, chipload } = useStageValues(props);
  return (
    <fieldset>
      <legend>
        {stage.label}: {stage.tool.name}
      </legend>
      <label>
        <input
          type="checkbox"
          checked={recipe !== undefined}
          onChange={(event) => setRecipe(event.target.checked ? seed : undefined)}
          title={`Use independent cutting values for ${stage.label.toLowerCase()} with ${stage.tool.name}. Turn off to share the operation values.`}
        />
        Separate values for {stage.label.toLowerCase()}
      </label>
      {settings.stageRecipes?.[stage.id] !== undefined && recipe === undefined ? (
        <p role="note">
          Saved values belong to a different cutter. This stage currently uses the operation values.
        </p>
      ) : null}
      <p className="lf-cnc-settings-hint">
        {effective.feedMmPerMin} mm/min feed, {effective.plungeMmPerMin} mm/min plunge,{' '}
        {effective.spindleRpm} RPM
        {chipload === null
          ? '. Set the actual flute count in the bit library to calculate nominal chipload.'
          : `; nominal chipload ${chipload.toFixed(4)} mm/tooth before machine feed limits.`}
      </p>
      {recipe !== undefined ? (
        <>
          {(['feedMmPerMin', 'plungeMmPerMin', 'spindleRpm', 'depthPerPassMm'] as const)
            .filter((key) => !stage.id.startsWith('relief-') || key !== 'depthPerPassMm')
            .map((key) => (
              <NumberField
                key={key}
                layer={props.layer}
                label={`${stage.label} ${RECIPE_FIELDS[key].label}`}
                unit={RECIPE_FIELDS[key].unit}
                value={recipe[key]}
                positiveOnly
                step={RECIPE_FIELDS[key].step}
                title={`Independent ${RECIPE_FIELDS[key].label.toLowerCase()} for ${stage.tool.name}. Machine limits still apply to output.`}
                onCommit={(value) => patch({ [key]: value })}
              />
            ))}
          <CncStageCuttingPresetRows
            layer={props.layer}
            effective={effective}
            tool={stage.tool}
            recipe={recipe}
            onChange={setRecipe}
          />
          <button
            type="button"
            disabled={starter === null}
            title={
              starter === null
                ? `Choose a supported operation material to calculate starting values for ${stage.tool.name}.`
                : `Apply material starting values for ${stage.tool.name} to ${stage.label.toLowerCase()}.`
            }
            onClick={() => {
              if (starter === null) return;
              patch({
                feedMmPerMin: starter.feedMmPerMin ?? seed.feedMmPerMin,
                plungeMmPerMin: starter.plungeMmPerMin ?? seed.plungeMmPerMin,
                spindleRpm: starter.spindleRpm ?? seed.spindleRpm,
                depthPerPassMm: starter.depthPerPassMm ?? seed.depthPerPassMm,
              });
            }}
          >
            Use material starting values for {stage.label.toLowerCase()}
          </button>
        </>
      ) : null}
      <ProfileStageNote stage={stage.id} />
    </fieldset>
  );
}

const RECIPE_FIELDS = {
  feedMmPerMin: { label: 'feed', unit: 'mm/min', step: 50 },
  plungeMmPerMin: { label: 'plunge', unit: 'mm/min', step: 25 },
  spindleRpm: { label: 'spindle speed', unit: 'RPM', step: 500 },
  depthPerPassMm: { label: 'depth per pass', unit: 'mm', step: 0.1 },
} as const;

function stagesFor(
  settings: CncLayerSettings,
  machine: CncMachineConfig,
  hasRelief: boolean,
): Stage[] {
  const stages: Stage[] = [];
  const add = (id: CncCuttingStage, label: string, toolId: string | undefined): void => {
    const tool = machine.tools.find((candidate) => candidate.id === toolId);
    if (tool !== undefined) stages.push({ id, label, tool });
  };
  if (
    settings.cutType === 'pocket' &&
    settings.pocketStrategy !== 'adaptive' &&
    settings.helixEntry === undefined
  )
    add('pocket-rough', 'Pocket roughing', settings.pocketRoughToolId);
  if (settings.cutType === 'v-carve' && (settings.vCarveFlatDepthEnabled ?? true))
    add('v-clear', 'V-carve clearing', settings.vClearToolId);
  if (hasRelief) {
    add('relief-finish', 'Relief finishing', settings.reliefFinishToolId);
    add('relief-rest-finish', 'Relief rest finishing', settings.reliefRestFinishToolId);
  }
  if (
    (settings.cutType === 'profile-inside' || settings.cutType === 'profile-outside') &&
    (settings.finishAllowanceMm ?? 0) > 0
  )
    stages.push({
      id: 'profile-finish',
      label: 'Wall finishing',
      tool: layerCncTool(machine, settings),
    });
  return stages;
}

function ProfileStageNote(props: { readonly stage: CncCuttingStage }): JSX.Element | null {
  return props.stage === 'profile-finish' ? (
    <p className="lf-cnc-settings-hint">
      A finish depth per pass smaller than the cut depth makes several true-wall passes, keeping
      tabs and part order.
    </p>
  ) : null;
}
