// CncLayerFields — per-layer CNC operation editor (Easel's per-object cut
// panel, applied per color layer). Rendered by LayerRow instead of the laser
// fields when the project machine is CNC. Writes flow through the existing
// setLayerParam action as a whole `cnc` patch, so undo/dirty tracking and
// .lf2 persistence come for free.
//
// Basic fields (material, cut type, bit, cut depth, tabs) are always shown;
// the advanced field set (feeds, stepover, pocket fill, cut-type tails) is
// gated behind the ui-store Basic/Advanced toggle (ADR-106). Shared row/input
// controls live in CncLayerPrimitives; the advanced group in
// CncLayerAdvancedFields.

import {
  CNC_CUT_TYPES,
  DEFAULT_CNC_LAYER_SETTINGS,
  cutTypeLabel,
  type CncCutType,
  type CncLayerSettings,
  type Layer,
} from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { CncLayerAdvancedGroup, TabFields } from './CncLayerAdvancedFields';
import { LayerBitSelect, useLayerHasReliefObjects } from './CncLayerToolFields';
import { CncMaterialRow } from './CncMaterialRow';
import { NumberField, Row, selectStyle } from './CncLayerPrimitives';

export function CncLayerFields(props: { readonly layer: Layer }): JSX.Element {
  const { layer } = props;
  const setLayerParam = useStore((s) => s.setLayerParam);
  const maxFeed = useStore((s) => s.project.device.maxFeed);
  const machine = useStore((s) => s.project.machine);
  const showAdvanced = useUiStore((s) => s.showCncAdvanced);
  const hasReliefObjects = useLayerHasReliefObjects(layer.color);
  const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  const isCnc = machine?.kind === 'cnc';
  const spindleMaxRpm = isCnc ? machine.params.spindleMaxRpm : 24000;
  const stockThicknessMm = isCnc ? machine.stock.thicknessMm : 0;
  const isProfile = settings.cutType.startsWith('profile');
  const commit = (patch: Partial<CncLayerSettings>): void =>
    setLayerParam(layer.id, { cnc: { ...settings, ...patch } });
  const commitSettings = (next: CncLayerSettings): void => setLayerParam(layer.id, { cnc: next });

  return (
    <>
      <Row label="Cut type">
        <select
          value={settings.cutType}
          onChange={(e) => commit({ cutType: e.target.value as CncCutType })}
          aria-label={`Cut type for ${layer.color}`}
          title="How this layer's shapes are machined: outline (with bit-radius offset), pocket, or engrave."
          style={selectStyle}
        >
          {CNC_CUT_TYPES.map((cutType) => (
            <option key={cutType} value={cutType}>
              {cutTypeLabel(cutType)}
            </option>
          ))}
        </select>
      </Row>
      <LayerBitSelect
        layer={layer}
        settings={settings}
        onCommit={commit}
        onCommitSettings={commitSettings}
      />
      <CncMaterialRow
        layer={layer}
        settings={settings}
        onCommit={commit}
        onCommitSettings={commitSettings}
      />
      <CutDepthField
        layer={layer}
        settings={settings}
        stockThicknessMm={stockThicknessMm}
        onCommit={commit}
      />
      {isProfile ? <TabFields layer={layer} settings={settings} onCommit={commit} /> : null}
      {showAdvanced ? (
        <CncLayerAdvancedGroup
          layer={layer}
          settings={settings}
          maxFeed={maxFeed}
          spindleMaxRpm={spindleMaxRpm}
          hasReliefObjects={hasReliefObjects}
          onCommit={commit}
          onCommitSettings={commitSettings}
        />
      ) : null}
    </>
  );
}

// Cut depth + a one-click "through cut" that sets depth to the stock
// thickness (the confusing Cut-depth-vs-Stock-thickness pair, ADR-106).
function CutDepthField(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly stockThicknessMm: number;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  return (
    <>
      <NumberField
        layer={props.layer}
        label="Cut depth"
        unit="mm"
        value={props.settings.depthMm}
        min={0.05}
        max={200}
        step={0.5}
        title="Total depth below the stock top. Equal to stock thickness for a through cut."
        onCommit={(depthMm) => props.onCommit({ depthMm })}
      />
      {props.stockThicknessMm > 0 ? (
        <Row label="">
          <button
            type="button"
            onClick={() => props.onCommit({ depthMm: props.stockThicknessMm })}
            title="Set cut depth to the stock thickness for a full through cut."
            style={throughButtonStyle}
          >
            Through cut (= {props.stockThicknessMm} mm)
          </button>
        </Row>
      ) : null}
    </>
  );
}

const throughButtonStyle: React.CSSProperties = { fontSize: 11, padding: '2px 8px' };
