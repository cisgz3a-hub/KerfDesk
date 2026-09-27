// CncLayerFields — per-layer CNC operation editor (Easel's per-object cut
// panel, applied per color layer). Rendered by the Artwork inspector instead of
// the laser fields when the project machine is CNC. Writes flow through the
// existing setLayerParam action as a whole `cnc` patch, so undo/dirty tracking
// and .lf2 persistence come for free.
//
// ADR-481: the cut type, bit and material, depth and feeds lead; each
// remaining section appears only for the cut types it serves and names its
// state when closed. Machine and stock values stay in Machine Setup. Named
// disclosures keep their inputs mounted, so folding one never discards an
// in-progress edit. Shared row/input controls live in CncLayerPrimitives.

import { useState } from 'react';
import { cncMaxFeedMmPerMin } from '../../core/cnc/cnc-head-feeds';
import {
  CNC_CUT_TYPES,
  DEFAULT_CNC_LAYER_SETTINGS,
  cutTypeLabel,
  type CncCutType,
  type CncLayerSettings,
  type Layer,
} from '../../core/scene';
import { useStore } from '../state';
import { withManualCncFeedPatch } from '../state/cnc-feed-provenance';
import {
  CncFeedFields,
  CncLayerAdvancedGroup,
  DepthPerPassField,
  VCarveToolWarning,
} from './CncLayerAdvancedFields';
import { CncTabFields } from './CncTabFields';
import { CncLineArtContoursField } from './CncLineArtContoursField';
import { CncOpenPathNote } from './CncOpenPathNote';
import { useLayerHasReliefObjects } from './CncLayerToolFields';
import { NumberField, Row, selectStyle } from './CncLayerPrimitives';
import { CncOperationToolFields } from './CncOperationToolFields';
import './cnc-operation-settings.css';

export function CncLayerFields(props: {
  readonly layer: Layer;
  readonly onSettingsChange?: (settings: CncLayerSettings) => void;
}): JSX.Element {
  const { layer } = props;
  // A new material or primary tool replaces feed drafts even when its recipe
  // produces the same canonical numbers. Secondary tool choices leave them alone.
  const [assignmentRevision, setAssignmentRevision] = useState(0);
  const setLayerParam = useStore((s) => s.setLayerParam);
  const deviceMaxFeed = useStore((s) => s.project.device.maxFeed);
  const machine = useStore((s) => s.project.machine);
  const hasReliefObjects = useLayerHasReliefObjects(layer);
  const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  const isCnc = machine?.kind === 'cnc';
  const maxFeed = isCnc
    ? cncMaxFeedMmPerMin({ maxFeed: deviceMaxFeed }, machine.params)
    : deviceMaxFeed;
  const spindleMaxRpm = isCnc ? machine.params.spindleMaxRpm : 24000;
  const stockThicknessMm = isCnc ? machine.stock.thicknessMm : 0;
  const isProfile = settings.cutType.startsWith('profile') || settings.cutType === 'inlay-pair';
  const commitSettings = (next: CncLayerSettings): void => {
    if (props.onSettingsChange !== undefined) props.onSettingsChange(next);
    else setLayerParam(layer.id, { cnc: next });
  };
  const commit = (patch: Partial<CncLayerSettings>): void =>
    commitSettings(withManualCncFeedPatch(settings, patch));
  const commitAssignment = (next: CncLayerSettings, replaceFeedDrafts: boolean): void => {
    if (replaceFeedDrafts) setAssignmentRevision((revision) => revision + 1);
    commitSettings(next);
  };
  // Material and bit recipes rewrite these numbers, so their drafts restart.
  const recipeKey = JSON.stringify([
    settings.materialKey ?? null,
    settings.toolId ?? null,
    assignmentRevision,
  ]);

  return (
    <div className="lf-cnc-settings">
      <CncCutTypeField layer={layer} settings={settings} onCommit={commit} />
      <CncOperationToolFields
        layer={layer}
        settings={settings}
        hasReliefObjects={hasReliefObjects}
        onCommitSettings={commitAssignment}
      />
      <VCarveToolWarning settings={settings} />
      <section className="lf-cnc-settings-card" aria-label="Depth and feeds">
        <CncDepthFields
          layer={layer}
          settings={settings}
          stockThicknessMm={stockThicknessMm}
          recipeKey={recipeKey}
          onCommit={commit}
        />
        <CncFeedFields
          key={recipeKey}
          layer={layer}
          settings={settings}
          maxFeed={maxFeed}
          spindleMaxRpm={spindleMaxRpm}
          onCommit={commit}
        />
      </section>
      <CncOpenPathNote layer={layer} settings={settings} />
      {/*
        CncThinDetailNote is deliberately not rendered here. It ran the whole
        V-carve ladder on the main thread from a React effect keyed on the
        layer's settings, so selecting the V-carve cut type blocked the UI for
        as long as a compile takes — measured at 13.7 s for 120 thin contours at
        3 mm depth. Nothing is lost by leaving it out: the ladder already
        reports thinResidual and passLimited to Job Review, which is the warning
        surface the operator confirms (rule 7). Restore it once the check runs
        on the preparation worker instead of the render thread. CncOpenPathNote
        above stays: it only flattens contours, it never builds the ladder.
      */}
      {hasReliefObjects ? (
        <p className="lf-cnc-settings-hint" role="note">
          Relief depth comes from the selected relief artwork. Cut depth here applies to vector
          shapes only.
        </p>
      ) : null}
      {isProfile ? <CncTabFields layer={layer} settings={settings} onCommit={commit} /> : null}
      <CncLayerAdvancedGroup
        layer={layer}
        settings={settings}
        hasReliefObjects={hasReliefObjects}
        onCommit={commit}
        onCommitSettings={commitSettings}
      />
    </div>
  );
}

// The cut type's one-line explanation is its tooltip. Traced edges follows
// only when the operation cuts imported or traced outlines.
function CncCutTypeField(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  const { layer, settings, onCommit: commit } = props;
  return (
    <section className="lf-cnc-settings-card" aria-label="Cut type">
      <Row label="Cut type" stacked>
        <select
          value={settings.cutType}
          onChange={(e) => commit(cutTypePatch(settings, e.target.value as CncCutType))}
          aria-label={`Cut type for ${layer.color}`}
          title={`${cutTypeLabel(settings.cutType)}: ${cutTypeHint(settings.cutType)}`}
          style={selectStyle}
        >
          {CNC_CUT_TYPES.map((cutType) => (
            <option key={cutType} value={cutType} title={cutTypeHint(cutType)}>
              {cutTypeLabel(cutType)}
            </option>
          ))}
        </select>
      </Row>
      <CncLineArtContoursField layer={layer} settings={settings} onCommit={commit} />
    </section>
  );
}

function cutTypePatch(settings: CncLayerSettings, cutType: CncCutType): Partial<CncLayerSettings> {
  return {
    cutType,
    ...(cutType === 'v-carve' && settings.cutType !== 'v-carve'
      ? { vCarveFlatDepthEnabled: false }
      : {}),
  };
}

function cutTypeHint(cutType: CncCutType): string {
  switch (cutType) {
    case 'profile-outside':
      return 'Cut around the outside edge to keep the shape at its drawn size.';
    case 'profile-inside':
      return 'Cut inside an opening, allowing for the width of the bit.';
    case 'profile-on-path':
    case 'engrave':
      return 'Follow the drawn line with the centre of the bit.';
    case 'pocket':
      return 'Remove the material inside closed shapes to the chosen depth.';
    case 'v-carve':
      return 'Use an angled bit to carve depth that follows the artwork width.';
    case 'inlay-pair':
      return 'Create a matching pocket and mirrored insert from this artwork.';
    case 'drill':
      return 'Drill at shape centres, removing material in depth increments.';
    case 'relief-rough':
    case 'relief-finish':
      return 'Machine the relief using its artwork depth and the assigned cutter.';
  }
}

// Cut depth and Depth per pass share one row. The measured stock thickness is
// one click away under Cut depth; V-carve asks about a flat floor first.
function CncDepthFields(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly stockThicknessMm: number;
  readonly recipeKey: string;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  const { layer, settings, onCommit } = props;
  const isVCarve = settings.cutType === 'v-carve';
  const flatDepthEnabled = settings.vCarveFlatDepthEnabled ?? true;
  const showDepth = !isVCarve || flatDepthEnabled;
  return (
    <>
      {isVCarve ? (
        <label className="lf-cnc-switch">
          <input
            type="checkbox"
            title="Limit the V-carve to a flat floor at Floor depth; areas wider than the V-bit reaches there are cleared flat. Leave off for an ordinary V-carve, where depth follows stroke width and the V-bit angle."
            checked={flatDepthEnabled}
            onChange={(event) => onCommit({ vCarveFlatDepthEnabled: event.target.checked })}
            aria-label={`Flat depth for ${layer.color}`}
          />
          <span>Flat floor</span>
        </label>
      ) : null}
      <div className="lf-cnc-depth-grid">
        {showDepth ? <CutDepthField {...props} /> : null}
        <DepthPerPassField
          key={props.recipeKey}
          layer={layer}
          settings={settings}
          onCommit={onCommit}
        />
        {!isVCarve && props.stockThicknessMm > 0 ? (
          <button
            type="button"
            className="lf-cnc-link-button lf-cnc-depth-grid__stock"
            onClick={() => onCommit({ depthMm: props.stockThicknessMm })}
            title="Set exactly to the measured stock thickness. Add a verified overcut manually only when the setup needs it."
          >
            Set to stock thickness ({props.stockThicknessMm} mm)
          </button>
        ) : null}
      </div>
    </>
  );
}

function CutDepthField(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  const { cutType } = props.settings;
  const label =
    cutType === 'v-carve' ? 'Floor depth' : cutType === 'inlay-pair' ? 'Insert depth' : 'Cut depth';
  const title =
    cutType === 'v-carve'
      ? 'Maximum V-carve depth. Areas wider than the V-bit reaches at this depth are cleared as a flat core.'
      : cutType === 'inlay-pair'
        ? 'Male insert profile depth. Equal to stock thickness to free the insert.'
        : 'Total depth below the stock top. Equal to stock thickness for a through cut.';
  return (
    <NumberField
      stacked
      layer={props.layer}
      label={label}
      unit="mm"
      value={props.settings.depthMm}
      min={0.05}
      max={200}
      step={0.5}
      title={title}
      onCommit={(depthMm) => props.onCommit({ depthMm })}
    />
  );
}
