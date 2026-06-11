// Preview-mode status overlays (M27, AUDIT-2026-06-10 / WORKFLOW F-A8):
// the empty-preview hint ("No layers have Output enabled") and the
// out-of-bounds banner. Preview is the operator's primary pre-burn
// verification surface — a silently-empty preview or an unexplained red
// outline is a trust leak.

import type { Toolpath } from '../../core/job';
import type { Project } from '../../core/scene';
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
