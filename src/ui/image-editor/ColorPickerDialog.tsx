// The Image Studio color picker (ADR-242, PP-C): Photoshop picker anatomy —
// saturation×value pad (layered CSS gradients, the miniPaint technique, so
// no canvas is needed), hue slider, hex and laser-centric K% ink fields,
// current-vs-new preview. Commits on OK; Esc/Cancel closes without change.

import { useEffect, useRef, useState } from 'react';
import type { PaintColor } from '../../core/image-edit';
import {
  hexToRgb,
  hsvToRgb,
  inkPercentToRgb,
  rgbToHex,
  rgbToHsv,
  rgbToInkPercent,
  type HsvColor,
} from './editor-color';

export function ColorPickerDialog(props: {
  readonly title: string;
  readonly initial: PaintColor;
  readonly onCommit: (color: PaintColor) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const [hsv, setHsv] = useState<HsvColor>(() => rgbToHsv(props.initial));
  const [hexDraft, setHexDraft] = useState(() => rgbToHex(props.initial));
  const rgb = hsvToRgb(hsv);

  // Keep the hex field following pad/slider moves (draft wins while typing).
  useEffect(() => {
    setHexDraft(rgbToHex(hsvToRgb(hsv)));
  }, [hsv]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
      style={backdropStyle}
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onClose();
        if (e.key === 'Enter') props.onCommit(rgb);
        e.stopPropagation();
      }}
    >
      <div style={cardStyle}>
        <strong style={{ fontSize: 13 }}>{props.title}</strong>
        <PickerPad hsv={hsv} onChange={setHsv} />
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
          onHexChange={(value) => {
            setHexDraft(value);
            const parsed = hexToRgb(value);
            if (parsed !== null) setHsv(rgbToHsv(parsed));
          }}
          onInkChange={(percent) => setHsv(rgbToHsv(inkPercentToRgb(percent)))}
        />
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
            onClick={() => props.onCommit(rgb)}
            title="Use this color (Enter)"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function PickerPad(props: {
  readonly hsv: HsvColor;
  readonly onChange: (update: (current: HsvColor) => HsvColor) => void;
}): JSX.Element {
  const padRef = useRef<HTMLDivElement | null>(null);
  const setFromPad = (e: React.PointerEvent<HTMLDivElement>): void => {
    const pad = padRef.current;
    if (pad === null) return;
    const rect = pad.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const v = 1 - Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    props.onChange((current) => ({ ...current, s, v }));
  };
  return (
    <div
      ref={padRef}
      style={{ ...padStyle, backgroundColor: `hsl(${Math.round(props.hsv.h)}, 100%, 50%)` }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setFromPad(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) setFromPad(e);
      }}
      role="slider"
      aria-label="Saturation and brightness"
      aria-valuetext={`saturation ${Math.round(props.hsv.s * 100)}%, brightness ${Math.round(props.hsv.v * 100)}%`}
      tabIndex={0}
      title="Drag to pick saturation (→) and brightness (↑)"
    >
      <span
        style={{
          ...padCursorStyle,
          left: `${props.hsv.s * 100}%`,
          top: `${(1 - props.hsv.v) * 100}%`,
        }}
      />
    </div>
  );
}

function PickerFields(props: {
  readonly rgb: PaintColor;
  readonly initial: PaintColor;
  readonly hexDraft: string;
  readonly onHexChange: (value: string) => void;
  readonly onInkChange: (percent: number) => void;
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
          value={rgbToInkPercent(props.rgb)}
          onChange={(e) => props.onInkChange(Number(e.target.value))}
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
  padding: 14,
  borderRadius: 8,
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
};

// White→hue horizontally, transparent→black vertically: the classic S×V pad.
// Picker chrome is inherently literal color math (white/black ramps over the
// hue), not themable UI — hence the raw values.
/* eslint-disable no-restricted-syntax */
const padStyle: React.CSSProperties = {
  position: 'relative',
  height: 140,
  borderRadius: 6,
  cursor: 'crosshair',
  backgroundImage:
    'linear-gradient(to top, #000, rgba(0, 0, 0, 0)), linear-gradient(to right, #fff, rgba(255, 255, 255, 0))',
  touchAction: 'none',
};

const padCursorStyle: React.CSSProperties = {
  position: 'absolute',
  width: 10,
  height: 10,
  marginLeft: -5,
  marginTop: -5,
  borderRadius: '50%',
  border: '2px solid #fff',
  boxShadow: '0 0 0 1px #000',
  pointerEvents: 'none',
};

/* eslint-enable no-restricted-syntax */

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
