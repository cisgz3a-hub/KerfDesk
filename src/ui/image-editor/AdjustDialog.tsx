// The Image Studio adjustment dialog (ADR-242, PP-E): schema-driven sliders
// with a live canvas preview (Preview ✓, Reset, Cancel, OK — the Photoshop
// dialog grammar). A floating panel, not a modal backdrop, so the operator
// can still pan/zoom the canvas to inspect the preview.

import { useEffect } from 'react';
import { lumaHistogram } from '../../core/image-adjust';
import { maskBounds } from '../../core/image-select';
import {
  refreshAdjustPreview,
  useAdjustDialogStore,
  type AdjustDialog,
} from './adjust-dialog-store';
import { CurvesEditor } from './CurvesEditor';
import { adjustmentById, DEFAULT_CURVE_POINTS, type AdjustParamSpec } from './editor-adjustments';
import type { EditorSession } from './editor-session';
import { useImageEditorStore } from './image-editor-store';

export function AdjustDialogPanel(): JSX.Element | null {
  const dialog = useAdjustDialogStore((s) => s.dialog);
  const session = useImageEditorStore((s) => s.session);
  if (dialog === null || session === null) return null;
  return <PanelBody dialog={dialog} session={session} />;
}

function PanelBody(props: {
  readonly dialog: AdjustDialog;
  readonly session: EditorSession;
}): JSX.Element {
  const { dialog, session } = props;
  const spec = adjustmentById(dialog.id);
  const store = useAdjustDialogStore.getState();

  // Live preview: recompute on a frame boundary so slider drags coalesce.
  useEffect(() => {
    if (!dialog.previewEnabled) return;
    const frame = requestAnimationFrame(refreshAdjustPreview);
    return () => cancelAnimationFrame(frame);
  }, [dialog.id, dialog.params, dialog.curvePoints, dialog.previewEnabled]);

  return (
    <div
      role="dialog"
      aria-label={spec.label}
      style={panelStyle}
      onKeyDown={(e) => {
        if (e.key === 'Escape') store.cancel();
        if (e.key === 'Enter') store.commit();
        e.stopPropagation();
      }}
    >
      <strong style={{ fontSize: 13 }}>{spec.label}</strong>
      {spec.hasHistogram ? <Histogram session={session} /> : null}
      {dialog.id === 'curves' ? (
        <CurvesEditor points={dialog.curvePoints ?? DEFAULT_CURVE_POINTS} session={session} />
      ) : null}
      {spec.params.map((param) => (
        <ParamSlider
          key={param.key}
          param={param}
          value={dialog.params[param.key] ?? param.defaultValue}
          onChange={(value) => store.setParams({ [param.key]: value })}
        />
      ))}
      <label style={previewToggleStyle} title="Show the result on the canvas while adjusting">
        <input
          type="checkbox"
          checked={dialog.previewEnabled}
          onChange={(e) => store.setPreviewEnabled(e.target.checked)}
          aria-label="Preview on canvas"
          title="Show the result on the canvas while adjusting"
        />
        Preview
      </label>
      <div style={actionsStyle}>
        <button
          type="button"
          className="lf-btn"
          onClick={store.reset}
          title="Reset every slider to its default"
        >
          Reset
        </button>
        <button
          type="button"
          className="lf-btn"
          onClick={store.cancel}
          title="Close without changing the image (Esc)"
        >
          Cancel
        </button>
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          onClick={store.commit}
          title="Apply to the image as one undo step (Enter)"
        >
          OK
        </button>
      </div>
    </div>
  );
}

function ParamSlider(props: {
  readonly param: AdjustParamSpec;
  readonly value: number;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  const { param, value, onChange } = props;
  return (
    <label style={sliderRowStyle}>
      <span style={sliderLabelStyle}>{param.label}</span>
      <input
        type="range"
        min={param.min}
        max={param.max}
        step={param.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1 }}
        aria-label={param.label}
        title={param.label}
      />
      <input
        type="number"
        min={param.min}
        max={param.max}
        step={param.step}
        value={value}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(Math.min(param.max, Math.max(param.min, next)));
        }}
        style={numberStyle}
        aria-label={`${param.label} value`}
        title={`${param.label} value`}
      />
    </label>
  );
}

const HISTOGRAM_WIDTH = 256;
const HISTOGRAM_HEIGHT = 56;

// The histogram reflects the doc at dialog-open time; painting and undo are
// parked while a dialog is up, so it cannot go stale.
function Histogram(props: { readonly session: EditorSession }): JSX.Element {
  const { session } = props;
  return (
    <canvas
      width={HISTOGRAM_WIDTH}
      height={HISTOGRAM_HEIGHT}
      style={histogramStyle}
      aria-label="Luma histogram of the current image"
      ref={(canvas) => {
        const ctx = canvas?.getContext('2d') ?? null;
        if (ctx === null) return;
        const rect = session.selection === null ? null : maskBounds(session.selection);
        drawHistogram(ctx, lumaHistogram(session.doc, rect, session.selection));
      }}
    />
  );
}

function drawHistogram(ctx: CanvasRenderingContext2D, bins: Uint32Array): void {
  ctx.clearRect(0, 0, HISTOGRAM_WIDTH, HISTOGRAM_HEIGHT);
  let max = 0;
  for (const count of bins) max = Math.max(max, count);
  if (max === 0) return;
  // Canvas paint, not themable chrome — mid-grey bars read on both themes.
  /* eslint-disable-next-line no-restricted-syntax */
  ctx.fillStyle = '#8a8a8a';
  for (let i = 0; i < bins.length; i += 1) {
    const h = Math.round(((bins[i] ?? 0) / max) * HISTOGRAM_HEIGHT);
    if (h > 0) ctx.fillRect(i, HISTOGRAM_HEIGHT - h, 1, h);
  }
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 12,
  zIndex: 5,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  width: 300,
  padding: 14,
  borderRadius: 8,
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
  boxShadow: 'var(--lf-shadow)',
};

const histogramStyle: React.CSSProperties = {
  width: '100%',
  height: HISTOGRAM_HEIGHT,
  borderRadius: 4,
  background: 'var(--lf-bg-2)',
};

const sliderRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  color: 'var(--lf-text)',
};

const sliderLabelStyle: React.CSSProperties = {
  width: 88,
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};

const numberStyle: React.CSSProperties = {
  width: 62,
  boxSizing: 'border-box',
  padding: '3px 6px',
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-input)',
  color: 'var(--lf-text)',
  borderRadius: 4,
  fontSize: 12,
};

const previewToggleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: 'var(--lf-text)',
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
};
