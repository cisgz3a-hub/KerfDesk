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
import { previewHasBurnableContent, previewIssueFor, type PreviewIssue } from './preview-status';

function PreviewIssueBanner(props: { readonly issue: PreviewIssue | null }): JSX.Element | null {
  if (props.issue?.kind === 'too-complex') {
    return (
      <div className="lf-banner lf-banner--warning" style={bannerStyle} role="status">
        Route preview is too large to draw safely. Simplify the trace or reduce detail, then preview
        again.
      </div>
    );
  }
  if (props.issue?.kind === 'preparing-large-job') {
    return (
      <div className="lf-banner" style={bannerStyle} role="status">
        Large job: preparing the route preview in the background. It will appear here when ready —
        Start and Save do not wait for it.
      </div>
    );
  }
  if (props.issue?.kind === 'placement-unavailable') {
    return (
      <div className="lf-banner lf-banner--warning" style={bannerStyle} role="status">
        Preview unavailable: {props.issue.messages.join(' ')}
      </div>
    );
  }
  if (props.issue?.kind === 'preparation-failed') {
    return (
      <div className="lf-banner lf-banner--danger" style={bannerStyle} role="alert">
        Preview blocked: {props.issue.messages.join(' ')}
      </div>
    );
  }
  return null;
}

export function PreviewStatusOverlays(props: {
  readonly project: Project;
  readonly toolpath: Toolpath;
}): JSX.Element | null {
  const issue = previewIssueFor(props.toolpath);
  // Any preview issue (too-complex, placement failure) already explains the
  // blank route, so the scope-oriented "enable Output" hint must not fire.
  const empty = issue === null && !previewHasBurnableContent(props.project, props.toolpath);
  const outOfBounds = hasOutOfBoundsObjects(props.project);
  if (issue === null && !empty && !outOfBounds) return null;
  return (
    <div style={stackStyle}>
      <PreviewIssueBanner issue={issue} />
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
          data-help-id="control:preview.showTraversalMoves"
        />
        Traversal moves
      </label>
      <div style={statsGridStyle} aria-label="Preview distance statistics">
        <span>Cut</span>
        <strong>{formatMm(stats.cutMm)}</strong>
        <span>Travel</span>
        <strong>{formatMm(stats.travelMm)}</strong>
        {stats.plungeMm > 0 ? (
          <>
            <span>Plunge</span>
            <strong>{formatMm(stats.plungeMm)}</strong>
          </>
        ) : null}
        <span>Total</span>
        <strong>{formatMm(stats.totalMm)}</strong>
        <span>Time</span>
        <strong>{formatEstimate(props.estimate)}</strong>
        {props.estimate.kind === 'estimated' ? (
          <>
            <span>Cut time</span>
            <strong>{formatSeconds(props.estimate.breakdown.cutSeconds)}</strong>
            <span>Travel time</span>
            <strong>{formatSeconds(props.estimate.breakdown.travelSeconds)}</strong>
          </>
        ) : null}
      </div>
    </div>
  );
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  return `${minutes}m ${rounded % 60}s`;
}

export function PreviewControlsPanel(props: {
  readonly toolpath: Toolpath;
  readonly estimate: LiveJobEstimate;
  readonly routeLabel: string;
  readonly disabled: boolean;
  // ADR-103 G4: present only when a CNC removal grid exists to render.
  readonly onOpen3D?: () => void;
}): JSX.Element {
  return (
    <div
      className="lf-chip"
      style={previewControlsPanelStyle}
      role="group"
      aria-label="Preview route controls and statistics"
    >
      <PreviewRouteControls
        disabled={props.disabled}
        passBoundaries={passBoundaryFractions(props.toolpath)}
      />
      {props.onOpen3D !== undefined ? (
        <button
          type="button"
          className="lf-button"
          style={compactButtonStyle}
          onClick={props.onOpen3D}
          aria-label="Open 3D cut preview"
          title="Open the 3D view of the simulated cut at the current scrubber position."
        >
          3D
        </button>
      ) : null}
      <PreviewStatsPanel
        toolpath={props.toolpath}
        estimate={props.estimate}
        routeLabel={props.routeLabel}
      />
    </div>
  );
}

// CNC pass starts = downward plunges. Their arc-length fractions drive the
// Prev/Next pass stepper; laser toolpaths have none, hiding the buttons.
function passBoundaryFractions(toolpath: Toolpath): ReadonlyArray<number> {
  if (toolpath.totalLength <= 0) return [];
  const fractions: number[] = [];
  let walked = 0;
  for (const step of toolpath.steps) {
    if (step.kind === 'plunge' && step.toZ < step.fromZ) {
      fractions.push(walked / toolpath.totalLength);
    }
    walked += step.length;
  }
  return fractions;
}

export function PreviewRouteControls(
  props: {
    readonly disabled?: boolean;
    readonly passBoundaries?: ReadonlyArray<number>;
  } = {},
): JSX.Element {
  const previewPlaying = useUiStore((s) => s.previewPlaying);
  const setPreviewPlaying = useUiStore((s) => s.setPreviewPlaying);
  const scrubberT = useUiStore((s) => s.scrubberT);
  const setScrubberT = useUiStore((s) => s.setScrubberT);
  const previewPlaybackSpeed = useUiStore((s) => s.previewPlaybackSpeed);
  const setPreviewPlaybackSpeed = useUiStore((s) => s.setPreviewPlaybackSpeed);
  const disabled = props.disabled === true;
  const passBoundaries = props.passBoundaries ?? [];
  return (
    <div style={routeControlsStyle} role="group" aria-label="Route preview controls">
      <button
        type="button"
        className="lf-btn"
        style={compactButtonStyle}
        disabled={disabled}
        aria-label={previewPlaying ? 'Pause route preview' : 'Play route preview'}
        title={previewPlaying ? 'Pause route preview playback.' : 'Play route preview playback.'}
        data-help-id="control:preview.routePlayback"
        onClick={() => {
          if (disabled) return;
          if (!previewPlaying && scrubberT >= 1) setScrubberT(0);
          setPreviewPlaying(!previewPlaying);
        }}
      >
        {previewPlaying ? 'Pause' : 'Play'}
      </button>
      {passBoundaries.length > 0 ? (
        <PassStepButtons
          disabled={disabled}
          boundaries={passBoundaries}
          scrubberT={scrubberT}
          onJump={(t) => {
            setScrubberT(t);
            setPreviewPlaying(false);
          }}
        />
      ) : null}
      <button
        type="button"
        className="lf-btn"
        style={compactButtonStyle}
        disabled={disabled}
        aria-label="Restart route preview"
        title="Restart route preview playback from the beginning."
        data-help-id="control:preview.routeRestart"
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
          title="Choose how quickly the compressed route preview plays."
          data-help-id="control:preview.routeSpeed"
          onChange={(e) => setPreviewPlaybackSpeed(e.currentTarget.value as PreviewPlaybackSpeed)}
        >
          <option value="slow">1x</option>
          <option value="normal">10x</option>
          <option value="fast">40x</option>
        </select>
      </label>
    </div>
  );
}

// Prev / Next CNC pass stepper (H.2). Jumps the scrubber to the arc-length
// fraction just past a pass-start plunge so the depth shading shows that
// pass completed.
const PASS_JUMP_EPS = 1e-4;

function PassStepButtons(props: {
  readonly disabled: boolean;
  readonly boundaries: ReadonlyArray<number>;
  readonly scrubberT: number;
  readonly onJump: (t: number) => void;
}): JSX.Element {
  const prev = [...props.boundaries].reverse().find((b) => b < props.scrubberT - PASS_JUMP_EPS);
  const next = props.boundaries.find((b) => b > props.scrubberT + PASS_JUMP_EPS);
  return (
    <>
      <button
        type="button"
        className="lf-button"
        style={compactButtonStyle}
        disabled={props.disabled || prev === undefined}
        aria-label="Jump to previous pass"
        title="Jump the preview to the start of the previous CNC pass."
        onClick={() => {
          if (prev !== undefined) props.onJump(prev);
        }}
      >
        ⏮ Pass
      </button>
      <button
        type="button"
        className="lf-button"
        style={compactButtonStyle}
        disabled={props.disabled || next === undefined}
        aria-label="Jump to next pass"
        title="Jump the preview to the start of the next CNC pass."
        onClick={() => {
          if (next !== undefined) props.onJump(next);
        }}
      >
        Pass ⏭
      </button>
    </>
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
