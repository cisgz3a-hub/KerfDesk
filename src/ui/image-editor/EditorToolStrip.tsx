// Image Studio tool rail (ADR-242, PP-C): lucide icons per tool (the main
// toolbar's icon set), M cycling the marquee shape, and the Photoshop
// foreground/background chips — click a chip to open the color picker, ⇄
// swaps (X), the mini reset restores black/white (D).

import { useState } from 'react';
import type { PaintColor } from '../../core/image-edit';
import { ColorPickerDialog } from './ColorPickerDialog';
import { EditorToolIcon } from './editor-icons';
import type { EditorTool } from './editor-session';
import { useImageEditorStore } from './image-editor-store';

type ToolEntry = {
  readonly tool: EditorTool;
  readonly label: string;
  readonly shortcut: string;
};

const TOOLS: readonly ToolEntry[] = [
  { tool: { kind: 'brush' }, label: 'Brush', shortcut: 'B' },
  { tool: { kind: 'pencil' }, label: 'Pencil (hard edge)', shortcut: 'P' },
  { tool: { kind: 'eraser' }, label: 'Eraser (paints the background color)', shortcut: 'E' },
  { tool: { kind: 'line' }, label: 'Line (Shift = 45°)', shortcut: 'L' },
  {
    tool: { kind: 'marquee', shape: 'rect' },
    label: 'Marquee — M cycles rect/ellipse; Shift adds, Alt subtracts',
    shortcut: 'M',
  },
  { tool: { kind: 'lasso' }, label: 'Lasso — Shift adds, Alt subtracts', shortcut: 'S' },
  { tool: { kind: 'wand' }, label: 'Magic wand — Shift adds, Alt subtracts', shortcut: 'W' },
  { tool: { kind: 'move' }, label: 'Move selected pixels', shortcut: 'V' },
];

export function EditorToolStrip(): JSX.Element {
  const activeTool = useImageEditorStore((s) => s.tool);
  const setTool = useImageEditorStore((s) => s.setTool);
  return (
    <aside style={railStyle} aria-label="Image Studio tools">
      {TOOLS.map((entry) => {
        const isActive = entry.tool.kind === activeTool.kind;
        const shapeSuffix =
          entry.tool.kind === 'marquee' && activeTool.kind === 'marquee'
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
          title="Background color — the eraser paints this. Click to choose."
          style={{ ...chipStyle, background: css(background), top: 10, left: 10 }}
        />
        <button
          type="button"
          onClick={() => setPicking('foreground')}
          title="Foreground color — brush, pencil, line, and fill paint this. Click to choose."
          style={{ ...chipStyle, background: css(foreground), top: 2, left: 2, zIndex: 1 }}
        />
      </div>
      <span style={chipActionsStyle}>
        <button
          type="button"
          onClick={swapColors}
          title="Swap foreground and background colors (X)"
          style={miniButtonStyle}
        >
          ⇄
        </button>
        <button
          type="button"
          onClick={resetColors}
          title="Reset to black foreground / white background (D)"
          style={miniButtonStyle}
        >
          ▨
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
  gap: 4,
  padding: 6,
  borderRight: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
};

const buttonStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  display: 'grid',
  placeItems: 'center',
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
