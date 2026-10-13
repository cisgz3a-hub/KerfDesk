// Image Studio tool rail (ADR-242, PP-C): lucide icons per tool (the main
// toolbar's icon set), M cycling the marquee shape, and the Photoshop
// foreground/background chips — click a chip to open the color picker, ⇄
// swaps (X), the mini reset restores black/white (D).

import { useState } from 'react';
import { IconFrame } from '../kit/icon-frame';
import type { PaintColor } from '../../core/image-edit';
import { ColorPickerDialog } from './ColorPickerDialog';
import { EditorToolIcon } from './editor-icons';
import type { EditorTool } from './editor-session';
import { useImageEditorStore } from './image-editor-store';

type ToolEntry = {
  readonly tool: EditorTool;
  readonly shortLabel: string;
  readonly label: string;
  readonly shortcut: string;
};

const TOOLS: readonly ToolEntry[] = [
  { tool: { kind: 'brush' }, shortLabel: 'Brush', label: 'Brush', shortcut: 'B' },
  { tool: { kind: 'pencil' }, shortLabel: 'Pencil', label: 'Pencil (hard edge)', shortcut: 'P' },
  {
    tool: { kind: 'eraser' },
    shortLabel: 'Eraser',
    label: 'Eraser (clears upper layers; paints the Background color)',
    shortcut: 'E',
  },
  { tool: { kind: 'line' }, shortLabel: 'Line', label: 'Line (Shift = 45°)', shortcut: 'L' },
  {
    tool: { kind: 'marquee', shape: 'rect' },
    shortLabel: 'Select area',
    label: 'Marquee — M cycles rect/ellipse; Shift adds, Alt subtracts',
    shortcut: 'M',
  },
  {
    tool: { kind: 'lasso' },
    shortLabel: 'Lasso',
    label: 'Lasso — Shift adds, Alt subtracts',
    shortcut: 'S',
  },
  {
    tool: { kind: 'wand' },
    shortLabel: 'Wand',
    label: 'Magic wand — Shift adds, Alt subtracts',
    shortcut: 'W',
  },
  {
    tool: { kind: 'bucket' },
    shortLabel: 'Fill',
    label: 'Paint bucket — fills the clicked region of what you see',
    shortcut: 'G',
  },
  {
    tool: { kind: 'gradient', shape: 'linear' },
    shortLabel: 'Gradient',
    label: 'Gradient — drag foreground→background; G cycles bucket/linear/radial',
    shortcut: 'G',
  },
  {
    tool: { kind: 'clone', source: null, offset: null },
    shortLabel: 'Clone',
    label: 'Clone stamp — Alt-click sets the source, then paint the copy',
    shortcut: 'K',
  },
  {
    tool: { kind: 'heal' },
    shortLabel: 'Heal',
    label: 'Spot heal — click a blemish; the surround patches it',
    shortcut: 'J',
  },
  {
    tool: { kind: 'crop' },
    shortLabel: 'Crop',
    label: 'Crop — drag a box, Enter commits, Esc cancels',
    shortcut: 'C',
  },
  { tool: { kind: 'move' }, shortLabel: 'Move', label: 'Move selected pixels', shortcut: 'V' },
];

export function EditorToolStrip(): JSX.Element {
  const activeTool = useImageEditorStore((s) => s.tool);
  const setTool = useImageEditorStore((s) => s.setTool);
  return (
    <aside style={railStyle} aria-label="Image Studio tools">
      {TOOLS.map((entry) => {
        const isActive = entry.tool.kind === activeTool.kind;
        const shapeSuffix =
          (entry.tool.kind === 'marquee' && activeTool.kind === 'marquee') ||
          (entry.tool.kind === 'gradient' && activeTool.kind === 'gradient')
            ? ` — ${activeTool.shape}`
            : '';
        return (
          <button
            key={entry.tool.kind}
            type="button"
            onClick={() => setTool(entry.tool)}
            aria-pressed={isActive}
            aria-label={entry.label}
            title={`${entry.label}${shapeSuffix} (${entry.shortcut})`}
            style={{ ...buttonStyle, ...(isActive ? activeStyle : null) }}
          >
            <EditorToolIcon kind={entry.tool.kind} />
            <span>{entry.shortLabel}</span>
          </button>
        );
      })}
      <ColorChips />
    </aside>
  );
}

function ColorChips(): JSX.Element {
  const foreground = useImageEditorStore((s) => s.foreground);
  const background = useImageEditorStore((s) => s.background);
  const setForeground = useImageEditorStore((s) => s.setForeground);
  const setBackground = useImageEditorStore((s) => s.setBackground);
  const swapColors = useImageEditorStore((s) => s.swapColors);
  const resetColors = useImageEditorStore((s) => s.resetColors);
  const [picking, setPicking] = useState<'foreground' | 'background' | null>(null);
  const css = (c: PaintColor): string => `rgb(${c.r}, ${c.g}, ${c.b})`;
  return (
    <div style={chipsHostStyle} aria-label="Foreground and background colors">
      <div style={chipsPairStyle}>
        <button
          type="button"
          onClick={() => setPicking('background')}
          aria-label="Choose background color"
          title="Background color — the eraser paints this on the Background layer. Click to choose."
          style={{ ...chipStyle, background: css(background), top: 10, left: 10 }}
        />
        <button
          type="button"
          onClick={() => setPicking('foreground')}
          aria-label="Choose foreground color"
          title="Foreground color — brush, pencil, line, and fill paint this. Click to choose."
          style={{ ...chipStyle, background: css(foreground), top: 2, left: 2, zIndex: 1 }}
        />
      </div>
      <span style={chipActionsStyle}>
        <button
          type="button"
          onClick={swapColors}
          title="Swap foreground and background colors (X)"
          aria-label="Swap foreground and background colors (X)"
          style={miniButtonStyle}
        >
          <IconFrame size={14}>
            <path d="M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4" />
          </IconFrame>
        </button>
        <button
          type="button"
          onClick={resetColors}
          title="Reset to black foreground / white background (D)"
          aria-label="Reset to black foreground / white background (D)"
          style={miniButtonStyle}
        >
          <IconFrame size={14}>
            <rect x="9" y="9" width="11" height="11" rx="1.5" />
            <rect x="4" y="4" width="11" height="11" rx="1.5" fill="currentColor" />
          </IconFrame>
        </button>
      </span>
      {picking !== null ? (
        <ColorPickerDialog
          title={picking === 'foreground' ? 'Foreground color' : 'Background color'}
          initial={picking === 'foreground' ? foreground : background}
          onCommit={(color) => {
            if (picking === 'foreground') setForeground(color);
            else setBackground(color);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </div>
  );
}

const railStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  overflowX: 'hidden',
  overflowY: 'auto',
  gap: 4,
  padding: 6,
  borderRight: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
  flexShrink: 0,
};

const buttonStyle: React.CSSProperties = {
  width: 108,
  minHeight: 38,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  textAlign: 'left',
  fontSize: 12,
  padding: '6px 8px',
  border: '1px solid transparent',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--lf-text)',
  cursor: 'pointer',
};

const activeStyle: React.CSSProperties = {
  border: '1px solid var(--lf-accent)',
  background: 'var(--lf-bg-input)',
};

const chipsHostStyle: React.CSSProperties = {
  marginTop: 'auto',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
  paddingTop: 8,
};

const chipsPairStyle: React.CSSProperties = { position: 'relative', width: 30, height: 30 };

const chipStyle: React.CSSProperties = {
  position: 'absolute',
  width: 16,
  height: 16,
  border: '1px solid var(--lf-border-strong)',
  borderRadius: 2,
  cursor: 'pointer',
  padding: 0,
};

const chipActionsStyle: React.CSSProperties = { display: 'inline-flex', gap: 2 };

const miniButtonStyle: React.CSSProperties = {
  width: 20,
  height: 18,
  display: 'grid',
  placeItems: 'center',
  fontSize: 11,
  border: '1px solid transparent',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--lf-text-muted)',
  cursor: 'pointer',
  padding: 0,
};
