// Image Studio tool rail (ADR-242): one button per EditorTool, mirroring the
// workspace ToolStrip's rail styling. Icons are text glyphs for now — the
// kit icon set gains proper glyphs in a follow-up.

import { useImageEditorStore } from './image-editor-store';
import type { EditorTool } from './editor-session';

type ToolEntry = {
  readonly tool: EditorTool;
  readonly glyph: string;
  readonly label: string;
  readonly shortcut: string;
};

const TOOLS: readonly ToolEntry[] = [
  { tool: { kind: 'brush' }, glyph: '🖌', label: 'Brush', shortcut: 'B' },
  { tool: { kind: 'pencil' }, glyph: '✏', label: 'Pencil', shortcut: 'P' },
  { tool: { kind: 'eraser' }, glyph: '⌫', label: 'Eraser', shortcut: 'E' },
  { tool: { kind: 'line' }, glyph: '╱', label: 'Line (Shift = 45°)', shortcut: 'L' },
  {
    tool: { kind: 'marquee', shape: 'rect' },
    glyph: '▭',
    label: 'Marquee — M cycles rect/ellipse; Shift adds, Alt subtracts',
    shortcut: 'M',
  },
  { tool: { kind: 'lasso' }, glyph: '◌', label: 'Lasso', shortcut: 'S' },
  { tool: { kind: 'wand' }, glyph: '✦', label: 'Magic wand', shortcut: 'W' },
  { tool: { kind: 'move' }, glyph: '✥', label: 'Move selection', shortcut: 'V' },
];

export function EditorToolStrip(): JSX.Element {
  const activeTool = useImageEditorStore((s) => s.tool);
  const setTool = useImageEditorStore((s) => s.setTool);
  return (
    <aside style={railStyle} aria-label="Image Studio tools">
      {TOOLS.map((entry) => {
        const isActive = entry.tool.kind === activeTool.kind;
        return (
          <button
            key={entry.tool.kind}
            type="button"
            onClick={() => setTool(entry.tool)}
            aria-pressed={isActive}
            title={`${entry.label} (${entry.shortcut})`}
            style={{ ...buttonStyle, ...(isActive ? activeStyle : null) }}
          >
            <span aria-hidden="true">{entry.glyph}</span>
          </button>
        );
      })}
      <ColorChips />
    </aside>
  );
}

// Photoshop foreground/background chips: X swaps, D resets to black/white.
function ColorChips(): JSX.Element {
  const foreground = useImageEditorStore((s) => s.foreground);
  const background = useImageEditorStore((s) => s.background);
  const swapColors = useImageEditorStore((s) => s.swapColors);
  const resetColors = useImageEditorStore((s) => s.resetColors);
  const css = (c: { r: number; g: number; b: number }): string => `rgb(${c.r}, ${c.g}, ${c.b})`;
  return (
    <div style={chipsHostStyle} aria-label="Foreground and background colors">
      <button
        type="button"
        onClick={swapColors}
        title="Swap foreground and background colors (X)"
        style={chipsButtonStyle}
      >
        <span style={{ ...chipStyle, background: css(background), top: 10, left: 10 }} />
        <span style={{ ...chipStyle, background: css(foreground), top: 2, left: 2, zIndex: 1 }} />
      </button>
      <button
        type="button"
        onClick={resetColors}
        title="Reset to black foreground / white background (D)"
        style={resetStyle}
      >
        <span aria-hidden="true">▨</span>
      </button>
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
  fontSize: 16,
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

const chipsButtonStyle: React.CSSProperties = {
  position: 'relative',
  width: 30,
  height: 30,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: 0,
};

const chipStyle: React.CSSProperties = {
  position: 'absolute',
  width: 16,
  height: 16,
  border: '1px solid var(--lf-border-strong)',
  borderRadius: 2,
};

const resetStyle: React.CSSProperties = {
  width: 22,
  height: 18,
  display: 'grid',
  placeItems: 'center',
  fontSize: 11,
  border: '1px solid transparent',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--lf-text-muted)',
  cursor: 'pointer',
};
