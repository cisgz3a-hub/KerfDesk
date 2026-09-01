// The Image Studio color picker (ADR-242, PP-C): Photoshop picker anatomy —
// saturation×value pad (layered CSS gradients, the miniPaint technique, so
// no canvas is needed), hue slider, hex and laser-centric K% ink fields,
// current-vs-new preview. Commits on OK; Esc/Cancel closes without change.

import { useEffect, useRef, useState } from 'react';
import type { PaintColor } from '../../core/image-edit';
import { useDialogA11y } from '../common/use-dialog-a11y';
import {
  hexToRgb,
  hsvToRgb,
  inkPercentToRgb,
  rgbToHex,
  rgbToHsv,
  rgbToInkPercent,
  type HsvColor,
} from './editor-color';
import { ColorPickerPad } from './ColorPickerPad';

export function ColorPickerDialog(props: {
  readonly title: string;
  readonly initial: PaintColor;
  readonly onCommit: (color: PaintColor) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const [hsv, setHsv] = useState<HsvColor>(() => rgbToHsv(props.initial));
  const [hexDraft, setHexDraft] = useState(() => rgbToHex(props.initial));
  const [inkDraft, setInkDraft] = useState(() => String(rgbToInkPercent(props.initial)));
  const rgb = hsvToRgb(hsv);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogA11y(dialogRef, props.onClose);

  // Keep the hex field following pad/slider moves (draft wins while typing).
  useEffect(() => {
    setHexDraft(rgbToHex(hsvToRgb(hsv)));
    setInkDraft(String(rgbToInkPercent(hsvToRgb(hsv))));
  }, [hsv]);

  const commit = (): void => {
    // Invalid transient text never mutates hsv/rgb, so OK uses the last valid
    // represented color instead of turning the action into a new refusal.
    props.onCommit(rgb);
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
      style={backdropStyle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) commit();
        e.stopPropagation();
      }}
    >
      <div style={cardStyle}>
        <strong style={{ fontSize: 13 }}>{props.title}</strong>
        <ColorPickerPad hsv={hsv} onChange={setHsv} />
        <input
          type="range"
          min={0}
          max={360}
          step={1}
          value={Math.round(hsv.h)}
          onChange={(e) => setHsv((c) => ({ ...c, h: Number(e.target.value) }))}
          style={hueSliderStyle}
          aria-label="Hue"
          title="Hue"
        />
        <PickerFields
          rgb={rgb}
          initial={props.initial}
          hexDraft={hexDraft}
          inkDraft={inkDraft}
          onHexChange={(value) => {
            setHexDraft(value);
            const parsed = hexToRgb(value);
            if (parsed !== null) setHsv(rgbToHsv(parsed));
          }}
          onInkChange={(draft) => {
            setInkDraft(draft);
            const percent = parseInkDraft(draft);
            if (percent !== null) setHsv(rgbToHsv(inkPercentToRgb(percent)));
          }}
          onInkBlur={() => setInkDraft(String(rgbToInkPercent(rgb)))}
        />
        <PickerActions onCommit={commit} onClose={props.onClose} />
      </div>
    </div>
  );
}

function PickerActions(props: {
  readonly onCommit: () => void;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <div style={actionsStyle}>
      <button
        type="button"
        className="lf-btn"
        onClick={props.onClose}
        title="Close without changing the color (Esc)"
      >
        Cancel
      </button>
      <button
        type="button"
        className="lf-btn lf-btn--primary"
        onClick={props.onCommit}
        title="Use this color (Enter)"
      >
        OK
      </button>
    </div>
  );
}

function PickerFields(props: {
  readonly rgb: PaintColor;
  readonly initial: PaintColor;
  readonly hexDraft: string;
  readonly inkDraft: string;
  readonly onHexChange: (value: string) => void;
  readonly onInkChange: (draft: string) => void;
  readonly onInkBlur: () => void;
}): JSX.Element {
  const css = (c: PaintColor): string => `rgb(${c.r}, ${c.g}, ${c.b})`;
  return (
    <div style={rowStyle}>
      <label style={fieldStyle}>
        Hex
        <input
          value={props.hexDraft}
          onChange={(e) => props.onHexChange(e.target.value)}
          style={inputStyle}
          title="Hex color (#rrggbb)"
          aria-label="Hex color"
        />
      </label>
      <label style={fieldStyle}>
        K %
        <input
          type="number"
          min={0}
          max={100}
          value={props.inkDraft}
          aria-invalid={parseInkDraft(props.inkDraft) === null}
          onChange={(e) => props.onInkChange(e.target.value)}
          onBlur={props.onInkBlur}
          style={inputStyle}
          title="Ink percentage: 0 = white (no burn), 100 = black"
          aria-label="Ink percent"
        />
      </label>
      <span style={previewStyle} title="New (top) vs current (bottom)">
        <span style={{ ...previewHalfStyle, background: css(props.rgb) }} />
        <span style={{ ...previewHalfStyle, background: css(props.initial) }} />
      </span>
    </div>
  );
}

function parseInkDraft(draft: string): number | null {
  if (draft.trim().length === 0) return null;
  const value = Number(draft);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
};

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1020,
  display: 'grid',
  placeItems: 'center',
};

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  width: 260,
  maxWidth: 'calc(100vw - 24px)',
  maxHeight: 'calc(100vh - 24px)',
  boxSizing: 'border-box',
  overflowY: 'auto',
  padding: 14,
  borderRadius: 8,
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
};

const hueSliderStyle: React.CSSProperties = { width: '100%' };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'center' };
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  flex: 1,
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '3px 6px',
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-input)',
  color: 'var(--lf-text)',
  borderRadius: 4,
  fontSize: 12,
};
const previewStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: 34,
  height: 34,
  borderRadius: 4,
  overflow: 'hidden',
  border: '1px solid var(--lf-border-strong)',
};
const previewHalfStyle: React.CSSProperties = { flex: 1 };
