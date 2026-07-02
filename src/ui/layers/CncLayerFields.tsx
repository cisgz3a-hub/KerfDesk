// CncLayerFields — per-layer CNC operation editor (Easel's per-object cut
// panel, applied per color layer). Rendered by LayerRow instead of the laser
// fields when the project machine is CNC. Writes flow through the existing
// setLayerParam action as a whole `cnc` patch, so undo/dirty tracking and
// .lf2 persistence come for free.

import {
  activeCncTool,
  CNC_CUT_TYPES,
  DEFAULT_CNC_LAYER_SETTINGS,
  cutTypeLabel,
  type CncCutType,
  type CncLayerSettings,
  type Layer,
} from '../../core/scene';
import { useStore } from '../state';
import { LayerBitSelect, useLayerHasReliefObjects, VClearToolSelect } from './CncLayerToolFields';
import { useDebouncedCommit } from './use-debounced-commit';

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
  const isProfile = settings.cutType.startsWith('profile');

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
      <DepthAndFeedFields
        layer={layer}
        settings={settings}
        maxFeed={maxFeed}
        spindleMaxRpm={spindleMaxRpm}
        onCommit={commit}
      />
      {settings.cutType === 'pocket' || hasReliefObjects ? (
        <NumberField
          layer={layer}
          label="Stepover"
          unit="%"
          value={settings.stepoverPercent}
          min={10}
          max={85}
          step={5}
          title={
            hasReliefObjects
              ? 'Ring spacing as a percentage of the bit diameter — drives pocket clearing and relief roughing.'
              : 'Pocket ring spacing as a percentage of the bit diameter.'
          }
          onCommit={(stepoverPercent) => commit({ stepoverPercent })}
        />
      ) : null}
      {hasReliefObjects ? (
        <div style={reliefHintStyle}>
          Reliefs on this layer rough with Depth/pass + Stepover; total depth comes from the
          relief&apos;s own Depth (select the relief to edit it). Cut depth applies to the other
          shapes only.
        </div>
      ) : null}
      {settings.cutType === 'v-carve' ? (
        <VCarveSection
          layer={layer}
          settings={settings}
          onCommit={commit}
          onCommitSettings={commitSettings}
        />
      ) : null}
      {isProfile ? <TabFields layer={layer} settings={settings} onCommit={commit} /> : null}
    </>
  );
}

const reliefHintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  padding: '2px 0 2px 4px',
  lineHeight: 1.35,
};

// H.3 ring detail + H.7 two-stage clearing bit, grouped so the parent
// component stays under the function-size cap.
function VCarveSection(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  return (
    <>
      <VCarveFields layer={props.layer} settings={props.settings} onCommit={props.onCommit} />
      <VClearToolSelect
        layer={props.layer}
        settings={props.settings}
        onCommit={props.onCommit}
        onCommitSettings={props.onCommitSettings}
      />
    </>
  );
}

// H.3 V-carve options: ring detail + a live warning when the spindle's
// active bit is not a v-bit (preflight blocks output until it is).
function VCarveFields(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  const activeToolIsVBit = useStore(
    (s) => s.project.machine?.kind === 'cnc' && activeCncTool(s.project.machine).kind === 'v-bit',
  );
  return (
    <>
      <NumberField
        layer={props.layer}
        label="Detail"
        unit="mm"
        value={props.settings.vResolutionMm}
        min={0}
        max={5}
        step={0.05}
        title="V-carve ring spacing. 0 = automatic (bit diameter ÷ 8). Smaller = crisper walls, longer job."
        onCommit={(vResolutionMm) => props.onCommit({ vResolutionMm })}
      />
      {!activeToolIsVBit ? (
        <div style={vbitWarningStyle} role="alert">
          V-carve needs a v-bit — pick one in Material &amp; Bit. Preflight blocks output until
          then.
        </div>
      ) : null}
    </>
  );
}

const vbitWarningStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-danger)',
  padding: '2px 0 2px 4px',
};

function DepthAndFeedFields(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly maxFeed: number;
  readonly spindleMaxRpm: number;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  const { layer, settings, maxFeed, spindleMaxRpm, onCommit } = props;
  return (
    <>
      <NumberField
        layer={layer}
        label="Cut depth"
        unit="mm"
        value={settings.depthMm}
        min={0.05}
        max={200}
        step={0.5}
        title="Total depth below the stock top. Equal to stock thickness for a through cut."
        onCommit={(depthMm) => onCommit({ depthMm })}
      />
      <NumberField
        layer={layer}
        label="Depth per pass"
        unit="mm"
        value={settings.depthPerPassMm}
        min={0.05}
        max={50}
        step={0.25}
        title="Material removed per Z pass. Rule of thumb: up to half the bit diameter in wood."
        onCommit={(depthPerPassMm) => onCommit({ depthPerPassMm })}
      />
      <NumberField
        layer={layer}
        label="Feed"
        unit="mm/min"
        value={settings.feedMmPerMin}
        min={1}
        max={maxFeed}
        step={50}
        title="XY cutting feed rate."
        onCommit={(feedMmPerMin) => onCommit({ feedMmPerMin })}
      />
      <NumberField
        layer={layer}
        label="Plunge"
        unit="mm/min"
        value={settings.plungeMmPerMin}
        min={1}
        max={maxFeed}
        step={25}
        title="Z plunge feed rate — slower than XY feed, bits cut poorly straight down."
        onCommit={(plungeMmPerMin) => onCommit({ plungeMmPerMin })}
      />
      <NumberField
        layer={layer}
        label="Spindle"
        unit="RPM"
        value={settings.spindleRpm}
        min={1000}
        max={spindleMaxRpm}
        step={500}
        title="Spindle speed for this layer."
        onCommit={(spindleRpm) => onCommit({ spindleRpm })}
      />
    </>
  );
}

function TabFields(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  const { layer, settings, onCommit } = props;
  return (
    <>
      <Row label="Tabs">
        <input
          type="checkbox"
          checked={settings.tabsEnabled}
          onChange={(e) => onCommit({ tabsEnabled: e.target.checked })}
          aria-label={`Holding tabs for ${layer.color}`}
          title="Leave small bridges on the deepest passes so cut-out parts stay attached."
        />
      </Row>
      {settings.tabsEnabled ? (
        <>
          <NumberField
            layer={layer}
            label="Tab height"
            unit="mm"
            value={settings.tabHeightMm}
            min={0.2}
            max={20}
            step={0.2}
            title="Material left under each tab, measured up from the cut floor."
            onCommit={(tabHeightMm) => onCommit({ tabHeightMm })}
          />
          <NumberField
            layer={layer}
            label="Tab width"
            unit="mm"
            value={settings.tabWidthMm}
            min={0.5}
            max={30}
            step={0.5}
            title="Length of each tab along the cut path."
            onCommit={(tabWidthMm) => onCommit({ tabWidthMm })}
          />
          <NumberField
            layer={layer}
            label="Tabs per shape"
            unit=""
            value={settings.tabsPerShape}
            min={1}
            max={16}
            step={1}
            title="Number of tabs spread around each closed shape."
            onCommit={(tabsPerShape) => onCommit({ tabsPerShape: Math.floor(tabsPerShape) })}
          />
        </>
      ) : null}
    </>
  );
}

function NumberField(props: {
  readonly layer: Layer;
  readonly label: string;
  readonly unit: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly title: string;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  const debounced = useDebouncedCommit<number>({
    value: props.value,
    commit: props.onCommit,
    parse: (s) => {
      const n = Number.parseFloat(s);
      if (!Number.isFinite(n)) return props.value;
      return Math.max(props.min, Math.min(props.max, n));
    },
  });
  return (
    <Row label={props.label}>
      <input
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        value={debounced.displayValue}
        onChange={debounced.onChange}
        onBlur={debounced.onBlur}
        style={inputStyle}
        aria-label={`${props.label} for ${props.layer.color}`}
        title={props.title}
      />
      {props.unit.length > 0 ? <span style={unitStyle}>{props.unit}</span> : null}
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
  alignItems: 'center',
  gap: 8,
  minHeight: 28,
};
const labelStyle: React.CSSProperties = { width: 96, fontSize: 12, color: 'var(--lf-text-muted)' };
const valueStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, flex: 1 };
const selectStyle: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: 12, padding: '2px 4px' };
const inputStyle: React.CSSProperties = { width: 80, padding: '2px 6px' };
const unitStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-faint)' };
