import React from 'react';
import { theme } from '../styles/theme';

export type ToolType = 'select' | 'node' | 'rect' | 'ellipse' | 'line' | 'text';

interface ToolBarProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
}

const icons: Record<ToolType, React.ReactNode> = {
  select: React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 },
    React.createElement('path', { d: 'M3 2l5 12 2-5 5-2L3 2z' }),
  ),
  node: React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 },
    React.createElement('path', { d: 'M2 8h4M10 8h4M8 2v4M8 10v4' }),
    React.createElement('rect', { x: 5.5, y: 5.5, width: 5, height: 5, rx: 1, fill: 'currentColor' }),
  ),
  rect: React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 },
    React.createElement('rect', { x: 2.5, y: 3.5, width: 11, height: 9, rx: 1 }),
  ),
  ellipse: React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 },
    React.createElement('ellipse', { cx: 8, cy: 8, rx: 6, ry: 5 }),
  ),
  line: React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 },
    React.createElement('line', { x1: 3, y1: 13, x2: 13, y2: 3 }),
  ),
  text: React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'currentColor' },
    React.createElement('text', { x: 3, y: 13, fontSize: 13, fontWeight: 700, fontFamily: 'serif' }, 'T'),
  ),
};

const TOOLS: { id: ToolType; title?: string }[] = [
  { id: 'select' },
  { id: 'node', title: 'Node Edit (N)' },
  { id: 'rect' },
  { id: 'ellipse' },
  { id: 'line' },
  { id: 'text' },
];

export function ToolBar({ activeTool, onToolChange }: ToolBarProps) {
  const toolBtnStyle = (toolId: string): React.CSSProperties => ({
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: activeTool === toolId ? 'rgba(0, 212, 255, 0.12)' : 'transparent',
    border: activeTool === toolId ? `1px solid ${theme.accent.cyan}` : '1px solid transparent',
    borderRadius: theme.radius.sm,
    color: activeTool === toolId ? theme.accent.cyan : theme.text.secondary,
    fontSize: '14px',
    cursor: 'pointer',
    transition: `all ${theme.transition.fast}`,
    fontFamily: theme.font.ui,
  });

  const selectNodeTools = TOOLS.slice(0, 2);
  const drawTools = TOOLS.slice(2);

  return React.createElement('div', {
    style: {
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      gap: 2,
      padding: '8px 4px',
      background: theme.bg.panel,
      borderRight: `1px solid ${theme.border.subtle}`,
      width: 40,
    },
  },
    ...selectNodeTools.map(tool =>
      React.createElement('button', {
        key: tool.id,
        title: tool.title,
        onClick: () => onToolChange(tool.id),
        style: toolBtnStyle(tool.id),
      }, icons[tool.id])
    ),
    React.createElement('div', { style: { width: 20, height: 1, background: theme.border.default, margin: '4px 0' } }),
    ...drawTools.map(tool =>
      React.createElement('button', {
        key: tool.id,
        title: tool.title,
        onClick: () => onToolChange(tool.id),
        style: toolBtnStyle(tool.id),
      }, icons[tool.id])
    ),
  );
}
