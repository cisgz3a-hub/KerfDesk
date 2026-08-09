// FeedsCalculatorRow — chipload-based feeds & speeds calculator on the CNC
// layer card (ADR-103 G5, F-CNC24). Computes feed/plunge/depth-per-pass from
// material × bit diameter × flutes × RPM and applies them as one undoable
// layer patch. The chart values are labeled starting points (PROVISIONAL,
// see core/cnc/feeds-calculator.ts); every number stays editable after.

import {
  CHIPLOAD_MATERIALS,
  chiploadFor,
  isChiploadMaterialKey,
  type ChiploadMaterial,
} from '../../core/cnc';
import { DEFAULT_ASSUMED_FLUTE_COUNT } from '../../core/cnc/machine-starters';
import { layerCncTool, type CncLayerSettings, type CncTool, type Layer } from '../../core/scene';
import { cncAngledToolFeedAdvisory } from '../common/cnc-angled-tool-feed-advisory';
import { RailSection } from '../kit';
import { useStore } from '../state';
import { materialFeedsPatch } from '../state/cnc-project-material';

export function FeedsCalculatorRow(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element | null {
  const machine = useStore((s) => s.project.machine);
  const profile = useStore((s) => s.project.device);
  const liveCaps = useStore((s) => s.cncLiveCaps);
  const tool = machine?.kind === 'cnc' ? layerCncTool(machine, props.settings) : null;
  if (machine?.kind !== 'cnc' || tool === null) return null;

  const material = effectiveMaterial(machine.stock.materialKey, props.settings);
  const flutes = effectiveFluteCount(tool, props.settings);
  const rpm = props.settings.spindleRpm;
  const result =
    material === null
      ? null
      : materialFeedResult(
          materialFeedsPatch({
            materialKey: material,
            tool,
            spindleRpm: rpm,
            profile,
            machineSpindleMaxRpm: machine.params.spindleMaxRpm,
            liveCaps,
            fluteCount: flutes,
          }),
        );
  const canApply = result !== null;
  return (
    <RailSection
      label="Feeds calculator"
      hint="Compute starting feeds from chipload: RPM × flutes × mm-per-tooth for the layer's bit."
    >
      <div style={rowStyle}>
        <ReadOnlyMaterial material={material} />
        <span style={fieldStyle}>
          Flutes
          <output
            aria-label="Bit flute count from Startup Setup"
            title="Read-only here. Set the cutter's actual flute count in the Startup Setup bit library."
            style={readOnlyMaterialStyle}
          >
            {flutes}
          </output>
        </span>
      </div>
      <FeedsCalculatorResultText
        toolName={tool.name}
        chiploadMm={material === null ? null : chiploadFor(material, tool.diameterMm)}
        result={result}
      />
      <AngledToolFeedNotice tool={tool} />
      <button
        type="button"
        disabled={!canApply}
        onClick={() => {
          if (result === null) return;
          props.onCommitSettings({ ...props.settings, ...result });
        }}
        title="Apply machine-aware material starting values, limited by the active profile, CNC spindle ceiling, and connected controller when available."
      >
        Apply to layer
      </button>
    </RailSection>
  );
}

function AngledToolFeedNotice(props: { readonly tool: CncTool }): JSX.Element | null {
  const advisory = cncAngledToolFeedAdvisory(props.tool);
  return advisory === null ? null : (
    <p role="note" style={advisoryStyle}>
      {advisory}
    </p>
  );
}

function effectiveFluteCount(tool: CncTool, settings: CncLayerSettings): number {
  if (tool.fluteCount !== undefined) return tool.fluteCount;
  const recipe = settings.feedSource;
  if (recipe?.kind === 'material-recipe') return recipe.fluteCount;
  return DEFAULT_ASSUMED_FLUTE_COUNT;
}

function ReadOnlyMaterial(props: { readonly material: ChiploadMaterial | null }): JSX.Element {
  const label =
    props.material === null
      ? 'Manual — choose material in Startup Setup'
      : (CHIPLOAD_MATERIALS.find((item) => item.value === props.material)?.label ?? props.material);
  return (
    <span style={fieldStyle}>
      Material
      <output
        aria-label="Chipload material from Startup Setup"
        title="Read-only here. Change the operation material in Startup Setup."
        style={readOnlyMaterialStyle}
      >
        {label}
      </output>
    </span>
  );
}

function FeedsCalculatorResultText(props: {
  readonly toolName: string;
  readonly chiploadMm: number | null;
  readonly result: MaterialFeedResult | null;
}): JSX.Element {
  const { toolName, result } = props;
  if (result === null) {
    return <p style={errorStyle}>No valid machine-aware starting values are available.</p>;
  }
  return (
    <p style={resultStyle}>
      {toolName} at {result.spindleRpm.toLocaleString()} RPM → chart chipload{' '}
      {props.chiploadMm?.toFixed(3)} mm: machine-aware feed <strong>{result.feedMmPerMin}</strong>,
      plunge <strong>{result.plungeMmPerMin}</strong> mm/min, {result.depthPerPassMm.toFixed(2)}{' '}
      mm/pass. Active machine limits are applied; verify the cut.
    </p>
  );
}

function effectiveMaterial(
  stockMaterialKey: string | undefined,
  settings: CncLayerSettings,
): ChiploadMaterial | null {
  const source = settings.feedSource;
  const key =
    settings.materialKey ??
    (source?.kind === 'material-recipe' ? source.materialKey : stockMaterialKey);
  return key !== undefined && isChiploadMaterialKey(key) ? key : null;
}

type MaterialFeedResult = {
  readonly feedMmPerMin: number;
  readonly plungeMmPerMin: number;
  readonly spindleRpm: number;
  readonly depthPerPassMm: number;
  readonly feedSource: Extract<
    NonNullable<CncLayerSettings['feedSource']>,
    { readonly kind: 'material-recipe' }
  >;
};

function materialFeedResult(patch: Partial<CncLayerSettings> | null): MaterialFeedResult | null {
  if (
    patch === null ||
    typeof patch.materialKey !== 'string' ||
    typeof patch.feedMmPerMin !== 'number' ||
    typeof patch.plungeMmPerMin !== 'number' ||
    typeof patch.spindleRpm !== 'number' ||
    typeof patch.depthPerPassMm !== 'number' ||
    patch.feedSource?.kind !== 'material-recipe'
  ) {
    return null;
  }
  return {
    feedMmPerMin: patch.feedMmPerMin,
    plungeMmPerMin: patch.plungeMmPerMin,
    spindleRpm: patch.spindleRpm,
    depthPerPassMm: patch.depthPerPassMm,
    feedSource: patch.feedSource,
  };
}

const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, margin: '2px 0' };
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 12,
  flex: 1,
};
const readOnlyMaterialStyle: React.CSSProperties = {
  minHeight: 24,
  display: 'flex',
  alignItems: 'center',
  padding: '2px 6px',
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  background: 'var(--lf-bg-0)',
  color: 'var(--lf-text-muted)',
};
const resultStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  margin: '4px 0 6px 0',
};
const errorStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-danger)',
  margin: '4px 0 6px 0',
};
const advisoryStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-warning-fg)',
  margin: '4px 0 6px 0',
};
