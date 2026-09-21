import { CHIPLOAD_MATERIALS } from '../../core/cnc';
import {
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type Layer,
} from '../../core/scene';
import { CncMaterialOptions } from '../common/CncMaterialOptions';
import { MANUAL_FEEDS_LABEL } from '../common/cnc-material-vocabulary';
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

/** Operation assignments share the exact transform used by Startup Setup's tool plan. */
export function CncOperationToolFields(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly hasReliefObjects: boolean;
  readonly onCommitSettings: (settings: CncLayerSettings, replaceFeedDrafts: boolean) => void;
}): JSX.Element | null {
  const machine = useStore((state) => state.project.machine);
  const profile = useStore((state) => state.project.device);
  const liveCaps = useStore((state) => state.cncLiveCaps);
  if (machine?.kind !== 'cnc') return null;
  const operation = operationWithMaterialBinding(props.layer, props.settings);
  const draft = cncStartupOperationDraft(operation);
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
  return (
    <section className="lf-cnc-settings-card" aria-label="Tool & material">
      <h4>Tool &amp; material</h4>
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
        emptyLabel="Use job default bit"
        tools={machine.tools}
        allTools={machine.tools}
        defaultTool={machine.tools.find((tool) => tool.id === machine.toolId)}
        onChange={(toolId) => commit({ toolId })}
      />
      <p className="lf-cnc-settings-hint">
        {props.settings.feedSource?.kind === 'material-recipe'
          ? 'Primary bit changes refresh material starting feeds.'
          : 'Primary bit changes keep your current feed values.'}
      </p>
      <CncSecondaryToolFields {...props} machine={machine} draft={draft} onChange={commit} />
      <CncOperationBitLibrary machine={machine} />
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
      <p className="lf-cnc-settings-hint">
        Applies starting feeds, RPM and pass depth. Manual keeps your values.
      </p>
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
