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
import { Relief3DViewerDialog } from '../relief-viewer';
import { useStore } from '../state';
import { reliefPropertyWidthMm } from './ReliefPlanningWidthDisclosure';
import { ReliefPropertyControls } from './ReliefPropertyControls';
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
  return (
    <section aria-label="Relief properties" style={sectionStyle}>
      <h3 style={headingStyle}>Relief</h3>
      <p style={metaStyle}>
        {relief.source} — {reliefMeta(relief)}
      </p>
      <ReliefSourceMeaning
        sourceKind={
          relief.reliefSource.kind === 'legacy-mesh'
            ? 'stl-top-projection'
            : relief.reliefSource.provenance.sourceKind
        }
      />
      {relief.reliefSource.kind === 'heightfield-v1' ? (
        <ReliefRecordedSourceDetails provenance={relief.reliefSource.provenance} />
      ) : null}
      <SelectedReliefFieldGeometry relief={relief} />
      {relief.reliefSource.kind === 'heightfield-v1' ? (
        <ReliefResolvedAspectDisclosure aspect={relief.reliefSource.mapping.aspect} />
      ) : null}
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
        <ReliefPropertyControls
          key={`${projectDocumentEpoch}:${relief.id}`}
          relief={relief}
          widthMm={reliefPropertyWidthMm(relief, physical.targetScaleX)}
        />
      </section>
  );}

function reliefMeta(relief: ReliefObject): string {
  if (relief.reliefSource.kind === 'legacy-mesh') {
    return `${Math.round(relief.reliefSource.meshPositions.length / VERTICES_PER_TRIANGLE_FLOATS)} triangles`;
  }
  const sourceBits = relief.reliefSource.provenance.sourceBitDepth;
  const sourceLabel = sourceBits === undefined ? '' : ` (source ${sourceBits}-bit)`;
  return `${relief.reliefSource.width} x ${relief.reliefSource.height}, canonical 16-bit${sourceLabel}`;
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
const viewerButtonStyle: React.CSSProperties = { marginBottom: 8 };
