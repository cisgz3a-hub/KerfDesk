// CncKeptFeedsNotice — a bit chosen on the Artwork card keeps hand-edited
// cutting values exact (ADR-306, 2026-09-22 amendment). This note names the
// values kept from the previous bit and offers the material's starting values
// for the new one, where Machine Setup's Save warns about the same change with
// a toast (CNC audit v1 F4-P2-1). It leaves once the values or the bit change.

import { CHIPLOAD_MATERIALS } from '../../core/cnc';
import { layerCncTool, type CncLayerSettings, type CncMachineConfig } from '../../core/scene';
import { cncOperationKeptFeedsAfterToolChange } from '../common/cnc-bit-change-advisory';
import {
  feedUnitLabel,
  formatDisplayLength,
  formatLengthWithUnit,
  type DisplayLengthUnit,
} from '../display-length';
import { useStore } from '../state';
import { materialFeedsPatch } from '../state/cnc-project-material';
import { useLengthUnit } from '../state/display-units';

type CncCuttingValues = Pick<
  CncLayerSettings,
  'feedMmPerMin' | 'plungeMmPerMin' | 'spindleRpm' | 'depthPerPassMm'
>;

/** The values one bit change kept, and the material they last followed. */
export type CncKeptFeeds = {
  readonly layerId: string;
  readonly toolId: string | null;
  readonly values: CncCuttingValues;
  readonly materialKey: string | null;
};

export function cncKeptFeedsAfterBitChange(input: {
  readonly machine: CncMachineConfig;
  readonly layerId: string;
  readonly before: CncLayerSettings;
  readonly after: CncLayerSettings;
  readonly materialKey: string | null;
}): CncKeptFeeds | null {
  const kept = cncOperationKeptFeedsAfterToolChange({
    beforeMachine: input.machine,
    afterMachine: input.machine,
    before: input.before,
    after: input.after,
  });
  if (!kept) return null;
  return {
    layerId: input.layerId,
    toolId: input.after.toolId ?? null,
    values: cuttingValues(input.after),
    materialKey: input.materialKey,
  };
}

/** The note's first line; a remote bit change returns it as its receipt message. */
export function cncKeptFeedsMessage(
  kept: CncKeptFeeds,
  toolName: string,
  unit: DisplayLengthUnit,
): string {
  return `Bit changed. Kept from the previous bit: ${describeValues(kept.values, unit)}. Check them for ${toolName} before cutting.`;
}

export function CncKeptFeedsNotice(props: {
  readonly kept: CncKeptFeeds;
  readonly layerId: string;
  readonly settings: CncLayerSettings;
  readonly machine: CncMachineConfig;
  readonly onApply: (settings: CncLayerSettings) => void;
  readonly onDismiss: () => void;
}): JSX.Element | null {
  const unit = useLengthUnit();
  const profile = useStore((state) => state.project.device);
  const liveCaps = useStore((state) => state.cncLiveCaps);
  if (!keptFeedsCurrent(props.kept, props.layerId, props.settings)) return null;
  const tool = layerCncTool(props.machine, props.settings);
  const material = props.kept.materialKey;
  const patch =
    material === null
      ? null
      : materialFeedsPatch({
          materialKey: material,
          tool,
          spindleRpm: props.settings.spindleRpm,
          profile,
          machineParams: props.machine.params,
          liveCaps,
        });
  const recipe = patch === null ? null : recipeValues(patch);
  const name = material === null ? '' : materialName(material);
  return (
    <div className="lf-cnc-kept-feeds" role="status">
      <p>{cncKeptFeedsMessage(props.kept, tool.name, unit)}</p>
      <p>
        {recipe === null
          ? 'Choose a Material above for starting values for this bit.'
          : `${name} for this bit: ${describeValues(recipe, unit)}.`}
      </p>
      <div className="lf-cnc-kept-feeds__actions">
        {patch === null || recipe === null ? null : (
          <button
            type="button"
            className="lf-cnc-link-button"
            title={`Apply ${name} starting feed, plunge, spindle speed and depth per pass for this bit.`}
            onClick={() => props.onApply({ ...props.settings, ...patch })}
          >
            Use {name} values
          </button>
        )}
        <button
          type="button"
          className="lf-cnc-link-button"
          title="Keep the current cutting values and dismiss this note."
          onClick={props.onDismiss}
        >
          Keep these values
        </button>
      </div>
    </div>
  );
}

function keptFeedsCurrent(
  kept: CncKeptFeeds,
  layerId: string,
  settings: CncLayerSettings,
): boolean {
  const values = cuttingValues(settings);
  return (
    kept.layerId === layerId &&
    kept.toolId === (settings.toolId ?? null) &&
    settings.feedSource?.kind !== 'material-recipe' &&
    values.feedMmPerMin === kept.values.feedMmPerMin &&
    values.plungeMmPerMin === kept.values.plungeMmPerMin &&
    values.spindleRpm === kept.values.spindleRpm &&
    values.depthPerPassMm === kept.values.depthPerPassMm
  );
}

function cuttingValues(settings: CncLayerSettings): CncCuttingValues {
  return {
    feedMmPerMin: settings.feedMmPerMin,
    plungeMmPerMin: settings.plungeMmPerMin,
    spindleRpm: settings.spindleRpm,
    depthPerPassMm: settings.depthPerPassMm,
  };
}

function recipeValues(patch: Partial<CncLayerSettings>): CncCuttingValues | null {
  const { feedMmPerMin, plungeMmPerMin, spindleRpm, depthPerPassMm } = patch;
  if (
    feedMmPerMin === undefined ||
    plungeMmPerMin === undefined ||
    spindleRpm === undefined ||
    depthPerPassMm === undefined
  ) {
    return null;
  }
  return { feedMmPerMin, plungeMmPerMin, spindleRpm, depthPerPassMm };
}

function describeValues(values: CncCuttingValues, unit: DisplayLengthUnit): string {
  const feed = (mmPerMin: number): string =>
    `${formatDisplayLength(mmPerMin, unit)} ${feedUnitLabel(unit)}`;
  return [
    `feed ${feed(values.feedMmPerMin)}`,
    `plunge ${feed(values.plungeMmPerMin)}`,
    `spindle ${values.spindleRpm.toLocaleString('en-US')} RPM`,
    `depth per pass ${formatLengthWithUnit(values.depthPerPassMm, unit)}`,
  ].join(', ');
}

function materialName(key: string): string {
  return CHIPLOAD_MATERIALS.find((material) => material.value === key)?.label ?? key;
}
