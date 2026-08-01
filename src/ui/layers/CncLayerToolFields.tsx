// Per-layer bit selectors (Phase H.7 multi-tool). LayerBitSelect assigns
// the bit a layer cuts with (default = the machine's active bit);
// VClearToolSelect arms the two-stage v-carve's flat-floor clearing bit.
// Split from CncLayerFields.tsx, which sits near the file-size cap.

import {
  sceneObjectUsesOperation,
  type CncLayerSettings,
  type CncTool,
  type Layer,
} from '../../core/scene';
import { cncToolGeometryLabel } from '../common/cnc-tool-geometry-label';
import { NumberField as ClearableNumberField } from '../common/NumberField';
import { CncToolOptions } from '../machine/CncToolOptions';
import { useStore } from '../state';
import { useCncTools } from './CncLayerBitSelect';

export { LayerBitSelect } from './CncLayerBitSelect';
export { useCncTools };

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

export function VClearToolSelect(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  const tools = useCncTools();
  // Floor clearing emits ordinary constant-Z pocket passes. Only the flat
  // end-mill kernel can truthfully leave that floor; ball/core-box tools and
  // legacy engraving geometry must not be offered here.
  const flatTools = tools.filter((tool) => tool.kind === 'end-mill');
  const currentClearTool = tools.find((tool) => tool.id === props.settings.vClearToolId);
  const unavailableClearToolId =
    props.settings.vClearToolId !== undefined &&
    !flatTools.some((tool) => tool.id === props.settings.vClearToolId)
      ? props.settings.vClearToolId
      : null;
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
        {unavailableClearToolId === null ? null : (
          <option value={unavailableClearToolId} disabled>
            {unavailableClearToolLabel(unavailableClearToolId, currentClearTool)}
          </option>
        )}
        <CncToolOptions tools={flatTools} />
      </select>
    </Row>
  );
}

function unavailableClearToolLabel(toolId: string, tool: CncTool | undefined): string {
  const prefix = 'Current unsupported clearing bit (choose a flat end mill)';
  return tool === undefined
    ? `${prefix} — missing ${toolId}`
    : `${prefix} — ${cncToolGeometryLabel(tool)} — ${tool.name}`;
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
  const unavailableFinishToolId =
    props.settings.reliefFinishToolId !== undefined &&
    !tools.some((tool) => tool.id === props.settings.reliefFinishToolId)
      ? props.settings.reliefFinishToolId
      : null;
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
        {unavailableFinishToolId === null ? null : (
          <option value={unavailableFinishToolId} disabled>
            Current missing finishing bit — {unavailableFinishToolId}
          </option>
        )}
        <CncToolOptions tools={tools} />
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
  const isVCarve = props.settings.cutType === 'v-carve';
  const showCutDirection =
    props.settings.cutType === 'profile-outside' ||
    props.settings.cutType === 'profile-inside' ||
    props.settings.cutType === 'pocket';
  return (
    <Row label="Entry">
      {showCutDirection ? (
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
      ) : null}
      <ClearableNumberField
        min={0}
        max={isVCarve ? Number.MAX_VALUE : 45}
        step={0.5}
        value={(isVCarve ? props.settings.vCarveRampEntryDeg : props.settings.rampEntryDeg) ?? 0}
        onCommit={(deg) => commitRampEntry(props.settings, deg, props.onCommitSettings)}
        ariaLabel={`Ramp entry angle for ${props.layer.color}`}
        title={
          isVCarve
            ? "Maximum multi-lap contour-ramp angle. Use only the exact cutter manufacturer's approved angle; 0 keeps legacy stepped plunges."
            : 'Descend into cuts along the path at this angle instead of plunging straight down. 0 = plunge (default).'
        }
        style={rampInputStyle}
      />
      <span style={rampUnitStyle}>° ramp</span>
    </Row>
  );
}

function commitRampEntry(
  settings: CncLayerSettings,
  deg: number,
  commit: (settings: CncLayerSettings) => void,
): void {
  if (settings.cutType === 'v-carve') {
    const { vCarveRampEntryDeg: _removed, ...rest } = settings;
    commit(deg <= 0 ? rest : { ...rest, vCarveRampEntryDeg: deg });
    return;
  }
  const { rampEntryDeg: _removed, ...withoutRamp } = settings;
  if (deg <= 0) {
    commit(withoutRamp);
    return;
  }
  const { helixEntry: _helixRemoved, ...withoutHelix } = withoutRamp;
  commit({ ...withoutHelix, rampEntryDeg: deg });
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
