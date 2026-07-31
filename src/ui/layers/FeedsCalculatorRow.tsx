// FeedsCalculatorRow — chipload-based feeds & speeds calculator on the CNC
// layer card (ADR-103 G5, F-CNC24). Computes feed/plunge/depth-per-pass from
// material × bit diameter × flutes × RPM and applies them as one undoable
// layer patch. The chart values are labeled starting points (PROVISIONAL,
// see core/cnc/feeds-calculator.ts); every number stays editable after.

import { useState } from 'react';
import { chiploadFor, isChiploadMaterialKey, type ChiploadMaterial } from '../../core/cnc';
import { DEFAULT_ASSUMED_FLUTE_COUNT } from '../../core/cnc/machine-starters';
import { layerCncTool, type CncLayerSettings, type CncTool, type Layer } from '../../core/scene';
import { CncMaterialOptions } from '../common/CncMaterialOptions';
import { cncAngledToolFeedAdvisory } from '../common/cnc-angled-tool-feed-advisory';
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
  // Open on the layer's own recipe when it has one. Seeding these from
  // constants meant the panel previewed - and on Apply committed - a different
  // material's numbers under this layer's name.
  const recipe = props.settings.feedSource;
  const tool = machine?.kind === 'cnc' ? layerCncTool(machine, props.settings) : null;
  const [material, setMaterial] = useState<ChiploadMaterial>(
    // materialKey is a plain string on the wire, so a foreign or stale .lf2 can
    // carry a key the chipload chart no longer has.
    recipe?.kind === 'material-recipe' && isChiploadMaterialKey(recipe.materialKey)
      ? recipe.materialKey
      : 'plywood-mdf',
  );
  const [flutes, setFlutes] = useFluteSelection(tool, props.settings);
  if (machine?.kind !== 'cnc' || tool === null) return null;

  const rpm = props.settings.spindleRpm;
  const result = materialFeedResult(
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
    <details style={boxStyle}>
      <summary
        style={summaryStyle}
        title="Compute starting feeds from chipload: RPM × flutes × mm-per-tooth for the layer's bit."
      >
        Feeds calculator
      </summary>
      <div style={rowStyle}>
        <MaterialSelect value={material} onPick={setMaterial} />
        <label style={fieldStyle}>
          Flutes
          <select
            aria-label="Bit flute count"
            title="Number of cutting edges on the bit."
            value={flutes}
            onChange={(e) =>
              setFlutes(Math.max(1, Number(e.target.value) || DEFAULT_ASSUMED_FLUTE_COUNT))
            }
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </label>
      </div>
      <FeedsCalculatorResultText
        toolName={tool.name}
        chiploadMm={chiploadFor(material, tool.diameterMm)}
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
    </details>
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

function useFluteSelection(
  tool: CncTool | null,
  settings: CncLayerSettings,
): readonly [number, (flutes: number) => void] {
  const contextKey = fluteContextKey(tool, settings);
  const fallback = initialFluteCount(tool, settings);
  const [selection, setSelection] = useState(() => ({ contextKey, flutes: fallback }));
  const flutes = selection.contextKey === contextKey ? selection.flutes : fallback;
  return [flutes, (next) => setSelection({ contextKey, flutes: next })];
}

function initialFluteCount(tool: CncTool | null, settings: CncLayerSettings): number {
  const recipe = settings.feedSource;
  if (recipe?.kind === 'material-recipe') return recipe.fluteCount;
  return tool?.fluteCount ?? DEFAULT_ASSUMED_FLUTE_COUNT;
}

function fluteContextKey(tool: CncTool | null, settings: CncLayerSettings): string {
  const source = settings.feedSource;
  return source?.kind === 'material-recipe'
    ? `${tool?.id ?? 'none'}:${source.materialKey}:${source.fluteCount}`
    : `${tool?.id ?? 'none'}:manual`;
}

function MaterialSelect(props: {
  readonly value: ChiploadMaterial;
  readonly onPick: (material: ChiploadMaterial) => void;
}): JSX.Element {
  return (
    <label style={fieldStyle}>
      Material
      <select
        aria-label="Chipload material"
        title="Material family — picks the starting chipload band."
        value={props.value}
        onChange={(e) => {
          if (isChiploadMaterialKey(e.target.value)) props.onPick(e.target.value);
        }}
      >
        <CncMaterialOptions />
      </select>
    </label>
  );
}

function FeedsCalculatorResultText(props: {
  readonly toolName: string;
  readonly chiploadMm: number;
  readonly result: MaterialFeedResult | null;
}): JSX.Element {
  const { toolName, result } = props;
  if (result === null) {
    return <p style={errorStyle}>No valid machine-aware starting values are available.</p>;
  }
  return (
    <p style={resultStyle}>
      {toolName} at {result.spindleRpm.toLocaleString()} RPM → chart chipload{' '}
      {props.chiploadMm.toFixed(3)} mm: machine-aware feed <strong>{result.feedMmPerMin}</strong>,
      plunge <strong>{result.plungeMmPerMin}</strong> mm/min, {result.depthPerPassMm.toFixed(2)}{' '}
      mm/pass. Active machine limits are applied; verify the cut.
    </p>
  );
}

type MaterialFeedResult = {
  readonly materialKey: string;
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
    materialKey: patch.materialKey,
    feedMmPerMin: patch.feedMmPerMin,
    plungeMmPerMin: patch.plungeMmPerMin,
    spindleRpm: patch.spindleRpm,
    depthPerPassMm: patch.depthPerPassMm,
    feedSource: patch.feedSource,
  };
}

const boxStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '4px 6px',
  marginTop: 4,
};
const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 12 };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, margin: '6px 0' };
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 12,
  flex: 1,
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
