import React from 'react';
import { theme } from '../styles/theme';

export type ToolType = 'select' | 'node' | 'rect' | 'ellipse' | 'line' | 'text';

interface ToolBarProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
}

const TOOLS: { id: ToolType; label: string; title?: string }[] = [
  { id: 'select', label: '⊹' },
  { id: 'node', label: '◇', title: 'Node Edit (N)' },
  { id: 'rect', label: '▭' },
  { id: 'ellipse', label: '◯' },
  { id: 'line', label: '╲' },
  { id: 'text', label: 'T' },
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
      }, tool.label)
    ),
    React.createElement('div', { style: { width: 20, height: 1, background: theme.border.default, margin: '4px 0' } }),
    ...drawTools.map(tool =>
      React.createElement('button', {
        key: tool.id,
        title: tool.title,
        onClick: () => onToolChange(tool.id),
        style: toolBtnStyle(tool.id),
      }, tool.label)
    ),
  );
}
