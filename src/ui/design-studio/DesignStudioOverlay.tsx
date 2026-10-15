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

import { useCallback, useRef, useState } from 'react';
import { useDialogA11y } from '../common/use-dialog-a11y';
import { isEditableShortcutTarget } from '../common/keyboard-targets';
import { useRegisterModal } from '../common/use-register-modal';
import { useStore } from '../state';
import { DesignCanvas } from './DesignCanvas';
import { DesignOptionsBar } from './DesignOptionsBar';
import { DesignStatusBar } from './DesignStatusBar';
import { DesignToolRails } from './DesignToolRails';
import { DesignTopBar } from './DesignTopBar';
import { DesignSidePanel } from './preview3d/DesignSidePanel';
import { DesignViewport3D, type DesignViewportActions } from './viewport3d/DesignViewport3D';
import { handleDesignStudioKey } from './design-shortcuts';
import { useDesignStudioStore } from './design-studio-store';
import { fitView } from './design-view';
import { useDesignPhotoSelection } from './use-design-photo-selection';
import { DesignPhotoWorkspace } from './DesignPhotoWorkspace';
import { useImageEditorStore } from '../image-editor/image-editor-store';
import { handleEditorKeyDown, handleEditorKeyUp } from '../image-editor/editor-shortcuts';

export function DesignStudioOverlay(): JSX.Element | null {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewport3dRef = useRef<DesignViewportActions | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<'vectors' | 'photos'>('vectors');
  const session = useDesignStudioStore((state) => state.session);
  const closeStudio = useDesignStudioStore((state) => state.closeStudio);
  const setView = useDesignStudioStore((state) => state.setView);
  const workspace = useStore((state) => state.project.workspace);
  const changeWorkspace = (mode: 'vectors' | 'photos'): void => {
    if (mode === workspaceMode) return;
    useImageEditorStore.getState().closeEditor();
    setWorkspaceMode(mode);
    rootRef.current?.focus();
  };
  const closeWorkspace = (): void => {
    useImageEditorStore.getState().closeEditor();
    closeStudio();
  };
  const photoActions = useDesignPhotoSelection(() => setWorkspaceMode('photos'));
  useRegisterModal();
  useDialogA11y(rootRef, closeWorkspace, { closeOnEscape: false, initialFocus: 'surface' });

  const handleFit = useCallback(() => {
    if (useDesignStudioStore.getState().session?.surface3d) {
      viewport3dRef.current?.fit();
      return;
    }
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
      onKeyDown={(event) => {
        if (workspaceMode === 'vectors') handleDesignStudioKey(event, handleFit);
        else handlePhotoWorkspaceKey(event, () => changeWorkspace('vectors'));
      }}
      onKeyUp={workspaceMode === 'photos' ? handleEditorKeyUp : undefined}
    >
      <StudioNavigation mode={workspaceMode} onChange={changeWorkspace} onClose={closeWorkspace} />
      {workspaceMode === 'photos' ? (
        <DesignPhotoWorkspace />
      ) : (
        <>
          <DesignTopBar onFit={handleFit} />
          <DesignOptionsBar />
          <div style={bodyStyle}>
            <DesignToolRails />
            <div style={mainColumnStyle}>
              {session.surface3d ? (
                <DesignViewport3D actionsRef={viewport3dRef} />
              ) : (
                <DesignCanvas {...photoActions} />
              )}
            </div>
            <DesignSidePanel {...photoActions} />
          </div>
          <DesignStatusBar />
        </>
      )}
    </div>
  );
}

function handlePhotoWorkspaceKey(
  event: React.KeyboardEvent<HTMLDivElement>,
  onBack: () => void,
): void {
  if (useImageEditorStore.getState().session !== null) {
    handleEditorKeyDown(event);
  } else if (
    event.key === 'Escape' &&
    !event.defaultPrevented &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !isEditableShortcutTarget(event.target)
  ) {
    event.preventDefault();
    onBack();
  }
}

function StudioNavigation({
  mode,
  onChange,
  onClose,
}: {
  readonly mode: 'vectors' | 'photos';
  readonly onChange: (mode: 'vectors' | 'photos') => void;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <nav className="design-workspace-nav" aria-label="Studio workspaces">
      <button
        type="button"
        className="lf-btn"
        aria-pressed={mode === 'vectors'}
        title="Draw vector shapes and compose them with project photos"
        onClick={() => onChange('vectors')}
      >
        Vectors
      </button>
      <button
        type="button"
        className="lf-btn"
        aria-pressed={mode === 'photos'}
        title="Import photos or edit the photos saved in this project"
        onClick={() => onChange('photos')}
      >
        Photos
      </button>
      <span>
        {mode === 'vectors'
          ? 'Compose photos and vector artwork together'
          : 'Design Studio · Edit project photos'}
      </span>
      {mode === 'photos' ? (
        <button
          type="button"
          className="lf-btn"
          title="Return to the photo and vector composition canvas"
          onClick={() => onChange('vectors')}
        >
          Back to canvas
        </button>
      ) : null}
      {mode === 'photos' ? (
        <button
          type="button"
          className="lf-btn design-workspace-close"
          title="Close Design Studio and return to the project workspace"
          onClick={onClose}
        >
          Close studio
        </button>
      ) : null}
    </nav>
  );
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
