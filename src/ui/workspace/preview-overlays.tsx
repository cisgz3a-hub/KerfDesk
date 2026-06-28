// Preview-mode status overlays (M27, AUDIT-2026-06-10 / WORKFLOW F-A8):
// the empty-preview hint ("No layers have Output enabled") and the
// out-of-bounds banner. Preview is the operator's primary pre-burn
// verification surface — a silently-empty preview or an unexplained red
// outline is a trust leak.

import { summarizeToolpathDistances, type Toolpath } from '../../core/job';
import type { Project } from '../../core/scene';
import type { LiveJobEstimate } from '../laser/live-job-estimate';
import { useUiStore, type PreviewPlaybackSpeed } from '../state/ui-store';
import { hasOutOfBoundsObjects } from './out-of-bounds';
import { previewHasBurnableContent, previewIssueFor } from './preview-status';

export function PreviewStatusOverlays(props: {
  readonly project: Project;
  readonly toolpath: Toolpath;
}): JSX.Element | null {
  const tooComplex = previewIssueFor(props.toolpath) === 'too-complex';
  const empty = !tooComplex && !previewHasBurnableContent(props.project, props.toolpath);
  const outOfBounds = hasOutOfBoundsObjects(props.project);
  if (!empty && !outOfBounds && !tooComplex) return null;
  return (
    <div style={stackStyle}>
      {tooComplex ? (
        <div className="lf-banner lf-banner--warning" style={bannerStyle} role="status">
          Route preview is too large to draw safely. Simplify the trace or reduce detail, then
          preview again.
        </div>
      ) : null}
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
  readonly routeLabel?: string;
}): JSX.Element {
  const showPreviewTravel = useUiStore((s) => s.showPreviewTravel);
  const setShowPreviewTravel = useUiStore((s) => s.setShowPreviewTravel);
  const stats = summarizeToolpathDistances(props.toolpath);
  return (
    <div style={statsPanelStyle} role="group" aria-label="Preview options">
      <div style={routeLabelStyle} aria-label="Route preview scope">
        <span>Route</span>
        <strong>{props.routeLabel ?? 'Whole project'}</strong>
      </div>
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

export function PreviewControlsPanel(props: {
  readonly toolpath: Toolpath;
  readonly estimate: LiveJobEstimate;
  readonly routeLabel: string;
  readonly disabled: boolean;
}): JSX.Element {
  return (
    <div
      className="lf-chip"
      style={previewControlsPanelStyle}
      role="group"
      aria-label="Preview route controls and statistics"
    >
      <PreviewRouteControls disabled={props.disabled} />
      <PreviewStatsPanel
        toolpath={props.toolpath}
        estimate={props.estimate}
        routeLabel={props.routeLabel}
      />
    </div>
  );
}

export function PreviewRouteControls(props: { readonly disabled?: boolean } = {}): JSX.Element {
  const previewPlaying = useUiStore((s) => s.previewPlaying);
  const setPreviewPlaying = useUiStore((s) => s.setPreviewPlaying);
  const scrubberT = useUiStore((s) => s.scrubberT);
  const setScrubberT = useUiStore((s) => s.setScrubberT);
  const previewPlaybackSpeed = useUiStore((s) => s.previewPlaybackSpeed);
  const setPreviewPlaybackSpeed = useUiStore((s) => s.setPreviewPlaybackSpeed);
  const disabled = props.disabled === true;
  return (
    <div style={routeControlsStyle} role="group" aria-label="Route preview controls">
      <button
        type="button"
        className="lf-button"
        style={compactButtonStyle}
        disabled={disabled}
        aria-label={previewPlaying ? 'Pause route preview' : 'Play route preview'}
        onClick={() => {
          if (disabled) return;
          if (!previewPlaying && scrubberT >= 1) setScrubberT(0);
          setPreviewPlaying(!previewPlaying);
        }}
      >
        {previewPlaying ? 'Pause' : 'Play'}
      </button>
      <button
        type="button"
        className="lf-button"
        style={compactButtonStyle}
        disabled={disabled}
        aria-label="Restart route preview"
        onClick={() => {
          if (disabled) return;
          setScrubberT(0);
          setPreviewPlaying(false);
        }}
      >
        Restart
      </button>
      <label style={speedControlStyle}>
        Speed
        <select
          value={previewPlaybackSpeed}
          aria-label="Route preview speed"
          disabled={disabled}
          onChange={(e) => setPreviewPlaybackSpeed(e.currentTarget.value as PreviewPlaybackSpeed)}
        >
          <option value="slow">Slow</option>
          <option value="normal">Normal</option>
          <option value="fast">Fast</option>
        </select>
      </label>
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
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  flexWrap: 'wrap',
};

const routeLabelStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto auto',
  columnGap: 6,
  alignItems: 'baseline',
  whiteSpace: 'nowrap',
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

const routeControlsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
};

const previewControlsPanelStyle: React.CSSProperties = {
  position: 'absolute',
  left: 24,
  bottom: 64,
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  flexWrap: 'wrap',
  borderRadius: 4,
  padding: '7px 10px',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  maxWidth: 'calc(100% - 48px)',
};

const compactButtonStyle: React.CSSProperties = {
  minHeight: 28,
  padding: '4px 10px',
};

const speedControlStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  whiteSpace: 'nowrap',
};

function formatMm(value: number): string {
  if (!Number.isFinite(value)) return '0.0 mm';
  return `${value.toFixed(1)} mm`;
}

function formatEstimate(estimate: LiveJobEstimate): string {
  if (estimate.kind === 'estimated') return estimate.label;
  if (estimate.kind === 'too-large') return 'ETA skipped';
  return '-';
}
