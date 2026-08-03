// Cnc3DFullPage — the 3D result at full window size.
//
// The docked pane is ~244px wide, which is enough to confirm a carve but not
// enough to inspect one. Same source, same renderer, bigger viewport. It builds
// its own WoodView (and so its own WebGL context) rather than moving the pane's
// canvas, because relocating a live context across the DOM loses the orbit.
//
// ADR-285: the Result/Path/X-ray toolbar, the section slider, Save PNG and the
// depth readout went with the old three.js scene. The ported reference page has
// none of them, and an identical port was the requirement.
//
// Portalled to document.body so no pane's overflow or stacking context can clip
// it. Escape closes; the pane behind is left mounted and untouched.

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { WoodView } from '../wood-viewer';
import type { DesignSceneSource } from './use-cnc-3d-scene';

const CLOSE_KEY = 'Escape';
const FULL_PAGE_CANVAS_HEIGHT_PX = 720;

export function Cnc3DFullPage(props: {
  readonly source: DesignSceneSource;
  readonly stockThicknessMm: number;
  readonly onClose: () => void;
}): JSX.Element {
  const { source, stockThicknessMm, onClose } = props;
  useCloseOnEscape(onClose);
  const grid = source.detailGrid ?? source.grid;

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="3D result, full page" style={overlayStyle}>
      <div style={barStyle}>
        <span style={titleStyle}>3D result</span>
        <span style={hintStyle}>Drag to orbit, scroll to zoom.</span>
        <button type="button" onClick={onClose} style={closeStyle} title="Close (Esc)">
          Close
        </button>
      </div>
      <div style={bodyStyle}>
        <WoodView
          grid={grid}
          stockThicknessMm={stockThicknessMm}
          heightPx={FULL_PAGE_CANVAS_HEIGHT_PX}
        />
      </div>
    </div>,
    document.body,
  );
}

// Escape is the expected way out of a full-window view; without it the only
// exit is a button the operator may have moved the pointer away from.
function useCloseOnEscape(onClose: () => void): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === CLOSE_KEY) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  background: 'var(--lf-bg-1)',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
};
const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 12px',
  flexShrink: 0,
};
const titleStyle: React.CSSProperties = { fontWeight: 600 };
const hintStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', flex: 1 };
const closeStyle: React.CSSProperties = { padding: '4px 12px', cursor: 'pointer' };
const bodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: '0 12px 12px',
};
