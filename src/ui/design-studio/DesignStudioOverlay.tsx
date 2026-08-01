// DesignStudioOverlay — the full-window Design Studio shell (ADR-272, DS-2).
//
// Same shape and the same z-index as Image Studio: fixed inset 0 at 1010,
// deliberately above --lf-z-dialog (1000) and below toasts (1100), with
// role="dialog" aria-modal="true" and a rAF-deferred focus so the Studio keymap
// receives keys immediately.
//
// Shortcut isolation is two independent halves, exactly as ADR-242 established:
// useRegisterModal() suppresses EVERY app-level shortcut wholesale, and the
// Studio binds its own keymap to this root div rather than to window. Esc is a
// ladder, not a close.

import { useCallback, useEffect, useRef } from 'react';
import { useRegisterModal } from '../common/use-register-modal';
import { useStore } from '../state';
import { DesignCanvas } from './DesignCanvas';
import { DesignOptionsBar } from './DesignOptionsBar';
import { DesignStatusBar } from './DesignStatusBar';
import { DesignToolRails } from './DesignToolRails';
import { DesignTopBar } from './DesignTopBar';
import { DesignSidePanel } from './preview3d/DesignSidePanel';
import { DesignViewport3D } from './viewport3d/DesignViewport3D';
import { handleDesignStudioKey } from './design-shortcuts';
import { useDesignStudioStore } from './design-studio-store';
import { fitView } from './design-view';

export function DesignStudioOverlay(): JSX.Element | null {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const session = useDesignStudioStore((state) => state.session);
  const setView = useDesignStudioStore((state) => state.setView);
  const workspace = useStore((state) => state.project.workspace);
  useRegisterModal();
  useInitialFocus(rootRef);

  const handleFit = useCallback(() => {
    const host = rootRef.current?.querySelector('canvas')?.parentElement;
    const rect = host?.getBoundingClientRect();
    if (rect === undefined || rect.width <= 0 || rect.height <= 0) return;
    setView(
      fitView({
        widthMm: workspace.width,
        heightMm: workspace.height,
        originXmm: 0,
        originYmm: 0,
        viewportWidthPx: rect.width,
        viewportHeightPx: rect.height,
      }),
    );
  }, [setView, workspace.width, workspace.height]);

  if (session === null) return null;
  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Design Studio"
      tabIndex={-1}
      style={overlayStyle}
      onKeyDown={(event) => handleDesignStudioKey(event, handleFit)}
    >
      <DesignTopBar onFit={handleFit} />
      <DesignOptionsBar />
      <div style={bodyStyle}>
        <DesignToolRails />
        <div style={mainColumnStyle}>
          {session.surface3d ? <DesignViewport3D /> : <DesignCanvas />}
        </div>
        <DesignSidePanel />
      </div>
      <DesignStatusBar />
    </div>
  );
}

// Deferred a frame so it wins the initial-focus race against whatever the app
// focused last — the kit-dialog convention Image Studio also follows.
function useInitialFocus(rootRef: React.RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const handle = requestAnimationFrame(() => rootRef.current?.focus());
    return () => cancelAnimationFrame(handle);
  }, [rootRef]);
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1010,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--lf-bg-0)',
  outline: 'none',
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  minHeight: 0,
};

const mainColumnStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
};
