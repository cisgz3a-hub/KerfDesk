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
          <p className="artcraft-hint">Full editable sources travel with your .lf2 project.</p>
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
            {bridge.documents.length === 0 && <p>No studio documents yet.</p>}
          </div>
          <NewDocument bridge={bridge} />
        </aside>
        <main className="artcraft-editor" ref={viewport} aria-label="Native artwork editor">
          {bridge.session === null && (
            <div className="artcraft-empty">
              <h2>Your complete creative workspace</h2>
              <p>Create a vector or photo document, or choose one saved in this project.</p>
              <p>VectorCraft and PhotoCraft open here with their full editing tools.</p>
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
function NewDocument({ bridge }: { readonly bridge: EditorBridge }): JSX.Element {
  return (
    <section className="artcraft-create" aria-label="Create studio document">
      <h3>New document</h3>
      <div className="artcraft-editor-choices">
        <button
          type="button"
          disabled={bridge.busy}
          aria-pressed={bridge.editor === 'vector'}
          title="Create a document with VectorCraft's vector drawing tools"
          onClick={() => bridge.chooseEditor('vector')}
        >
          VectorCraft
        </button>
        <button
          type="button"
          disabled={bridge.busy}
          aria-pressed={bridge.editor === 'photo'}
          title="Create a document with PhotoCraft's photo editing tools"
          onClick={() => bridge.chooseEditor('photo')}
        >
          PhotoCraft
        </button>
      </div>
      <label>
        Start with a file (optional)
        <input
          key={bridge.editor}
          type="file"
          title="Choose an SVG for VectorCraft or a PNG or JPEG for PhotoCraft"
          accept={bridge.editor === 'vector' ? '.svg' : '.png,.jpg,.jpeg'}
          disabled={bridge.busy}
          onChange={(event) => bridge.setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      <div className="artcraft-dimensions">
        <label>
          Width (mm)
          <input
            type="number"
            min="0.01"
            step="any"
            value={bridge.width}
            title="Set the artwork width in millimetres"
            disabled={bridge.busy}
            onChange={(event) => bridge.setWidth(event.target.value)}
          />
        </label>
        <label>
          Height (mm)
          <input
            type="number"
            min="0.01"
            step="any"
            value={bridge.height}
            title="Set the artwork height in millimetres"
            disabled={bridge.busy}
            onChange={(event) => bridge.setHeight(event.target.value)}
          />
        </label>
      </div>
      <Button
        variant="primary"
        disabled={bridge.busy || bridge.status?.editors[bridge.editor].installed !== true}
        onClick={() => void bridge.open()}
      >
        Open {bridge.editor === 'vector' ? 'VectorCraft' : 'PhotoCraft'}
      </Button>
      <p className="artcraft-hint">
        Save project keeps native layers. Apply sends SVG or a flattened photo to the machining
        workspace.
      </p>
    </section>
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
        <span className="artcraft-preview">KERFDESK · DESKTOP PREVIEW</span>
        <h2 id="artcraft-title">Design Studio</h2>
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
          Back to old studio
        </Button>
      </div>
    </header>
  );
}
