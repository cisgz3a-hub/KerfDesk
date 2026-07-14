// CncLayerAdvancedFields — the advanced portion of the CNC layer card: the
// feeds helpers (preset picker + chip-load calculator — FeedHelperRows),
// stepover / pocket fill, and the cut-type-specific tails (relief rows,
// v-carve options, H.9 motion polish — CutTypeSections). The core per-cut
// numbers (depth-per-pass / feed / plunge / spindle) live in CncCoreCutFields,
// which the parent now renders in the always-visible Basic group. Extracted
// from CncLayerFields to keep that file under the size cap and so the
// Basic/Advanced toggle gates this group with one conditional (ADR-111).

import { activeCncTool, type CncLayerSettings, type Layer } from '../../core/scene';
import { useStore } from '../state';
import { CncFinishAllowanceField } from './CncFinishAllowanceField';
import {
  FeedPresetRow,
  HelicalEntryRows,
  MotionPolishRows,
  ReliefLayerRows,
  VClearToolSelect,
} from './CncLayerToolFields';
import { RestPocketToolSelect } from './CncRestPocketFields';
import { FeedsCalculatorRow } from './FeedsCalculatorRow';
import { NumberField, Row } from './CncLayerPrimitives';
import { PocketFillRow } from './PocketFillRow';
import { AdaptivePocketFields } from './AdaptivePocketFields';
import { CncInlayFields } from './CncInlayFields';
import { CncTabPositionControls } from './CncTabPositionControls';

// The whole advanced field set, gated by one conditional in the parent
// (ADR-111 Basic/Advanced). Tabs is NOT here — it moved to the Basic group.
export function CncLayerAdvancedGroup(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly hasReliefObjects: boolean;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  return (
    <>
      <FeedHelperRows layer={props.layer} settings={props.settings} onCommit={props.onCommit} />
      <StepoverField
        layer={props.layer}
        settings={props.settings}
        hasReliefObjects={props.hasReliefObjects}
        onCommit={props.onCommit}
      />
      <PocketFillRow layer={props.layer} settings={props.settings} onCommit={props.onCommit} />
      <AdaptivePocketFields
        layer={props.layer}
        settings={props.settings}
        onCommit={props.onCommit}
      />
      <CncInlayFields layer={props.layer} settings={props.settings} onCommit={props.onCommit} />
      <CutTypeSections
        layer={props.layer}
        settings={props.settings}
        hasReliefObjects={props.hasReliefObjects}
        onCommit={props.onCommit}
        onCommitSettings={props.onCommitSettings}
      />
    </>
  );
}

// The core per-cut parameters, promoted to the always-visible Basic group:
// the numbers every CNC cut needs. Previously gated behind Advanced (ADR-111);
// surfaced per maintainer request so depth-per-pass / feed / plunge / spindle
// are always in reach without opening Advanced.
export function CncCoreCutFields(props: {
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
        title="Spindle running speed for this layer's cut (up to the machine's Spindle max in Material & Bit)."
        onCommit={(spindleRpm) => onCommit({ spindleRpm })}
      />
    </>
  );
}

// The feeds HELPERS (preset picker + chip-load calculator) stay in Advanced —
// they assist dialing in the core numbers above rather than being cut params
// themselves, so beginners are not confronted with them by default.
function FeedHelperRows(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  return (
    <>
      <FeedPresetRow layer={props.layer} settings={props.settings} onCommit={props.onCommit} />
      <FeedsCalculatorRow layer={props.layer} settings={props.settings} onCommit={props.onCommit} />
    </>
  );
}

// Pocket/relief ring spacing — advanced, shown only when it applies.
export function StepoverField(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly hasReliefObjects: boolean;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element | null {
  if (props.settings.cutType !== 'pocket' && !props.hasReliefObjects) return null;
  if (
    props.settings.cutType === 'pocket' &&
    props.settings.pocketStrategy === 'adaptive' &&
    !props.hasReliefObjects
  ) {
    return null;
  }
  return (
    <NumberField
      layer={props.layer}
      label="Stepover"
      unit="%"
      value={props.settings.stepoverPercent}
      min={10}
      max={85}
      step={5}
      title={
        props.hasReliefObjects
          ? 'Ring spacing as a percentage of the bit diameter — drives pocket clearing and relief roughing.'
          : 'Pocket ring spacing as a percentage of the bit diameter.'
      }
      onCommit={(stepoverPercent) => props.onCommit({ stepoverPercent })}
    />
  );
}

// The cut-type-specific tails (relief rows, v-carve options, H.9 polish,
// tabs), grouped so the parent stays under the function-size cap.
export function CutTypeSections(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly hasReliefObjects: boolean;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  const { layer, settings, onCommit, onCommitSettings } = props;
  const isProfile = settings.cutType.startsWith('profile');
  const showPolish = isProfile || settings.cutType === 'pocket' || settings.cutType === 'engrave';
  return (
    <>
      <CncFinishAllowanceField layer={layer} settings={settings} onCommit={onCommit} />
      {props.hasReliefObjects ? (
        <ReliefLayerRows
          layer={layer}
          settings={settings}
          onCommit={onCommit}
          onCommitSettings={onCommitSettings}
        />
      ) : null}
      {settings.cutType === 'v-carve' ? (
        <VCarveSection
          layer={layer}
          settings={settings}
          onCommit={onCommit}
          onCommitSettings={onCommitSettings}
        />
      ) : null}
      {settings.cutType === 'pocket' ? (
        <>
          {settings.pocketStrategy !== 'adaptive' ? (
            <>
              <RestPocketToolSelect
                layer={layer}
                settings={settings}
                onCommitSettings={onCommitSettings}
              />
              <HelicalEntryRows
                layer={layer}
                settings={settings}
                onCommit={onCommit}
                onCommitSettings={onCommitSettings}
              />
            </>
          ) : null}
        </>
      ) : null}
      {showPolish ? (
        <MotionPolishRows
          layer={layer}
          settings={settings}
          onCommit={onCommit}
          onCommitSettings={onCommitSettings}
        />
      ) : null}
    </>
  );
}

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

// Holding tabs — a Basic field (rendered by the parent for profile cuts) so
// beginners keep parts attached without opening Advanced.
export function TabFields(props: {
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
          <CncTabPositionControls layer={layer} settings={settings} />
        </>
      ) : null}
    </>
  );
}

const vbitWarningStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-danger)',
  padding: '2px 0 2px 4px',
};
