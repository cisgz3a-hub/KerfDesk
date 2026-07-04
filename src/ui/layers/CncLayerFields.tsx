// CncLayerFields — per-layer CNC operation editor (Easel's per-object cut
// panel, applied per color layer). Rendered by LayerRow instead of the laser
// fields when the project machine is CNC. Writes flow through the existing
// setLayerParam action as a whole `cnc` patch, so undo/dirty tracking and
// .lf2 persistence come for free.
//
// The heavy field groups live in CncLayerAdvancedFields; shared row/input
// controls in CncLayerPrimitives. This file holds the always-visible Basic
// fields (cut type, bit, cut depth) plus the pocket/relief stepover.

import {
  CNC_CUT_TYPES,
  DEFAULT_CNC_LAYER_SETTINGS,
  cutTypeLabel,
  type CncCutType,
  type CncLayerSettings,
  type Layer,
} from '../../core/scene';
import { useStore } from '../state';
import { CutTypeSections, DepthAndFeedFields, StepoverField } from './CncLayerAdvancedFields';
import { LayerBitSelect, useLayerHasReliefObjects } from './CncLayerToolFields';
import { NumberField, Row, selectStyle } from './CncLayerPrimitives';
import { PocketFillRow } from './PocketFillRow';

export function CncLayerFields(props: { readonly layer: Layer }): JSX.Element {
  const { layer } = props;
  const setLayerParam = useStore((s) => s.setLayerParam);
  const maxFeed = useStore((s) => s.project.device.maxFeed);
  const spindleMaxRpm = useStore((s) =>
    s.project.machine?.kind === 'cnc' ? s.project.machine.params.spindleMaxRpm : 24000,
  );
  const hasReliefObjects = useLayerHasReliefObjects(layer.color);
  const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  const commit = (patch: Partial<CncLayerSettings>): void =>
    setLayerParam(layer.id, { cnc: { ...settings, ...patch } });
  // Whole-settings commit for edits that REMOVE an optional key (clearing
  // the per-layer bit override) — a spread patch can't delete.
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
      <NumberField
        layer={layer}
        label="Cut depth"
        unit="mm"
        value={settings.depthMm}
        min={0.05}
        max={200}
        step={0.5}
        title="Total depth below the stock top. Equal to stock thickness for a through cut."
        onCommit={(depthMm) => commit({ depthMm })}
      />
      <DepthAndFeedFields
        layer={layer}
        settings={settings}
        maxFeed={maxFeed}
        spindleMaxRpm={spindleMaxRpm}
        onCommit={commit}
      />
      <StepoverField
        layer={layer}
        settings={settings}
        hasReliefObjects={hasReliefObjects}
        onCommit={commit}
      />
      <PocketFillRow layer={layer} settings={settings} onCommit={commit} />
      <CutTypeSections
        layer={layer}
        settings={settings}
        hasReliefObjects={hasReliefObjects}
        onCommit={commit}
        onCommitSettings={commitSettings}
      />
    </>
  );
}
