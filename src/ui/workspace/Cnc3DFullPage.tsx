// Cnc3DFullPage — the 3D result at full window size.
//
// The docked pane is ~244px wide, which is enough to confirm a carve but not
// enough to inspect one. This is the same scene, the same source, and the same
// scrubber — only the viewport is bigger. It gets its own useCnc3dScene (and so
// its own renderer) rather than moving the pane's canvas, because relocating a
// live WebGL context across the DOM loses the operator's orbit.
//
// Portalled to document.body so no pane's overflow or stacking context can clip
// it. Escape closes; the pane behind is left mounted and untouched.

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Viewer3DToolbar } from '../viewer3d/Viewer3DToolbar';
import { DEFAULT_DISPLAY_MODE, type Viewer3DDisplayMode } from '../viewer3d/viewer3d-display-mode';
import { SECTION_DISABLED_FRACTION } from '../viewer3d/viewer3d-clipping';
import { DEFAULT_SCREENSHOT_SCALE, screenshotFileName } from '../viewer3d/viewer3d-screenshot';
import { useCnc3dScene, type DesignSceneSource } from './use-cnc-3d-scene';

const CLOSE_KEY = 'Escape';

export function Cnc3DFullPage(props: {
  readonly source: DesignSceneSource;
  readonly stockThicknessMm: number;
  readonly scrubberT: number;
  readonly onClose: () => void;
}): JSX.Element {
  const { source, stockThicknessMm, scrubberT, onClose } = props;
  const { canvasRef, state, controls } = useCnc3dScene(source, stockThicknessMm, scrubberT);
  const [mode, setMode] = useState<Viewer3DDisplayMode>(DEFAULT_DISPLAY_MODE);
  const [sectionFraction, setSectionFraction] = useState(SECTION_DISABLED_FRACTION);
  useCloseOnEscape(onClose);

  // Pushed on every change AND on every state change: the controls no-op until
  // the WebGL context exists, so a mode picked while it was still loading has
  // to be re-applied once it is ready.
  useEffect(() => {
    controls.setDisplayMode(mode);
    controls.setSectionFraction(sectionFraction);
  }, [controls, mode, sectionFraction, state]);

  const handleSavePng = useCallback(() => {
    const dataUrl = controls.capturePng(DEFAULT_SCREENSHOT_SCALE);
    if (dataUrl === null) return;
    const link = document.createElement('a');
    link.href = dataUrl;
    // The Project model carries no name, so the filename falls back to the
    // module's own prefix rather than inventing a field to read.
    link.download = screenshotFileName('', new Date().toISOString());
    link.click();
  }, [controls]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="3D result, full page" style={overlayStyle}>
      <div style={barStyle}>
        <span style={titleStyle}>3D result</span>
        <span style={hintStyle}>
          {state === 'failed'
            ? '3D view unavailable in this browser.'
            : 'Drag to move, right-drag to orbit, scroll to zoom.'}
        </span>
        <button type="button" onClick={onClose} style={closeStyle} title="Close (Esc)">
          Close
        </button>
      </div>
      <div style={toolbarRowStyle}>
        <Viewer3DToolbar
          mode={mode}
          onModeChange={setMode}
          sectionFraction={sectionFraction}
          onSectionChange={setSectionFraction}
          onSavePng={handleSavePng}
        />
      </div>
      <canvas ref={canvasRef} aria-label="Live 3D cut result" style={canvasStyle} />
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
const toolbarRowStyle: React.CSSProperties = { padding: '0 12px 8px', flexShrink: 0 };
const hintStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', flex: 1 };
const closeStyle: React.CSSProperties = { padding: '4px 12px', cursor: 'pointer' };
// The canvas fills what's left; the hook's ResizeObserver re-fits the drawing
// buffer to whatever the layout gives it.
const canvasStyle: React.CSSProperties = {
  display: 'block',
  flex: 1,
  width: '100%',
  minHeight: 0,
};
