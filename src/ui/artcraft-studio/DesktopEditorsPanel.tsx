import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../kit/Button';
import { useDialogA11y } from '../common/use-dialog-a11y';
import { useUiStore } from '../state/ui-store';
import { useRegisterModal } from '../common/use-register-modal';
import { useDesktopEditors } from './use-desktop-editors';
import { useNativeEditorViewport } from './use-native-editor-viewport';
import './artcraft-studio.css';

type EditorBridge = ReturnType<typeof useDesktopEditors>;

export function DesktopEditorsPanel({ onClose }: { readonly onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const bridge = useDesktopEditors();
  const modalDepth = useUiStore((state) => state.modalDepth);
  const viewport = useNativeEditorViewport(
    bridge.session,
    bridge.busy || modalDepth > 2,
    bridge.report,
  );
  useRegisterModal();
  const close = () => {
    void bridge.close(onClose);
  };
  useDialogA11y(ref, close, { closeOnEscape: false });
  return createPortal(
    <div
      className="artcraft-backdrop"
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby="artcraft-title"
      tabIndex={-1}
      onKeyDown={(event) => {
        event.stopPropagation();
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          void bridge.save();
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <StudioHeader bridge={bridge} close={close} />
      <div className="artcraft-workspace">
        <aside className="artcraft-sidebar">
          <h3>Project documents</h3>
          <p className="artcraft-hint">Restore an existing legacy source saved in this project.</p>
          <div className="artcraft-documents">
            {bridge.documents.map((document) => (
              <button
                type="button"
                key={document.id}
                title={`Resume editing ${document.title}`}
                disabled={bridge.busy}
                aria-pressed={document.id === (bridge.session?.documentId ?? bridge.session?.id)}
                onClick={() => void bridge.resume(document.id)}
              >
                <strong>{document.title}</strong>
                <small>{document.editor === 'photo' ? 'PhotoCraft' : 'VectorCraft'}</small>
              </button>
            ))}
            {bridge.documents.length === 0 && <p>This project has no legacy editor documents.</p>}
          </div>
        </aside>
        <main className="artcraft-editor" ref={viewport} aria-label="Native artwork editor">
          {bridge.session === null && (
            <div className="artcraft-empty">
              <h2>Restore a legacy document</h2>
              <p>Choose a saved source to continue editing it in VectorCraft or PhotoCraft.</p>
              <p>Create new artwork in Design Studio's Vectors or Photos workspace.</p>
            </div>
          )}
        </main>
      </div>
      <footer className="artcraft-footer" role={bridge.error ? 'alert' : 'status'}>
        <span className={bridge.error ? 'artcraft-error' : ''}>
          {bridge.busy ? 'Working…' : bridge.message}
        </span>
        <span>Native source → project · Apply → machining artwork</span>
      </footer>
    </div>,
    document.body,
  );
}
function StudioHeader({
  bridge,
  close,
}: {
  readonly bridge: EditorBridge;
  readonly close: () => void;
}): JSX.Element {
  return (
    <header className="artcraft-heading">
      <div>
        <span className="artcraft-preview">KERFDESK · LEGACY RECOVERY</span>
        <h2 id="artcraft-title">Legacy editor documents</h2>
      </div>
      <div className="artcraft-toolbar">
        <Button disabled={bridge.busy} onClick={() => void bridge.save()}>
          Save project
        </Button>
        <Button
          variant="primary"
          disabled={bridge.busy || bridge.session === null}
          onClick={() => {
            if (bridge.session) void bridge.apply(bridge.session.id);
          }}
        >
          Apply to KerfDesk
        </Button>
        <Button disabled={bridge.busy} onClick={close}>
          Back to Design Studio
        </Button>
      </div>
    </header>
  );
}
