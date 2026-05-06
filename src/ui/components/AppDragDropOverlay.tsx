import React from 'react';

export function AppDragDropOverlay(): React.ReactElement {
  return React.createElement('div', {
    style: {
      position: 'absolute',
      inset: 0,
      background: 'rgba(59, 139, 235, 0.15)',
      border: '3px dashed #3b8beb',
      borderRadius: 8,
      zIndex: 999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
    },
  },
    React.createElement('div', {
      style: { color: '#3b8beb', fontSize: 20, fontFamily: 'monospace' },
    }, 'Drop file to import (SVG, DXF, PNG, JPG, JSON)'),
  );
}
