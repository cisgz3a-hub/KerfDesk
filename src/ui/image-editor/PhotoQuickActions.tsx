import { useAdjustDialogStore } from './adjust-dialog-store';
import type { AdjustmentId } from './editor-adjustments';
import { useImageEditorStore } from './image-editor-store';
import { useResizeDialogStore } from './resize-dialog-store';

const ADJUSTMENTS: readonly { readonly id: AdjustmentId; readonly label: string }[] = [
  { id: 'remove-white-background', label: 'Clean up white paper' },
  { id: 'brightness-contrast', label: 'Brightness & contrast' },
  { id: 'levels', label: 'Levels' },
  { id: 'threshold', label: 'Black & white' },
];

/** Common photo preparation tasks share the full editor's preview and Undo path. */
export function PhotoQuickActions(): JSX.Element {
  const hasSession = useImageEditorStore((state) => state.session !== null);
  const transforming = useImageEditorStore((state) => state.transform !== null);
  const setTool = useImageEditorStore((state) => state.setTool);
  const openAdjustment = useAdjustDialogStore((state) => state.open);
  const openResize = useResizeDialogStore((state) => state.open);
  const disabled = !hasSession || transforming;
  return (
    <section style={panelStyle} aria-label="Photo quick tools">
      <strong>Prepare your photo</strong>
      <p style={hintStyle}>
        Crop, clean up and adjust the active layer. Apply keeps the image and editable layers in
        your project.
      </p>
      <div style={actionsStyle}>
        <button
          type="button"
          className="lf-btn"
          disabled={disabled}
          onClick={() => setTool({ kind: 'crop' })}
        >
          Crop photo
        </button>
        <button
          type="button"
          className="lf-btn"
          disabled={disabled}
          onClick={() => openResize('image-size')}
        >
          Resize pixels
        </button>
        {ADJUSTMENTS.map((action) => (
          <button
            key={action.id}
            type="button"
            className="lf-btn"
            disabled={disabled}
            onClick={() => openAdjustment(action.id)}
          >
            {action.label}
          </button>
        ))}
      </div>
      {transforming ? (
        <p style={hintStyle}>Finish or cancel Free Transform first (Enter / Esc).</p>
      ) : null}
    </section>
  );
}

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  borderBottom: '1px solid var(--lf-border)',
  fontSize: 12,
};
const actionsStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const hintStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  lineHeight: 1.5,
};
