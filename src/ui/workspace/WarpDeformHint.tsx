// What the Warp and Deform tools do, shown while one is on (LBG-T06), with the
// keys that finish it. Enter applies and Esc cancels from anywhere but a text
// box or a dialog. The listener runs in the capture phase so Esc only leaves
// the tool and keeps the selection, instead of also clearing it as the global
// Esc does.

import { useEffect } from 'react';
import { warpDeformHandlesUnmoved } from '../../core/geometry/warp-deform-map';
import { isEditableShortcutTarget } from '../common/keyboard-targets';
import { isModalOpen, useUiStore } from '../state/ui-store';
import { useActiveWarpDeformSession } from './use-warp-deform-preview';
import {
  applyWarpDeformTool,
  cancelWarpDeformTool,
  resetWarpDeformHandles,
} from './warp-deform-tool';

const HINT_ATTRIBUTE = 'data-warp-deform-hint';

export const WARP_HINT =
  'Drag the corner handles to warp the selection; hold Shift to keep them a parallelogram. Press Enter to apply or Esc to cancel.';
export const DEFORM_HINT =
  'Drag the handles to bend the selection. Press Enter to apply or Esc to cancel.';

export function WarpDeformHint(): JSX.Element | null {
  const session = useActiveWarpDeformSession();
  useWarpDeformKeys(session !== null);
  if (session === null) return null;
  const moved = !warpDeformHandlesUnmoved(session.grid, session.box, session.handles);
  const noun = session.grid === 'warp' ? 'warp' : 'deform';
  return (
    <div role="status" style={hintStyle} {...{ [HINT_ATTRIBUTE]: session.grid }}>
      <span>{session.grid === 'warp' ? WARP_HINT : DEFORM_HINT}</span>
      <button
        type="button"
        className="lf-btn"
        disabled={!moved}
        onClick={resetWarpDeformHandles}
        title="Put every handle back where it started."
      >
        Reset handles
      </button>
      <button
        type="button"
        className="lf-btn"
        onClick={cancelWarpDeformTool}
        title={`Leave the artwork as it was and stop the ${noun} (Esc).`}
      >
        Cancel
      </button>
      <button
        type="button"
        className="lf-btn lf-btn--primary"
        onClick={applyWarpDeformTool}
        title={`Apply the ${noun} to the artwork as one undo step (Enter).`}
      >
        Apply
      </button>
    </div>
  );
}

function useWarpDeformKeys(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' && event.key !== 'Escape') return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isModalOpen(useUiStore.getState()) || isEditableShortcutTarget(event.target)) return;
      // A focused hint button answers Enter itself.
      if (event.key === 'Enter' && insideHint(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Enter') applyWarpDeformTool();
      else cancelWarpDeformTool();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [active]);
}

function insideHint(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${HINT_ATTRIBUTE}]`) !== null;
}

const hintStyle: React.CSSProperties = {
  position: 'absolute',
  left: 12,
  bottom: 52,
  zIndex: 8,
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  maxWidth: 'min(520px, calc(100% - 24px))',
  padding: '8px 12px',
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  color: 'var(--lf-text)',
  background: 'var(--lf-bg-1)',
  boxShadow: 'var(--lf-shadow)',
  fontSize: 12,
};
