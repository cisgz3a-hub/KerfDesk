import { CHIPLOAD_MATERIALS } from '../../core/cnc';
import {
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type Layer,
} from '../../core/scene';
import { CncMaterialOptions } from '../common/CncMaterialOptions';
import { MANUAL_FEEDS_LABEL } from '../common/cnc-material-vocabulary';
import { CncToolPicture } from '../machine/CncToolPicture';
import { useStore } from '../state';
import {
  cncStartupOperationDraft,
  sceneWithCncStartupOperationDrafts,
  type CncStartupOperationDraft,
} from '../state/cnc-startup-setup';
import { CncOperationToolSelect } from './CncOperationToolSelect';
import { CncOperationBitLibrary } from './CncOperationBitLibrary';

type BindingPatch = Partial<Omit<CncStartupOperationDraft, 'layerId'>>;
const JOB_MATERIAL_VALUE = '__job-material__';

type OperationToolProps = {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly hasReliefObjects: boolean;
  readonly onCommitSettings: (settings: CncLayerSettings, replaceFeedDrafts: boolean) => void;
};

export function CncOperationToolFields(props: OperationToolProps): JSX.Element {
  return <OperationToolSection {...props} details={false} />;
}

export function CncOperationToolDetails(props: OperationToolProps): JSX.Element {
  return <OperationToolSection {...props} details />;
}

/** Operation assignments share the exact transform used by Machine Setup's tool plan. */
function OperationToolSection(
  props: OperationToolProps & { readonly details: boolean },
): JSX.Element | null {
  const machine = useStore((state) => state.project.machine);
  const profile = useStore((state) => state.project.device);
  const liveCaps = useStore((state) => state.cncLiveCaps);
  if (machine?.kind !== 'cnc') return null;
  const operation = operationWithMaterialBinding(props.layer, props.settings);
  const draft = cncStartupOperationDraft(operation);
  const primary = layerCncTool(machine, props.settings);
  const jobDefault = machine.tools.find((tool) => tool.id === machine.toolId);
  const secondarySummary = assignedSecondaryTools(machine, props.settings, props.hasReliefObjects);
  const commit = (patch: BindingPatch): void => {
    const scene = sceneWithCncStartupOperationDrafts({
      scene: { layers: [operation], objects: [] },
      machine,
      profile,
      liveCaps,
      drafts: [{ ...draft, ...patch }],
    });
    const next = scene.layers[0];
    if (next !== operation && next?.cnc !== undefined) {
      props.onCommitSettings(next.cnc, 'materialKey' in patch || 'toolId' in patch);
    }
  };
  if (props.details) {
    return (
      <details className="lf-cnc-tool-details">
        <summary title="Show the current bit, additional tool assignments and bit library.">
          <span>Bit details &amp; additional tools</span>
          {secondarySummary === '' ? null : <small>{secondarySummary}</small>}
        </summary>
        <div className="lf-cnc-tool-details__body">
          <p className="lf-cnc-settings-hint">
            Material applies starting feeds, RPM and pass depth. Manual keeps your values.{' '}
            {props.settings.feedSource?.kind === 'material-recipe'
              ? 'Primary bit changes refresh material starting feeds.'
              : 'Primary bit changes keep your current feed values.'}
          </p>
          <p className="lf-cnc-settings-hint">{primary.name}</p>
          <CncToolPicture key={primary.id} tool={primary} />
          <CncSecondaryToolFields {...props} machine={machine} draft={draft} onChange={commit} />
          <CncOperationBitLibrary machine={machine} />
        </div>
      </details>
    );
  }
  return (
    <section className="lf-cnc-settings-card" aria-label="Tool & material">
      <div className="lf-cnc-primary-assignment">
        <CncOperationMaterialField
          layer={props.layer}
          machine={machine}
          value={draft.materialKey}
          onChange={(materialKey) => commit({ materialKey })}
        />
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
          showReference={false}
          onChange={(toolId) => commit({ toolId })}
        />
      </div>
    </section>
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
  return (
    <div className="lf-cnc-tool-field">
      <label>
        <span>Material</span>
        <select
          value={props.value ?? ''}
          aria-label={`Material for ${props.layer.color}`}
          title="Choose a material and apply starting feeds to this operation. Manual keeps the current numbers."
          onChange={(event) => {
            const value = event.target.value;
            props.onChange(value === JOB_MATERIAL_VALUE ? (jobMaterial ?? null) : value || null);
          }}
        >
          <option value="">{MANUAL_FEEDS_LABEL}</option>
          {jobMaterial === undefined ? null : (
            <option value={JOB_MATERIAL_VALUE}>
              Use job material ({materialName(jobMaterial)})
            </option>
          )}
          {!known ? (
            <option value={props.value ?? ''}>Current material ({props.value})</option>
          ) : null}
          <CncMaterialOptions />
        </select>
      </label>
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
          hint="Uses the primary bit's feed, plunge, RPM and depth per pass. Check these values for both bits."
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
          hint="Uses the primary bit's feed, plunge, RPM and depth per pass. Check these values for both bits."
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
          hint="Uses the primary bit's feed, plunge and RPM. Check these values for both bits. Relief finishing follows the surface and scallop setting; depth per pass does not apply."
          onChange={(reliefFinishToolId) => props.onChange({ reliefFinishToolId })}
        />
      ) : null}
    </>
  );
}

function assignedSecondaryTools(
  machine: CncMachineConfig,
  settings: CncLayerSettings,
  hasReliefObjects: boolean,
): string {
  const bindings = [
    {
      label: 'Floor',
      id: settings.vClearToolId,
      active: settings.cutType === 'v-carve' && (settings.vCarveFlatDepthEnabled ?? true),
    },
    {
      label: 'Roughing',
      id: settings.pocketRoughToolId,
      active: settings.cutType === 'pocket' && settings.pocketStrategy !== 'adaptive',
    },
    { label: 'Finish', id: settings.reliefFinishToolId, active: hasReliefObjects },
  ];
  return bindings
    .filter((binding) => binding.active && binding.id !== undefined)
    .map((binding) => {
      const tool = machine.tools.find((candidate) => candidate.id === binding.id);
      return `${binding.label}: ${tool?.name ?? `Unavailable bit (${binding.id})`}`;
    })
    .join(' · ');
}

function materialName(key: string): string {
  return CHIPLOAD_MATERIALS.find((material) => material.value === key)?.label ?? key;
}

// Older recipes can carry their material only in provenance. Present and edit
// that binding consistently without changing the project merely by opening it.
function operationWithMaterialBinding(layer: Layer, settings: CncLayerSettings): Layer {
  const materialKey =
    settings.materialKey ??
    (settings.feedSource?.kind === 'material-recipe' ? settings.feedSource.materialKey : undefined);
  return {
    ...layer,
    cnc: materialKey === undefined ? settings : { ...settings, materialKey },
  };
}
