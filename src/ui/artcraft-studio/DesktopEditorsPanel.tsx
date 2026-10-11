import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../kit/Button';
import { useDialogA11y } from '../common/use-dialog-a11y';
import { useRegisterModal } from '../common/use-register-modal';
import type { StudioEditor } from './artcraft-api';
import { useDesktopEditors } from './use-desktop-editors';
type EditorBridge = ReturnType<typeof useDesktopEditors>;
import './artcraft-studio.css';

export function DesktopEditorsPanel({ onClose }: { readonly onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useRegisterModal();
  useDialogA11y(ref, onClose);
  const bridge = useDesktopEditors();
  return createPortal(
    <div
      className="artcraft-backdrop"
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby="artcraft-title"
      tabIndex={-1}
      onKeyDown={(event) => event.stopPropagation()}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="artcraft-panel">
        <header className="artcraft-heading">
          <div>
            <span className="artcraft-preview">DESKTOP PREVIEW</span>
            <h2 id="artcraft-title">A bigger studio, connected to KerfDesk</h2>
          </div>
          <Button onClick={onClose}>Close</Button>
        </header>
        <p>
          Design in the full VectorCraft or PhotoCraft desktop editor. Each opens in its own window.
          Your existing Design Studio remains available.
        </p>
        <EditorChoices bridge={bridge} />
        <EditorInputs bridge={bridge} />
        <EditorSessions bridge={bridge} />
        <p
          role={bridge.error ? 'alert' : 'status'}
          className={bridge.error ? 'artcraft-error' : 'artcraft-hint'}
        >
          {bridge.message}
        </p>
      </div>
    </div>,
    document.body,
  );
}

function EditorCard(props: {
  readonly editor: StudioEditor;
  readonly selected: boolean;
  readonly installed: boolean;
  readonly onChoose: (editor: StudioEditor) => void;
}): JSX.Element {
  const vector = props.editor === 'vector';
  return (
    <button
      className="artcraft-card"
      type="button"
      aria-pressed={props.selected}
      onClick={() => props.onChoose(props.editor)}
    >
      <strong>{vector ? 'VectorCraft' : 'PhotoCraft'}</strong>
      <span>
        {vector
          ? 'Shapes, text and editable vector artwork'
          : 'Layers, masks, brushes and photo adjustments'}
      </span>
      <small>{props.installed ? 'Ready' : 'Not installed'}</small>
    </button>
  );
}

function EditorChoices({ bridge }: { readonly bridge: EditorBridge }): JSX.Element {
  return (
    <>
      <div className="artcraft-cards">
        <EditorCard
          editor="vector"
          selected={bridge.editor === 'vector'}
          installed={bridge.status?.editors.vector.installed ?? false}
          onChoose={bridge.chooseEditor}
        />
        <EditorCard
          editor="photo"
          selected={bridge.editor === 'photo'}
          installed={bridge.status?.editors.photo.installed ?? false}
          onChoose={bridge.chooseEditor}
        />
      </div>
      {bridge.status !== null && !bridge.status.available && (
        <p role="status">The desktop editor bridge is not available in this build.</p>
      )}
      {bridge.status !== null && !bridge.status.editors[bridge.editor].installed && (
        <p role="status">This editor has not been prepared for this preview build yet.</p>
      )}
    </>
  );
}

function EditorInputs({ bridge }: { readonly bridge: EditorBridge }): JSX.Element {
  return (
    <>
      <div className="artcraft-fields">
        <label>
          Start with a file (optional)
          <input
            key={bridge.editor}
            type="file"
            accept={bridge.editor === 'vector' ? '.svg' : '.png,.jpg,.jpeg'}
            disabled={bridge.busy}
            onChange={(event) => bridge.setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Width (mm)
          <input
            type="number"
            min="0.01"
            step="any"
            value={bridge.width}
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
            disabled={bridge.busy}
            onChange={(event) => bridge.setHeight(event.target.value)}
          />
        </label>
      </div>
      <p className="artcraft-hint">
        SVG for vectors; PNG or JPEG for photos. New documents use these dimensions. Applied artwork
        uses the editor's measured physical dimensions. Native layers stay in the editor document;
        photo output is flattened for engraving.
      </p>
      <Button
        variant="primary"
        disabled={
          bridge.busy ||
          bridge.status?.available !== true ||
          bridge.status.editors[bridge.editor].installed !== true
        }
        onClick={() => void bridge.open()}
      >
        Open {bridge.editor === 'vector' ? 'VectorCraft' : 'PhotoCraft'}
      </Button>
    </>
  );
}

function EditorSessions({ bridge }: { readonly bridge: EditorBridge }): JSX.Element {
  return (
    <>
      <section className="artcraft-sessions" aria-labelledby="artcraft-sessions-title">
        <div className="artcraft-heading">
          <h3 id="artcraft-sessions-title">Editor sessions</h3>
          <Button disabled={bridge.busy} onClick={() => void bridge.refresh()}>
            Refresh
          </Button>
        </div>
        <p>
          Apply saves a native document revision in the editor, then exports artwork here to add or
          update it in the current KerfDesk project. Review the import notices and dimensions before
          machining.
        </p>
        {bridge.status?.sessions.length === 0 && (
          <p className="artcraft-hint">Open an editor to start your first session.</p>
        )}
        {bridge.status?.sessions.map((session) => (
          <div className="artcraft-session" key={session.id}>
            <div>
              <strong>{session.title}</strong>
              <span>
                {session.editor === 'vector' ? 'VectorCraft' : 'PhotoCraft'} ·{' '}
                {session.running ? 'Open' : 'Closed'}
              </span>
            </div>
            <div className="artcraft-heading">
              {!session.running && (
                <Button disabled={bridge.busy} onClick={() => void bridge.resume(session.id)}>
                  Reopen editor
                </Button>
              )}
              <Button
                disabled={bridge.busy || !session.running}
                onClick={() => void bridge.apply(session.id)}
              >
                Apply to KerfDesk
              </Button>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
