import React from 'react';

interface ShortcutsPanelProps {
  onClose: () => void;
}

const SECTIONS = [
  {
    title: 'Tools',
    shortcuts: [
      { key: 'V', desc: 'Select tool' },
      { key: 'N', desc: 'Node edit tool' },
      { key: 'R', desc: 'Rectangle tool' },
      { key: 'E', desc: 'Ellipse tool' },
      { key: 'L', desc: 'Line tool' },
      { key: 'T', desc: 'Text tool' },
    ],
  },
  {
    title: 'Edit',
    shortcuts: [
      { key: 'Ctrl+Z', desc: 'Undo' },
      { key: 'Ctrl+Y', desc: 'Redo' },
      { key: 'Ctrl+C', desc: 'Copy' },
      { key: 'Ctrl+V', desc: 'Paste' },
      { key: 'Ctrl+D', desc: 'Duplicate' },
      { key: 'Ctrl+A', desc: 'Select all' },
      { key: 'Delete', desc: 'Delete selected' },
      { key: 'Escape', desc: 'Deselect' },
    ],
  },
  {
    title: 'Transform',
    shortcuts: [
      { key: '↑ ↓ ← →', desc: 'Nudge 1mm' },
      { key: 'Shift + ↑↓←→', desc: 'Nudge 0.1mm' },
      { key: 'Ctrl+Shift+C', desc: 'Center on material' },
      { key: 'Ctrl+G', desc: 'Group' },
      { key: 'Ctrl+Shift+G', desc: 'Ungroup' },
      { key: 'Ctrl+Shift+A', desc: 'Grid array' },
    ],
  },
  {
    title: 'View',
    shortcuts: [
      { key: 'Scroll', desc: 'Zoom in/out' },
      { key: 'Space + drag', desc: 'Pan canvas' },
      { key: 'Middle mouse', desc: 'Pan canvas' },
      { key: 'Double-click', desc: 'Select inside group' },
    ],
  },
  {
    title: 'Output',
    shortcuts: [
      { key: 'Ctrl+P', desc: 'Preview G-code' },
      { key: 'Ctrl+S', desc: 'Save project' },
    ],
  },
];

export function ShortcutsPanel({ onClose }: ShortcutsPanelProps) {
  const font = "'DM Sans', 'Segoe UI', system-ui, sans-serif";
  const mono = "'JetBrains Mono', 'Consolas', monospace";

  return React.createElement('div', {
    style: {
      position: 'fixed', inset: 0,
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2500, fontFamily: font,
    },
    onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); },
  },
    React.createElement('div', {
      style: {
        background: '#12121e', border: '1px solid #252540', borderRadius: 14,
        width: 560, maxHeight: '80vh', overflow: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
      },
    },
      // Header
      React.createElement('div', {
        style: {
          padding: '16px 24px', borderBottom: '1px solid #1a1a2e',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          position: 'sticky' as const, top: 0, background: '#12121e', zIndex: 1,
        },
      },
        React.createElement('div', null,
          React.createElement('span', { style: { color: '#e0e0ec', fontSize: 16, fontWeight: 600 } }, 'Keyboard Shortcuts'),
          React.createElement('span', { style: { color: '#555570', fontSize: 11, marginLeft: 8 } }, 'Press ? to toggle'),
        ),
        React.createElement('button', {
          onClick: onClose,
          style: { background: 'none', border: 'none', color: '#555570', fontSize: 20, cursor: 'pointer', lineHeight: 1 },
        }, '×'),
      ),

      // Sections in 2-column layout
      React.createElement('div', {
        style: {
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: 0, padding: '8px 0',
        },
      },
        ...SECTIONS.map((section, si) =>
          React.createElement('div', {
            key: section.title,
            style: {
              padding: '12px 24px',
              borderBottom: si < SECTIONS.length - 1 ? '1px solid #0f0f1a' : 'none',
            },
          },
            React.createElement('div', {
              style: {
                fontSize: 10, fontWeight: 600, color: '#00d4ff',
                textTransform: 'uppercase' as const, letterSpacing: '0.08em',
                marginBottom: 8,
              },
            }, section.title),
            ...section.shortcuts.map((s, i) =>
              React.createElement('div', {
                key: i,
                style: {
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '4px 0',
                },
              },
                React.createElement('span', { style: { color: '#8888aa', fontSize: 11 } }, s.desc),
                React.createElement('span', {
                  style: {
                    fontSize: 10, fontFamily: mono,
                    background: '#0a0a14', border: '1px solid #252540',
                    borderRadius: 4, padding: '2px 6px', color: '#e0e0ec',
                    whiteSpace: 'nowrap' as const,
                  },
                }, s.key),
              ),
            ),
          ),
        ),
      ),

      // Footer tip
      React.createElement('div', {
        style: {
          padding: '12px 24px', borderTop: '1px solid #1a1a2e',
          textAlign: 'center' as const,
        },
      },
        React.createElement('span', { style: { color: '#444460', fontSize: 10 } },
          'Right-click the canvas for more options like align, array, and layer management'
        ),
      ),
    ),
  );
}
