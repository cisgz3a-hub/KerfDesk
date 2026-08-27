// SelectedReliefProperties — the relief carve-parameter editor (width /
// depth / source interpretation), promised when H.5 roughing landed. CNC-only: relief
// objects are inert in laser mode, so the section only renders for a CNC
// project with exactly one relief selected (the laser Shape Properties
// panel is the mirror case — ADR-101 §3).

import { useState } from 'react';
// Deep import: core/relief's public barrel is a ratcheted over-cap legacy
// barrel and may only shrink; keep the established exports intact.
import { reliefPhysicalDimensions } from '../../core/relief/relief-physical-dimensions';
import { machineKindOf, type ReliefObject } from '../../core/scene';
import type { HeightfieldReliefObject, MeshReliefObject } from '../../core/scene/relief';
import { Relief3DViewerDialog } from '../relief-viewer';
import { useStore } from '../state';
import { ReliefInputLevelsControl } from './ReliefInputLevelsControl';
import { ReliefGammaControl } from './ReliefGammaControl';
import { ReliefMaskOutsideMeaningControl } from './ReliefMaskOutsideMeaningControl';
import { ReliefMaskThresholdControl } from './ReliefMaskThresholdControl';
import { useDebouncedCommit } from './use-debounced-commit';
import {
  ReliefPlanningWidthDisclosure,
  reliefPropertyWidthMm,
  reliefPropertyWidthSourceMm,
  reliefPlanningWidthTitle,
} from './ReliefPlanningWidthDisclosure';
import { ReliefRecordedSourceDetails } from './ReliefRecordedSourceDetails';
import { ReliefResolvedAspectDisclosure } from './ReliefResolvedAspectDisclosure';
import { SelectedReliefFieldGeometry } from './SelectedReliefFieldGeometry';
import { ReliefSourceMeaning } from './ReliefSourceMeaning';

const VERTICES_PER_TRIANGLE_FLOATS = 9;

export function SelectedReliefProperties(): JSX.Element | null {
  const relief = useStore((s) => {
    if (machineKindOf(s.project.machine) !== 'cnc') return null;
    if (s.selectedObjectId === null || s.additionalSelectedIds.size > 0) return null;
    const selected = s.project.scene.objects.find((o) => o.id === s.selectedObjectId);
    return selected?.kind === 'relief' ? selected : null;
  });
  const stockThicknessMm = useStore((s) =>
    s.project.machine?.kind === 'cnc' ? s.project.machine.stock.thicknessMm : 0,
  );
  const projectDocumentEpoch = useStore((s) => s.projectDocumentEpoch);
  const [viewerOpen, setViewerOpen] = useState(false);
  if (relief === null) return null;
  const physical = reliefPhysicalDimensions(relief);
  const widthSourceMm = reliefPropertyWidthSourceMm(relief);
  const widthMm = reliefPropertyWidthMm(relief, physical.targetScaleX);
  return (
    <section aria-label="Relief properties" style={sectionStyle}>
      <h3 style={headingStyle}>Relief</h3>
      <p style={metaStyle}>
        {relief.source} — {reliefMeta(relief)}
      </p>
      <ReliefSourceDisclosure relief={relief} />
      <ReliefGeometryDisclosures relief={relief} />
      <button
        type="button"
        onClick={() => setViewerOpen(true)}
        title="Open the real-time 3D view of this relief (ADR-102)."
        style={viewerButtonStyle}
      >
        View 3D…
      </button>
      {viewerOpen ? (
        <Relief3DViewerDialog
          relief={relief}
          stockThicknessMm={stockThicknessMm}
          onClose={() => setViewerOpen(false)}
        />
      ) : null}
      <ReliefNumberField
        key={`${projectDocumentEpoch}:${relief.id}:width`}
        relief={relief}
        label="Width"
        value={widthSourceMm}
        scale={physical.targetScaleX}
        step={1}
        title={reliefPlanningWidthTitle(relief)}
        commitKey="targetWidthMm"
      />
      <ReliefPlanningWidthDisclosure relief={relief} widthMm={widthMm} />
      <ReliefNumberField
        key={`${projectDocumentEpoch}:${relief.id}:depth`}
        relief={relief}
        label="Depth"
        value={relief.reliefDepthMm}
        step={0.5}
        title="Total relief depth: the source's numeric range maps to [-depth, 0] below the stock top."
        commitKey="reliefDepthMm"
      />
      {isMeshRelief(relief) ? (
        <BackgroundSelect relief={relief} />
      ) : (
        <>
          <PolaritySelect relief={relief} />
          <ReliefGammaControl key={`${projectDocumentEpoch}:${relief.id}:gamma`} relief={relief} />
          <ReliefInputLevelsControl
            key={`${projectDocumentEpoch}:${relief.id}:input-levels`}
            relief={relief}
          />
          <ReliefMaskThresholdControl
            key={`${projectDocumentEpoch}:${relief.id}:mask-threshold`}
            relief={relief}
          />
          <ReliefMaskOutsideMeaningControl relief={relief} />
        </>
      )}
    </section>
  );
}

function ReliefGeometryDisclosures(props: { readonly relief: ReliefObject }): JSX.Element {
  return (
    <>
      <SelectedReliefFieldGeometry relief={props.relief} />
      {props.relief.reliefSource.kind === 'heightfield-v1' ? (
        <ReliefResolvedAspectDisclosure aspect={props.relief.reliefSource.mapping.aspect} />
      ) : null}
    </>
  );
}

function isMeshRelief(relief: ReliefObject): relief is MeshReliefObject {
  return relief.reliefSource.kind === 'legacy-mesh';
}

function ReliefSourceDisclosure(props: { readonly relief: ReliefObject }): JSX.Element {
  const source = props.relief.reliefSource;
  return (
    <>
      <ReliefSourceMeaning
        sourceKind={
          source.kind === 'legacy-mesh' ? 'stl-top-projection' : source.provenance.sourceKind
        }
      />
      {source.kind === 'heightfield-v1' ? (
        <ReliefRecordedSourceDetails provenance={source.provenance} />
      ) : null}
    </>
  );
}

function reliefMeta(relief: ReliefObject): string {
  if (relief.reliefSource.kind === 'legacy-mesh') {
    return `${Math.round(relief.reliefSource.meshPositions.length / VERTICES_PER_TRIANGLE_FLOATS)} triangles`;
  }
  const sourceBits = relief.reliefSource.provenance.sourceBitDepth;
  const sourceLabel = sourceBits === undefined ? '' : ` (source ${sourceBits}-bit)`;
  return `${relief.reliefSource.width} x ${relief.reliefSource.height}, canonical 16-bit${sourceLabel}`;
}

function ReliefNumberField(props: {
  readonly relief: ReliefObject;
  readonly label: string;
  readonly value: number;
  readonly scale?: number;
  readonly step: number;
  readonly title: string;
  readonly commitKey: 'targetWidthMm' | 'reliefDepthMm';
}): JSX.Element {
  // A scale change remounts the input so cleanup cancels a pending commit
  // parsed under the old authored-to-physical mapping.
  return <ReliefNumberInput key={props.scale ?? 1} {...props} />;
}

function ReliefNumberInput(props: {
  readonly relief: ReliefObject;
  readonly label: string;
  readonly value: number;
  readonly scale?: number;
  readonly step: number;
  readonly title: string;
  readonly commitKey: 'targetWidthMm' | 'reliefDepthMm';
}): JSX.Element {
  const setReliefParams = useStore((s) => s.setReliefParams);
  const scale = props.scale ?? 1;
  const canonicalDisplay = formatReliefValue(props.value * scale);
  const debounced = useDebouncedCommit<number>({
    value: props.value,
    commit: (value) => setReliefParams(props.relief.id, { [props.commitKey]: value }),
    reconcileKey: scale,
    parse: (input) => {
      // Preserve the exact authored value when the untouched canonical display
      // is rounded. Otherwise blur could create an undo frame and subtly alter
      // bounds at irrational transform scales.
      if (input.trim() === canonicalDisplay) return props.value;
      const parsed = Number.parseFloat(input) / scale;
      return positiveFinite(parsed) ? parsed : props.value;
    },
    format: (value) => formatReliefValue(value * scale),
  });
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>{props.label}</span>
      <span style={controlStyle}>
        <input
          type="number"
          step={props.step}
          value={debounced.displayValue}
          onChange={debounced.onChange}
          onBlur={debounced.onBlur}
          aria-label={`Relief ${props.label.toLowerCase()} (mm)`}
          title={props.title}
          style={inputStyle}
        />
        <span style={unitStyle}>mm</span>
      </span>
    </label>
  );
}

const MAX_RELIEF_DIMENSION_DECIMALS = 6;
function formatReliefValue(value: number): string {
  if (!Number.isFinite(value)) return '';
  const rounded = value
    .toFixed(MAX_RELIEF_DIMENSION_DECIMALS)
    .replace(/0+$/, '')
    .replace(/\.$/, '');
  return rounded === '0' && value !== 0 ? String(value) : rounded;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function BackgroundSelect(props: { readonly relief: MeshReliefObject }): JSX.Element {
  const setReliefParams = useStore((s) => s.setReliefParams);
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>Background</span>
      <span style={controlStyle}>
        <select
          value={props.relief.reliefSource.emptyCells}
          onChange={(e) =>
            setReliefParams(props.relief.id, {
              emptyCells: e.target.value === 'top' ? 'top' : 'floor',
            })
          }
          aria-label="Relief background"
          title="Where mesh-free cells sit: carved to the floor (model stands proud) or kept at the stock top."
          style={selectStyle}
        >
          <option value="floor">Carve away (floor)</option>
          <option value="top">Keep at stock top</option>
        </select>
      </span>
    </label>
  );
}

function PolaritySelect(props: { readonly relief: HeightfieldReliefObject }): JSX.Element {
  const setReliefParams = useStore((s) => s.setReliefParams);
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>Polarity</span>
      <span style={controlStyle}>
        <select
          value={props.relief.reliefSource.mapping.polarity}
          onChange={(event) =>
            setReliefParams(props.relief.id, {
              polarity: event.target.value === 'light-is-deep' ? 'light-is-deep' : 'light-is-high',
            })
          }
          aria-label="Relief height-map polarity"
          title="Declares whether lighter samples are nearer the stock top or deeper into the stock."
          style={selectStyle}
        >
          <option value="light-is-high">Light is high</option>
          <option value="light-is-deep">Light is deep</option>
        </select>
      </span>
    </label>
  );
}

const sectionStyle: React.CSSProperties = {
  borderTop: '1px solid var(--lf-border)',
  marginTop: 12,
  paddingTop: 10,
};
const headingStyle: React.CSSProperties = { fontSize: 13, margin: '0 0 4px 0' };
const metaStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-faint)',
  margin: '0 0 8px 0',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '92px 1fr',
  alignItems: 'center',
  gap: 8,
  marginBottom: 6,
};
const labelStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
const controlStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 6px',
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-input)',
  color: 'var(--lf-text)',
  borderRadius: 4,
};
const selectStyle: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: 12, padding: '2px 4px' };
const unitStyle: React.CSSProperties = { fontSize: 12, color: 'var(--lf-text-faint)' };
const viewerButtonStyle: React.CSSProperties = { marginBottom: 8 };
