// Per-layer bit selectors (Phase H.7 multi-tool). LayerBitSelect assigns
// the bit a layer cuts with (default = the machine's active bit);
// VClearToolSelect arms the two-stage v-carve's flat-floor clearing bit.
// Split from CncLayerFields.tsx, which sits near the file-size cap.

import {
  DEFAULT_CNC_TOOLS,
  activeCncTool,
  sceneObjectUsesOperation,
  type CncLayerSettings,
  type CncTool,
  type Layer,
} from '../../core/scene';
import { NumberField as ClearableNumberField } from '../common/NumberField';
import { useStore } from '../state';
import { materialFeedsPatch } from '../state/cnc-project-material';
import { withoutCncFeedProvenance } from '../state/cnc-feed-provenance';

export function useCncTools(): ReadonlyArray<CncTool> {
  return useStore((s) =>
    s.project.machine?.kind === 'cnc' ? s.project.machine.tools : DEFAULT_CNC_TOOLS,
  );
}

// Relief roughing (H.5) reads depth-per-pass + stepover from the layer but
// takes total depth from the relief object — CncLayerFields keys its
// honest-card hints on this (handoff §7.C contract fix).
export function useLayerHasReliefObjects(layer: Layer): boolean {
  return useStore((s) =>
    s.project.scene.objects.some(
      (object) => object.kind === 'relief' && sceneObjectUsesOperation(object, layer),
    ),
  );
}

export function LayerBitSelect(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  const tools = useCncTools();
  const machine = useStore((s) => s.project.machine);
  const profile = useStore((s) => s.project.device);
  const liveCaps = useStore((s) => s.cncLiveCaps);
  // A material-driven layer must recompute its feeds for the NEW bit's
  // diameter — otherwise the material hint claims feeds that were computed
  // for the old bit.
  const feedsForBit = (toolId: string | undefined): Partial<CncLayerSettings> | null => {
    const source = props.settings.feedSource;
    if (machine?.kind !== 'cnc' || source?.kind !== 'material-recipe') return null;
    const tool = toolId === undefined ? activeCncTool(machine) : tools.find((t) => t.id === toolId);
    if (tool === undefined) return null;
    return materialFeedsPatch({
      materialKey: source.materialKey,
      tool,
      spindleRpm: props.settings.spindleRpm,
      profile,
      machineSpindleMaxRpm: machine.params.spindleMaxRpm,
      liveCaps,
      fluteCount: source.fluteCount,
    });
  };
  return (
    <Row label="Bit">
      <select
        value={props.settings.toolId ?? ''}
        onChange={(e) => {
          const toolId = e.target.value === '' ? undefined : e.target.value;
          const feeds = feedsForBit(toolId);
          let base: CncLayerSettings;
          if (e.target.value === '') {
            // Clearing the override removes the key (exact optional field).
            const { toolId: _removed, ...rest } = props.settings;
            base = rest;
          } else {
            base = { ...props.settings, toolId: e.target.value };
          }
          props.onCommitSettings(
            feeds === null ? withoutCncFeedProvenance(base) : { ...base, ...feeds },
          );
        }}
        aria-label={`Bit for ${props.layer.color}`}
        title="Which bit cuts this layer. Layers with different bits become a multi-bit job with M0 tool-change pauses."
        style={selectStyle}
      >
        <option value="">Machine bit (active)</option>
        {tools.map((tool) => (
          <option key={tool.id} value={tool.id}>
            {tool.name}
          </option>
        ))}
      </select>
    </Row>
  );
}

export function VClearToolSelect(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  const tools = useCncTools();
  const flatTools = tools.filter((tool) => tool.kind !== 'v-bit');
  return (
    <Row label="Clear floors">
      <select
        value={props.settings.vClearToolId ?? ''}
        onChange={(e) => {
          if (e.target.value === '') {
            const { vClearToolId: _removed, ...rest } = props.settings;
            props.onCommitSettings(rest);
          } else {
            props.onCommit({ vClearToolId: e.target.value });
          }
        }}
        aria-label={`Clearing bit for ${props.layer.color}`}
        title="Two-stage v-carve: pocket the flat floors (regions wider than the v-bit reaches) with this bit first, then run the v-bit."
        style={selectStyle}
      >
        <option value="">Single stage (v-bit only)</option>
        {flatTools.map((tool) => (
          <option key={tool.id} value={tool.id}>
            {tool.name}
          </option>
        ))}
      </select>
    </Row>
  );
}

// The relief block for layers carrying relief objects: the honest-card
// hint (which fields drive roughing) plus the H.8 finishing controls.
export function ReliefLayerRows(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  return (
    <>
      <div style={reliefHintStyle}>
        Reliefs on this layer rough with Depth/pass + Stepover; total depth comes from the
        relief&apos;s own Depth (select the relief to edit it). Cut depth applies to the other
        shapes only.
      </div>
      <ReliefFinishRow
        layer={props.layer}
        settings={props.settings}
        onCommit={props.onCommit}
        onCommitSettings={props.onCommitSettings}
      />
    </>
  );
}

// Relief finishing controls (H.8): the skim bit + scallop target. Rendered
// only for layers that carry relief objects.
function ReliefFinishRow(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  const tools = useCncTools();
  return (
    <Row label="Finish with">
      <select
        value={props.settings.reliefFinishToolId ?? ''}
        onChange={(e) => {
          if (e.target.value === '') {
            const { reliefFinishToolId: _removed, ...rest } = props.settings;
            props.onCommitSettings(rest);
          } else {
            props.onCommit({ reliefFinishToolId: e.target.value });
          }
        }}
        aria-label={`Relief finishing bit for ${props.layer.color}`}
        title="H.8 finishing: after roughing, skim the true surface with this bit (ball nose recommended). None = roughing only."
        style={selectStyle}
      >
        <option value="">Roughing only</option>
        {tools.map((tool) => (
          <option key={tool.id} value={tool.id}>
            {tool.name}
          </option>
        ))}
      </select>
      <ClearableNumberField
        min={0.005}
        max={1}
        step={0.005}
        value={props.settings.reliefScallopMm ?? 0.025}
        onCommit={(mm) => props.onCommit({ reliefScallopMm: mm })}
        ariaLabel={`Relief scallop height for ${props.layer.color}`}
        title="Scallop height target (mm) — smaller = finer finishing rows, longer job."
        style={scallopInputStyle}
      />
    </Row>
  );
}

// H.9 motion polish rows — both opt-in: '' keeps the pre-H.9 behavior.
export function MotionPolishRows(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  return (
    <Row label="Entry">
      <select
        value={props.settings.cutDirection ?? ''}
        onChange={(e) => {
          if (e.target.value === '') {
            const { cutDirection: _removed, ...rest } = props.settings;
            props.onCommitSettings(rest);
          } else {
            props.onCommit({
              cutDirection: e.target.value === 'climb' ? 'climb' : 'conventional',
            });
          }
        }}
        aria-label={`Cut direction for ${props.layer.color}`}
        title="Climb or conventional cutting for profile/pocket toolpaths (also moves entry points to mid-segment). Default keeps the compiler's natural direction."
        style={directionSelectStyle}
      >
        <option value="">Default direction</option>
        <option value="climb">Climb</option>
        <option value="conventional">Conventional</option>
      </select>
      <ClearableNumberField
        min={0}
        max={45}
        step={0.5}
        value={props.settings.rampEntryDeg ?? 0}
        onCommit={(deg) => {
          if (deg <= 0) {
            const { rampEntryDeg: _removed, ...rest } = props.settings;
            props.onCommitSettings(rest);
          } else {
            const { helixEntry: _removed, ...rest } = props.settings;
            props.onCommitSettings({ ...rest, rampEntryDeg: deg });
          }
        }}
        ariaLabel={`Ramp entry angle for ${props.layer.color}`}
        title="Descend into cuts along the path at this angle instead of plunging straight down. 0 = plunge (default)."
        style={rampInputStyle}
      />
      <span style={rampUnitStyle}>° ramp</span>
    </Row>
  );
}

export function HelicalEntryRows(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  const helix = props.settings.helixEntry;
  return (
    <>
      <Row label="Helical entry">
        <input
          type="checkbox"
          checked={helix !== undefined}
          onChange={(event) => {
            if (!event.target.checked) {
              const { helixEntry: _removed, ...rest } = props.settings;
              props.onCommitSettings(rest);
              return;
            }
            const {
              rampEntryDeg: _removed,
              pocketRoughToolId: _removedRougher,
              ...rest
            } = props.settings;
            props.onCommitSettings({
              ...rest,
              helixEntry: { minDiameterMm: 2, maxDiameterMm: 8, angleDeg: 3 },
            });
          }}
          aria-label={`Helical entry for ${props.layer.color}`}
          title="Descend into offset pockets with native G2/G3 circles instead of plunging."
        />
        <span style={helixLabelStyle}>Use circular ramp</span>
      </Row>
      {helix === undefined ? null : (
        <>
          <HelixNumberRow
            label="Helix diameter"
            ariaLabel={`Maximum helix diameter for ${props.layer.color}`}
            value={helix.maxDiameterMm}
            min={helix.minDiameterMm}
            max={100}
            step={0.5}
            unit="mm max"
            onCommit={(maxDiameterMm) =>
              props.onCommit({ helixEntry: { ...helix, maxDiameterMm } })
            }
          />
          <HelixNumberRow
            label="Minimum fit"
            ariaLabel={`Minimum helix diameter for ${props.layer.color}`}
            value={helix.minDiameterMm}
            min={0.1}
            max={helix.maxDiameterMm}
            step={0.5}
            unit="mm"
            onCommit={(minDiameterMm) =>
              props.onCommit({ helixEntry: { ...helix, minDiameterMm } })
            }
          />
          <HelixNumberRow
            label="Helix angle"
            ariaLabel={`Helix angle for ${props.layer.color}`}
            value={helix.angleDeg}
            min={0.5}
            max={15}
            step={0.5}
            unit="deg"
            onCommit={(angleDeg) => props.onCommit({ helixEntry: { ...helix, angleDeg } })}
          />
        </>
      )}
    </>
  );
}

function HelixNumberRow(props: {
  readonly label: string;
  readonly ariaLabel: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: string;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  return (
    <Row label={props.label}>
      <ClearableNumberField
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onCommit={props.onCommit}
        ariaLabel={props.ariaLabel}
        style={helixInputStyle}
      />
      <span style={rampUnitStyle}>{props.unit}</span>
    </Row>
  );
}

function Row(props: { readonly label: string; readonly children: React.ReactNode }): JSX.Element {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{props.label}</span>
      <div style={valueStyle}>{props.children}</div>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  minHeight: 28,
};
const labelStyle: React.CSSProperties = {
  flex: '0 0 96px',
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
const valueStyle: React.CSSProperties = {
  display: 'flex',
  flex: '1 1 140px',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
};
const selectStyle: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: 12, padding: '2px 4px' };
const scallopInputStyle: React.CSSProperties = { width: 64, padding: '2px 6px' };
const directionSelectStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 12,
  padding: '2px 4px',
};
const rampInputStyle: React.CSSProperties = { width: 52, padding: '2px 6px' };
const helixInputStyle: React.CSSProperties = { width: 72, padding: '2px 6px' };
const helixLabelStyle: React.CSSProperties = { fontSize: 12 };
const rampUnitStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-faint)' };
const reliefHintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  padding: '2px 0 2px 4px',
  lineHeight: 1.35,
};
