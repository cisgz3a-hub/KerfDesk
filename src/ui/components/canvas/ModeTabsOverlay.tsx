import React from 'react';

export interface ModeTabsOverlayProps {
  /** Bed origin (0,0) in canvas pixel space — same coordinates as the `<canvas>`. */
  viewportX: number;
  viewportY: number;
  viewportZoom: number;
  /** Current active layer's `settings.mode` (which tab is highlighted). */
  activeMode: string;
  onSelectMode: (mode: string) => void;
  bedWidth: number;
  bedHeight: number;
}

const MODES = [
  { key: 'cut', label: 'Cut', color: '#e63e6d' },
  { key: 'engrave', label: 'Engrave', color: '#3b8beb' },
  { key: 'score', label: 'Score', color: '#f5a623' },
  { key: 'image', label: 'Image', color: '#2dd4a0' },
] as const;

const TAB_W = 52;
const TAB_H = 28;
const TAB_GAP = 3;

export function ModeTabsOverlay({
  viewportX,
  viewportY,
  viewportZoom: _viewportZoom,
  activeMode,
  onSelectMode,
  bedWidth: _bedWidth,
  bedHeight: _bedHeight,
}: ModeTabsOverlayProps) {
  const tabsLeft = viewportX - TAB_W - 2;
  const tabsTop = viewportY + 8;

  return React.createElement('div', {
    style: {
      position: 'absolute' as const,
      left: 0,
      top: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      overflow: 'hidden',
      zIndex: 6,
    },
  },
  ...MODES.map((mode, i) => {
    const isActive = activeMode === mode.key;
    const top = tabsTop + i * (TAB_H + TAB_GAP);

    return React.createElement('button', {
      key: mode.key,
      type: 'button',
      onClick: () => onSelectMode(mode.key),
      style: {
        position: 'absolute' as const,
        left: tabsLeft,
        top,
        width: TAB_W,
        height: TAB_H,
        pointerEvents: 'auto' as const,
        border: 'none',
        borderRadius: '4px 0 0 4px',
        background: isActive ? '#0e0e1a' : '#08080f',
        borderLeft: isActive ? `3px solid ${mode.color}` : '3px solid transparent',
        borderTop: `1px solid ${isActive ? '#222240' : 'transparent'}`,
        borderBottom: `1px solid ${isActive ? '#222240' : 'transparent'}`,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: '0 6px',
        transition: 'all 0.15s ease',
        fontFamily: "'DM Sans', system-ui, sans-serif",
        fontSize: 10,
        fontWeight: isActive ? 600 : 400,
        color: isActive ? mode.color : '#333355',
        zIndex: 10,
      },
    },
      React.createElement('span', {
        style: {
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: mode.color,
          opacity: isActive ? 1 : 0.3,
          flexShrink: 0,
        },
      }),
      mode.label,
    );
  }),
  );
}
