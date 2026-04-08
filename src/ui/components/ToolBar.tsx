import React from 'react';

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
  return React.createElement('div', {
    style: {
      display: 'flex',
      flexDirection: 'column' as const,
      width: 36,
      background: '#0c0c18',
      borderRight: '1px solid #1a1a30',
      paddingTop: 4,
      gap: 2,
      alignItems: 'center',
    },
  },
    ...TOOLS.map(tool =>
      React.createElement('button', {
        key: tool.id,
        title: tool.title,
        onClick: () => onToolChange(tool.id),
        style: {
          width: 28,
          height: 28,
          background: activeTool === tool.id ? '#2a2a4e' : 'transparent',
          border: activeTool === tool.id ? '1px solid #3b8beb' : '1px solid transparent',
          borderRadius: 4,
          color: activeTool === tool.id ? '#3b8beb' : '#666688',
          cursor: 'pointer',
          fontSize: 14,
          fontFamily: 'monospace',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
      }, tool.label)
    )
  );
}
