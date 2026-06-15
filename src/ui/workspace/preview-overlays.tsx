// Preview-mode status overlays (M27, AUDIT-2026-06-10 / WORKFLOW F-A8):
// the empty-preview hint ("No layers have Output enabled") and the
// out-of-bounds banner. Preview is the operator's primary pre-burn
// verification surface — a silently-empty preview or an unexplained red
// outline is a trust leak.

import { summarizeToolpathDistances, type Toolpath } from '../../core/job';
import type { Project } from '../../core/scene';
import type { LiveJobEstimate } from '../laser/live-job-estimate';
import { useUiStore } from '../state/ui-store';
import { hasOutOfBoundsObjects } from './out-of-bounds';
import { previewHasBurnableContent } from './preview-status';

export function PreviewStatusOverlays(props: {
  readonly project: Project;
  readonly toolpath: Toolpath;
}): JSX.Element | null {
  const empty = !previewHasBurnableContent(props.project, props.toolpath);
  const outOfBounds = hasOutOfBoundsObjects(props.project);
  if (!empty && !outOfBounds) return null;
  return (
    <div style={stackStyle}>
      {empty ? (
        <div className="lf-chip" style={hintStyle} role="status">
          Nothing to preview — enable Output on at least one layer with objects.
        </div>
      ) : null}
      {outOfBounds ? (
        <div className="lf-banner lf-banner--danger" style={bannerStyle} role="alert">
          Some objects extend past the bed (red dashed outlines). Preflight will refuse Start / Save
          G-code until they fit.
        </div>
      ) : null}
    </div>
  );
}

export function PreviewStatsPanel(props: {
  readonly toolpath: Toolpath;
  readonly estimate: LiveJobEstimate;
}): JSX.Element {
  const showPreviewTravel = useUiStore((s) => s.showPreviewTravel);
  const setShowPreviewTravel = useUiStore((s) => s.setShowPreviewTravel);
  const stats = summarizeToolpathDistances(props.toolpath);
  return (
    <div className="lf-chip" style={statsPanelStyle} role="group" aria-label="Preview options">
      <label
        style={travelToggleStyle}
        title="Show or hide laser-off traversal moves in Preview only. G-code output is unchanged."
      >
        <input
          type="checkbox"
          checked={showPreviewTravel}
          onChange={(e) => setShowPreviewTravel(e.currentTarget.checked)}
          title="Show traversal moves in Preview only."
          aria-label="Show traversal moves in Preview"
          data-help-id="preview.showTraversalMoves"
        />
        Traversal moves
      </label>
      <div style={statsGridStyle} aria-label="Preview distance statistics">
        <span>Cut</span>
        <strong>{formatMm(stats.cutMm)}</strong>
        <span>Travel</span>
        <strong>{formatMm(stats.travelMm)}</strong>
        <span>Total</span>
        <strong>{formatMm(stats.totalMm)}</strong>
        <span>Time</span>
        <strong>{formatEstimate(props.estimate)}</strong>
      </div>
    </div>
  );
}

const stackStyle: React.CSSProperties = {
  position: 'absolute',
  top: 36,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  pointerEvents: 'none',
  maxWidth: 'calc(100% - 48px)',
};

const hintStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  fontFamily: 'system-ui, sans-serif',
};

const bannerStyle: React.CSSProperties = {
  fontFamily: 'system-ui, sans-serif',
};

const statsPanelStyle: React.CSSProperties = {
  position: 'absolute',
  left: 24,
  bottom: 56,
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  borderRadius: 4,
  padding: '7px 10px',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
};

const travelToggleStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  whiteSpace: 'nowrap',
};

const statsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto auto',
  columnGap: 8,
  rowGap: 2,
  alignItems: 'baseline',
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 11,
};

function formatMm(value: number): string {
  if (!Number.isFinite(value)) return '0.0 mm';
  return `${value.toFixed(1)} mm`;
}

function formatEstimate(estimate: LiveJobEstimate): string {
  if (estimate.kind === 'estimated') return estimate.label;
  if (estimate.kind === 'too-large') return 'large job';
  return '-';
}
