import { useId, useState } from 'react';
import { CHIPLOAD_MATERIALS } from '../../core/cnc';
import { cncStageRecipe } from '../../core/cnc/cnc-stage-settings';
import type { CncCuttingStage } from '../../core/scene/cnc-stage-recipe';
import {
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type Layer,
} from '../../core/scene';
import { CncMaterialOptions } from '../common/CncMaterialOptions';
import { MANUAL_FEEDS_LABEL } from '../common/cnc-material-vocabulary';
import { openMachineSetup } from '../laser/device-setup';
import { useStore } from '../state';
import { cncOperationMaterialKey } from '../state/cnc-feed-provenance';
import {
  cncOperationWithMaterialBinding,
  cncSettingsAfterOperationChoice,
  type CncOperationChoice,
} from '../state/cnc-operation-choice';
import {
  cncStartupOperationDraft,
  type CncStartupOperationDraft,
} from '../state/cnc-startup-setup';
import {
  cncKeptFeedsAfterBitChange,
  CncKeptFeedsNotice,
  type CncKeptFeeds,
} from './CncKeptFeedsNotice';
import { CncOperationToolSelect } from './CncOperationToolSelect';

type BindingPatch = CncOperationChoice;
const JOB_MATERIAL_VALUE = '__job-material__';

type OperationToolProps = {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly hasReliefObjects: boolean;
  /** The material a hand edit or Manual last took off this operation, or null. */
  readonly editedFromMaterialKey: string | null;
  readonly onCommitSettings: (settings: CncLayerSettings, replaceFeedDrafts: boolean) => void;
};

/**
 * The operation's bit, the second bit its cut type can use, and its material
 * (ADR-481). Assignments share the exact transform used by Machine Setup's tool plan.
 */
export function CncOperationToolFields(props: OperationToolProps): JSX.Element | null {
  const machine = useStore((state) => state.project.machine);
  const profile = useStore((state) => state.project.device);
  const liveCaps = useStore((state) => state.cncLiveCaps);
  const [keptFeeds, setKeptFeeds] = useState<CncKeptFeeds | null>(null);
  if (machine?.kind !== 'cnc') return null;
  const draft = cncStartupOperationDraft(
    cncOperationWithMaterialBinding(props.layer, props.settings),
  );
  const jobDefault = machine.tools.find((tool) => tool.id === machine.toolId);
  const commit = (patch: BindingPatch): void => {
    const next = cncSettingsAfterOperationChoice({
      layer: props.layer,
      settings: props.settings,
      machine,
      profile,
      liveCaps,
      choice: patch,
    });
    if (next === null) return;
    // A primary bit that keeps hand-edited values says so (CNC audit v1 F4-P2-1).
    if ('toolId' in patch) {
      setKeptFeeds(
        cncKeptFeedsAfterBitChange({
          machine,
          layerId: props.layer.id,
          before: props.settings,
          after: next,
          materialKey: cncOperationMaterialKey(props.settings) ?? props.editedFromMaterialKey,
        }),
      );
    }
    props.onCommitSettings(next, 'materialKey' in patch || 'toolId' in patch);
  };
  return (
    <section className="lf-cnc-settings-card" aria-label="Bit and material">
      <CncOperationToolSelect
        label="Bit"
        ariaLabel={`Bit for ${props.layer.color}`}
        value={draft.toolId}
        emptyLabel={
          jobDefault === undefined ? 'Use job default bit' : `Job default: ${jobDefault.name}`
        }
        tools={machine.tools}
        allTools={machine.tools}
        defaultTool={jobDefault}
        description="The cutter for this operation. Job default follows the default bit in Machine Setup."
        action={<ManageBitsButton />}
        onChange={(toolId) => commit({ toolId })}
      />
      <CncSecondaryToolFields {...props} machine={machine} draft={draft} onChange={commit} />
      <CncOperationMaterialField
        layer={props.layer}
        machine={machine}
        value={draft.materialKey}
        onChange={(materialKey) => commit({ materialKey })}
      />
      {keptFeeds === null ? null : (
        <CncKeptFeedsNotice
          kept={keptFeeds}
          layerId={props.layer.id}
          settings={props.settings}
          machine={machine}
          onApply={(settings) => props.onCommitSettings(settings, true)}
          onDismiss={() => setKeptFeeds(null)}
        />
      )}
    </section>
  );
}

// The bit library (catalog and custom bits) lives in Machine Setup.
function ManageBitsButton(): JSX.Element {
  return (
    <button
      type="button"
      className="lf-cnc-link-button"
      title="Add a bit from the catalog or enter your own in the Machine Setup bit library."
      onClick={() => openMachineSetup({ kind: 'cnc', field: 'bit-library' })}
    >
      Manage bits
    </button>
  );
}

function CncOperationMaterialField(props: {
  readonly layer: Layer;
  readonly machine: CncMachineConfig;
  readonly value: string | null;
  readonly onChange: (materialKey: string | null) => void;
}): JSX.Element {
  const jobMaterial = props.machine.stock.materialKey;
  const known =
    props.value === null || CHIPLOAD_MATERIALS.some((item) => item.value === props.value);
  const id = useId();
  return (
    <div className="lf-cnc-tool-field">
      <div className="lf-cnc-tool-field__label">
        <label htmlFor={id}>Material</label>
      </div>
      <select
        id={id}
        value={props.value ?? ''}
        aria-label={`Material for ${props.layer.color}`}
        title="Choosing a material applies its starting feed, plunge, spindle speed and depth per pass, and a new bit refreshes them. Editing one of those values sets this to Manual, which keeps your numbers when the bit changes."
        onChange={(event) => {
          const value = event.target.value;
          props.onChange(value === JOB_MATERIAL_VALUE ? (jobMaterial ?? null) : value || null);
        }}
      >
        <option value="">{MANUAL_FEEDS_LABEL}</option>
        {jobMaterial === undefined ? null : (
          <option value={JOB_MATERIAL_VALUE}>Use job material ({materialName(jobMaterial)})</option>
        )}
        {!known ? (
          <option value={props.value ?? ''}>Current material ({props.value})</option>
        ) : null}
        <CncMaterialOptions />
      </select>
    </div>
  );
}

function CncSecondaryToolFields(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly hasReliefObjects: boolean;
  readonly machine: CncMachineConfig;
  readonly draft: CncStartupOperationDraft;
  readonly onChange: (patch: BindingPatch) => void;
}): JSX.Element {
  const { machine, settings, draft } = props;
  const flatTools = machine.tools.filter((tool) => tool.kind === 'end-mill');
  const primary = layerCncTool(machine, settings);
  const roughers = flatTools.filter((tool) => tool.diameterMm > primary.diameterMm);
  return (
    <>
      {settings.cutType === 'v-carve' && (settings.vCarveFlatDepthEnabled ?? true) ? (
        <CncOperationToolSelect
          label="Floor clearing bit"
          ariaLabel={`Clearing bit for ${props.layer.color}`}
          value={draft.vClearToolId}
          emptyLabel="Single stage (V-bit only)"
          tools={flatTools}
          allTools={machine.tools}
          description="A flat bit that clears the floor where the V-bit cannot reach. Single stage cuts with the V-bit only."
          hint={secondaryFeedHint(settings, machine, 'v-clear', draft.vClearToolId)}
          onChange={(vClearToolId) => props.onChange({ vClearToolId })}
        />
      ) : null}
      {settings.cutType === 'pocket' && settings.pocketStrategy !== 'adaptive' ? (
        <CncOperationToolSelect
          label="Pocket roughing bit"
          ariaLabel={`Pocket roughing bit for ${props.layer.color}`}
          value={draft.pocketRoughToolId}
          emptyLabel="Single bit"
          tools={roughers}
          allTools={machine.tools}
          description="A larger bit that clears most of the pocket before this operation's bit cuts the edges."
          hint={secondaryFeedHint(settings, machine, 'pocket-rough', draft.pocketRoughToolId)}
          onChange={(pocketRoughToolId) => props.onChange({ pocketRoughToolId })}
        />
      ) : null}
      {props.hasReliefObjects ? (
        <CncOperationToolSelect
          label="Relief finishing bit"
          ariaLabel={`Relief finishing bit for ${props.layer.color}`}
          value={draft.reliefFinishToolId}
          emptyLabel="Roughing only"
          tools={machine.tools}
          allTools={machine.tools}
          description="A bit that follows the relief surface after roughing. Roughing only skips the finishing pass."
          hint={secondaryFeedHint(settings, machine, 'relief-finish', draft.reliefFinishToolId)}
          onChange={(reliefFinishToolId) => props.onChange({ reliefFinishToolId })}
        />
      ) : null}
    </>
  );
}

function secondaryFeedHint(
  settings: CncLayerSettings,
  machine: CncMachineConfig,
  stage: CncCuttingStage,
  toolId: string | null,
): string {
  const tool = machine.tools.find((candidate) => candidate.id === toolId);
  const independent = tool !== undefined && cncStageRecipe(settings, stage, tool) !== undefined;
  const values =
    stage === 'relief-finish' ? 'feed, plunge and RPM' : 'feed, plunge, RPM and depth per pass';
  const recipeHint = independent
    ? `Uses separate ${values} for this bit. Edit them in Stage cutting values.`
    : `Uses the primary bit's ${values}. Set separate values in Stage cutting values.`;
  return stage === 'relief-finish'
    ? `${recipeHint} Relief finishing follows the surface and scallop setting; depth per pass does not apply.`
    : recipeHint;
}

function materialName(key: string): string {
  return CHIPLOAD_MATERIALS.find((material) => material.value === key)?.label ?? key;
}
