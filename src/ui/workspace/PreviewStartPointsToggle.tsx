// Preview "Start points" toggle (ADR-385). Offered only when the route has a
// closed Line cut to mark, so laser-free and CNC previews stay unchanged.

import type { Toolpath } from '../../core/job';
import { useUiStore } from '../state/ui-store';
import { previewCutStartMarkers } from './preview-cut-start-markers';

export function PreviewStartPointsToggle(props: {
  readonly toolpath: Toolpath;
}): JSX.Element | null {
  const show = useUiStore((s) => s.showPreviewStartPoints);
  const setShow = useUiStore((s) => s.setShowPreviewStartPoints);
  if (previewCutStartMarkers(props.toolpath).length === 0) return null;
  return (
    <label
      style={toggleStyle}
      title="Mark where each closed cut starts and the direction it runs, exactly as the G-code does. Operator-set starts are drawn in amber."
    >
      <input
        type="checkbox"
        checked={show}
        onChange={(e) => setShow(e.currentTarget.checked)}
        title="Show closed cut start points in Preview only."
        aria-label="Show closed cut start points in Preview"
      />
      Start points
    </label>
  );
}

const toggleStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  whiteSpace: 'nowrap',
};
