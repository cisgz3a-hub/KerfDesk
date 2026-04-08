import React from 'react';

interface QuickActionsProps {
  x: number;
  y: number;
  onDuplicate: () => void;
  onDelete: () => void;
  onCenter: () => void;
  onGridArray: () => void;
  selectedCount: number;
}

export function QuickActions({ x, y, onDuplicate, onDelete, onCenter, onGridArray, selectedCount }: QuickActionsProps) {
  const font = "'DM Sans', system-ui, sans-serif";

  const btnStyle: React.CSSProperties = {
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: 4,
    color: '#aaaacc',
    fontSize: 13,
    cursor: 'pointer',
    transition: 'all 0.1s ease',
    padding: 0,
  };

  const btn = (icon: string, title: string, onClick: () => void) =>
    React.createElement('button', {
      onClick,
      title,
      style: btnStyle,
      onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.style.background = '#2a2a44';
        e.currentTarget.style.color = '#e0e0ec';
      },
      onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = '#aaaacc';
      },
    }, icon);

  // Clamp position to stay on screen
  const barWidth = 160;
  const clampedX = Math.min(x, window.innerWidth - barWidth - 20);
  const clampedY = Math.max(y, 60);

  return React.createElement('div', {
    style: {
      position: 'fixed',
      left: clampedX,
      top: clampedY - 40,
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      padding: '3px 4px',
      background: '#1a1a2e',
      border: '1px solid #333355',
      borderRadius: 8,
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      fontFamily: font,
      zIndex: 900,
      pointerEvents: 'auto' as const,
    },
  },
    btn('⊕', 'Duplicate (Ctrl+D)', onDuplicate),
    btn('⌧', 'Delete (Del)', onDelete),
    btn('◎', 'Center on material', onCenter),
    btn('⊞', 'Grid array', onGridArray),
    // Count badge
    React.createElement('span', {
      style: {
        fontSize: 9,
        color: '#555570',
        padding: '0 4px',
        borderLeft: '1px solid #252540',
        marginLeft: 2,
      },
    }, `${selectedCount}`),
  );
}
