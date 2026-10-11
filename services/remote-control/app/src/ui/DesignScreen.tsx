import { useEffect } from 'react';
import { controller } from '../core/controller';
import { canEdit, store, type Tool } from '../core/store';
import { Canvas, fitView, useContentBox } from './Canvas';
import { RAIL_INSET } from './canvas-view';
import { useApp } from './hooks';
import { Icon, type IconName } from './icons';
import { ArrangeSheet, ImportSheet, PropertiesSheet, ShapeSheet, TextSheet } from './design-sheets';

const TOOLS: { tool: Tool; icon: IconName; label: string; edit: boolean }[] = [
  { tool: 'select', icon: 'select', label: 'Select and move', edit: false },
  { tool: 'pan', icon: 'pan', label: 'Pan', edit: false },
  { tool: 'text', icon: 'text', label: 'Add text', edit: true },
  { tool: 'rect', icon: 'rect', label: 'Draw rectangle', edit: true },
  { tool: 'ellipse', icon: 'ellipse', label: 'Draw ellipse', edit: true },
  { tool: 'pen', icon: 'pen', label: 'Draw freehand', edit: true },
];

export function DesignScreen() {
  const tool = useApp((state) => state.tool);
  const editable = useApp(canEdit);
  const scene = useApp((state) => state.scene);
  const workspace = useApp((state) => state.workspace);
  const sheet = useApp((state) => state.sheet);
  useKeyboard(editable);

  const sharingOff = workspace?.permissions?.artworkSharingEnabled === false;
  const empty = workspace !== null && workspace.totalArtwork === 0;
  return (
    <div className="main">
      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Canvas />
        <nav className="rail" aria-label="Tools">
          {TOOLS.map((item) => (
            <button
              key={item.tool}
              type="button"
              aria-label={item.label}
              title={item.label}
              aria-pressed={tool === item.tool}
              disabled={item.edit && !editable}
              onClick={() => store.set({ tool: item.tool, draft: null })}
            >
              <Icon name={item.icon} />
            </button>
          ))}
          <hr />
          <button
            type="button"
            aria-label="Import a file"
            title="Import a file"
            disabled={!editable}
            onClick={() => store.set({ sheet: { kind: 'import' } })}
          >
            <Icon name="import" />
          </button>
        </nav>
        <HistoryBar />
        <ZoomBar />
        {!editable && workspace !== null ? (
          <span className="chip readonly-chip">View only · editing needs approval on the PC</span>
        ) : null}
        {workspace === null ? <CanvasMessage title="Connecting to your PC…" busy /> : null}
        {sharingOff ? (
          <CanvasMessage
            title="Artwork sharing is off"
            body="Boxes show where artwork is. To see the real shapes here, turn on “Share artwork previews and text” in KerfDesk → Settings → Phone & MCP on the PC."
            subtle
          />
        ) : scene?.status === 'unavailable' ? (
          <CanvasMessage
            title="Preview unavailable"
            body={scene.message ?? 'View this design on the PC.'}
            subtle
          />
        ) : empty ? (
          <CanvasMessage
            title="Your bed is empty"
            body={
              editable
                ? 'Pick a tool on the left to draw, add text or import a file.'
                : 'Artwork you add on the PC appears here.'
            }
            subtle
          />
        ) : null}
        <ActionBar />
      </div>
      {sheet?.kind === 'properties' ? <PropertiesSheet /> : null}
      {sheet?.kind === 'text' ? <TextSheet at={sheet.at} /> : null}
      {sheet?.kind === 'shape' ? <ShapeSheet shape={sheet.shape} /> : null}
      {sheet?.kind === 'arrange' ? <ArrangeSheet /> : null}
      {sheet?.kind === 'import' ? <ImportSheet /> : null}
    </div>
  );
}

function CanvasMessage({
  title,
  body,
  busy,
  subtle,
}: {
  title: string;
  body?: string;
  busy?: boolean;
  subtle?: boolean;
}) {
  return (
    <div
      className="canvas-empty"
      style={subtle ? { alignItems: 'start', paddingTop: 64 } : undefined}
    >
      <div className="card" role="status">
        <div className="card-title">
          {busy ? <span className="spinner" /> : <Icon name="sparkle" size={18} />}
          {title}
        </div>
        {body === undefined ? null : (
          <p className="note" style={{ margin: 0 }}>
            {body}
          </p>
        )}
      </div>
    </div>
  );
}

function HistoryBar() {
  const history = useApp((state) => state.workspace?.history);
  const editable = useApp(canEdit);
  const dirty = useApp((state) => state.workspace?.dirty === true);
  const hasFile = useApp((state) => state.workspace?.saved?.hasFile === true);
  if (!editable) return null;
  return (
    <div className="history">
      <button
        type="button"
        aria-label="Undo"
        title="Undo"
        disabled={history?.canUndo !== true}
        onClick={() => void controller.write('undo')}
      >
        <Icon name="undo" />
      </button>
      <button
        type="button"
        aria-label="Redo"
        title="Redo"
        disabled={history?.canRedo !== true}
        onClick={() => void controller.write('redo')}
      >
        <Icon name="redo" />
      </button>
      {controller.designControl() ? (
        <button
          type="button"
          aria-label={hasFile ? 'Save on the PC' : 'Save (save once on the PC first)'}
          title={hasFile ? 'Save' : 'Save once on the PC first'}
          disabled={!dirty}
          onClick={async () => {
            const result = await controller.write<{ saved?: boolean; message?: string }>(
              'save_project',
            );
            if (result !== null)
              store.toast(
                result.message ?? (result.saved === true ? 'Saved.' : 'Not saved.'),
                result.saved === true ? 'success' : 'warning',
              );
          }}
        >
          <Icon name="save" />
        </button>
      ) : null}
    </div>
  );
}

function ZoomBar() {
  const view = useApp((state) => state.view);
  const content = useContentBox();
  const zoomBy = (factor: number) => {
    const current = store.get().view;
    const element = document.querySelector('.canvas-wrap');
    if (current === null || element === null) return;
    const { width, height } = element.getBoundingClientRect();
    const scale = Math.max(0.05, Math.min(400, current.scale * factor));
    const cx = current.x + width / (2 * current.scale);
    const cy = current.y + height / (2 * current.scale);
    store.set({ view: { scale, x: cx - width / (2 * scale), y: cy - height / (2 * scale) } });
  };
  const fit = () => {
    const element = document.querySelector('.canvas-wrap');
    if (element === null) return;
    const { width, height } = element.getBoundingClientRect();
    store.set({ view: fitView(content, width, height, 28, RAIL_INSET) });
  };
  return (
    <div
      className="zoom"
      style={{
        bottom: useApp((state) => state.selection.length > 0 || state.draft !== null) ? 86 : 10,
      }}
    >
      <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.4)}>
        <Icon name="minus" size={18} />
      </button>
      <span>{view === null ? '—' : `${Math.round((view.scale * 100) / 3.78)}%`}</span>
      <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.4)}>
        <Icon name="plus" size={18} />
      </button>
      <button type="button" aria-label="Fit to bed" onClick={fit}>
        <Icon name="fit" size={18} />
      </button>
    </div>
  );
}

function ActionBar() {
  const selection = useApp((state) => state.selection);
  const draft = useApp((state) => state.draft);
  const editable = useApp(canEdit);
  if (draft !== null) {
    const apply = async () => {
      // The draft object is the retry key: an uncertain Apply re-sends the identical request.
      const result =
        draft.kind === 'pen'
          ? await controller.write(
              'add_polyline',
              { pointsMm: draft.points.map((p) => ({ xMm: p.x, yMm: p.y })), closed: false },
              { retry: draft },
            )
          : await controller.write(
              draft.kind === 'rect' ? 'add_rectangle' : 'add_ellipse',
              { xMm: draft.x, yMm: draft.y, widthMm: draft.width, heightMm: draft.height },
              { retry: draft },
            );
      if (result !== null && store.get().draft === draft) store.set({ draft: null });
    };
    return (
      <div className="actionbar" role="toolbar" aria-label="Drawing">
        <span className="count">
          {draft.kind === 'pen'
            ? 'Freehand line'
            : `${draft.width.toFixed(1)} × ${draft.height.toFixed(1)} mm`}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => store.set({ draft: null })}>
          <Icon name="close" />
          Cancel
        </button>
        <button type="button" className="primary" onClick={() => void apply()}>
          <Icon name="check" />
          Apply
        </button>
      </div>
    );
  }
  if (selection.length === 0) return null;
  const arrange = (action: string) =>
    controller.write('arrange_artwork', { artworkIds: selection, action });
  return (
    <div className="actionbar" role="toolbar" aria-label="Selection">
      <span className="count">{selection.length} selected</span>
      <button type="button" onClick={() => store.set({ sheet: { kind: 'properties' } })}>
        <Icon name="props" />
        Properties
      </button>
      {editable ? (
        <>
          <button type="button" onClick={() => store.set({ sheet: { kind: 'arrange' } })}>
            <Icon name="align" />
            Arrange
          </button>
          <button type="button" onClick={() => void arrange('duplicate')}>
            <Icon name="copy" />
            Duplicate
          </button>
          <button
            type="button"
            className="danger"
            onClick={async () => {
              const ids = selection;
              store.set({ selection: [] });
              await controller.write(
                'arrange_artwork',
                { artworkIds: ids, action: 'delete' },
                { success: 'Deleted. Undo is on the toolbar.' },
              );
            }}
          >
            <Icon name="trash" />
            Delete
          </button>
        </>
      ) : null}
      <button
        type="button"
        className="icon-only"
        aria-label="Clear selection"
        title="Clear selection"
        onClick={() => void controller.select([])}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}

function useKeyboard(editable: boolean) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const { selection, sheet } = store.get();
      if (sheet !== null || !editable) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        void controller.write(event.shiftKey ? 'redo' : 'undo');
        return;
      }
      if (selection.length === 0) return;
      const step = event.shiftKey ? 10 : 1;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const move = moves[event.key];
      if (move !== undefined) {
        event.preventDefault();
        void controller.move(selection, move[0], move[1]);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        void controller.write('arrange_artwork', { artworkIds: selection, action: 'delete' });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [editable]);
}
