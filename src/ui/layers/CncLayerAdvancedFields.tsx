// CncLayerAdvancedFields — the advanced portion of the CNC layer card: the
// feeds helpers (preset picker + chip-load calculator — FeedHelperRows),
// stepover / pocket fill, and the cut-type-specific tails (relief rows,
// v-carve options, H.9 motion polish — CutTypeSections). The core per-cut
// numbers (depth-per-pass / feed / plunge / spindle) live in CncCoreCutFields,
// which the parent renders in the always-visible core group. Extracted
// from CncLayerFields to keep that file under the size cap and so the
// specialist controls remain grouped under one always-visible heading.

import { isVCarveToolCompatible } from '../../core/cnc/vcarve-tool-compatibility';
import { layerCncTool, type CncLayerSettings, type Layer } from '../../core/scene';
import { useStore } from '../state';
import { CncFinishAllowanceField } from './CncFinishAllowanceField';
import { HelicalEntryRows, MotionPolishRows, ReliefLayerRows } from './CncLayerToolFields';
import { CncFeedPresetRows } from './CncFeedPresetRows';
import { FeedsCalculatorRow } from './FeedsCalculatorRow';
import { NumberField, Row } from './CncLayerPrimitives';
import { PocketFillRow } from './PocketFillRow';
import { AdaptivePocketFields } from './AdaptivePocketFields';
import { CncInlayFields } from './CncInlayFields';
import { CncTabPositionControls } from './CncTabPositionControls';
import { SetupOwnedValueRow } from './SetupOwnedValueRow';

// The whole advanced field set. Tabs is NOT here — it moved to the core group.
export function CncLayerAdvancedGroup(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly hasReliefObjects: boolean;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  return (
    <section aria-label="Advanced cut settings" style={advancedSectionStyle}>
      <h4 className="lf-subhead">Advanced</h4>
      <FeedHelperRows
        layer={props.layer}
        settings={props.settings}
        onCommit={props.onCommit}
        onCommitSettings={props.onCommitSettings}
      />
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
    </section>
  );
}

// The core per-cut parameters lead the card: the numbers every CNC cut needs.
// Depth-per-pass / feed / plunge / spindle remain separate from the labeled
// Advanced helper and specialist section that follows.
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
      <SetupOwnedValueRow
        label="Machine maximum"
        value={`${spindleMaxRpm.toLocaleString('en-US')} RPM`}
        description="This is the machine maximum spindle speed saved in Startup Setup. Artwork spindle speed below is the requested running speed for this operation."
        setupField="spindle-max"
      />
      <NumberField
        layer={layer}
        label="Artwork spindle speed"
        unit="RPM"
        value={settings.spindleRpm}
        min={1000}
        max={spindleMaxRpm}
        step={500}
        title="Requested spindle running speed for this artwork operation. Machine maximum is shown above and is edited in Startup Setup."
        onCommit={(spindleRpm) => onCommit({ spindleRpm })}
      />
    </>
  );
}

// The feeds HELPERS (preset picker + chip-load calculator) stay grouped under
// Advanced because they assist with the core numbers rather than being cut
// parameters themselves. The section itself remains visible at all times.
function FeedHelperRows(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  return (
    <>
      <CncFeedPresetRows layer={props.layer} settings={props.settings} onCommit={props.onCommit} />
      <FeedsCalculatorRow
        layer={props.layer}
        settings={props.settings}
        onCommitSettings={props.onCommitSettings}
      />
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
  const showPolish =
    isProfile ||
    settings.cutType === 'pocket' ||
    settings.cutType === 'engrave' ||
    settings.cutType === 'v-carve';
  return (
    <>
      <CncFinishAllowanceField layer={layer} settings={settings} onCommit={onCommit} />
      {props.hasReliefObjects ? (
        <ReliefLayerRows layer={layer} settings={settings} onCommit={onCommit} />
      ) : null}
      {settings.cutType === 'v-carve' ? (
        <VCarveFields layer={layer} settings={settings} onCommit={onCommit} />
      ) : null}
      {settings.cutType === 'pocket' ? (
        <>
          {settings.pocketStrategy !== 'adaptive' ? (
            <HelicalEntryRows
              layer={layer}
              settings={settings}
              onCommit={onCommit}
              onCommitSettings={onCommitSettings}
            />
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

// H.3 V-carve options: medial sampling detail + a live warning when THIS LAYER's bit lacks a
// supported conical envelope. Wrong-kind selection remains advisory-only and keeps its legacy
// fallback geometry; an actual V-bit with invalid angle is the separate exact compile-integrity
// refusal. Read the layer tool so overrides are represented.
function VCarveFields(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  const activeToolIsCompatible = useStore(
    (s) =>
      s.project.machine?.kind === 'cnc' &&
      isVCarveToolCompatible(layerCncTool(s.project.machine, props.settings)),
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
        title="V-carve boundary sampling and flat-core clearing pitch. 0 = automatic. Smaller = finer geometry and longer compile/job time."
        onCommit={(vResolutionMm) => props.onCommit({ vResolutionMm })}
      />
      {!activeToolIsCompatible ? (
        <div style={vbitWarningStyle} role="alert">
          V-carve needs a V-bit or modeled angled engraving bit — assign one in the Startup Setup
          tool plan. Unsupported selections may use legacy 60° fallback geometry where compatible.
        </div>
      ) : null}
    </>
  );
}

// Holding tabs stay with the core profile controls so part retention remains
// prominent before the Advanced helper and specialist section.
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

const advancedSectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 0,
};
