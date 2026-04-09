import React, { useEffect, useRef } from 'react';
import { theme } from '../styles/theme';

export interface MenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const menuWidth = 240;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const naturalMenuHeight = items.length * 32 + 16;
  const menuHeight = Math.min(naturalMenuHeight, viewportH - 16);

  const clampedX = Math.min(x, viewportW - menuWidth - 8);
  const clampedY = Math.min(y, viewportH - menuHeight - 8);

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: Math.max(4, clampedX),
    top: Math.max(4, clampedY),
    background: theme.bg.elevated,
    border: `1px solid ${theme.border.default}`,
    borderRadius: theme.radius.lg,
    padding: '4px 0',
    minWidth: 200,
    maxHeight: viewportH - 16,
    overflowY: 'auto',
    zIndex: 1000,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    fontFamily: theme.font.ui,
    fontSize: theme.font.size.sm,
    backdropFilter: 'blur(12px)',
  };

  const itemStyle = (disabled?: boolean): React.CSSProperties => ({
    padding: '7px 14px',
    color: disabled ? theme.text.tertiary : theme.text.primary,
    cursor: disabled ? 'default' : 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    width: '100%',
    background: 'none',
    border: 'none',
    textAlign: 'left' as const,
    fontFamily: theme.font.ui,
    fontSize: theme.font.size.sm,
    transition: `background ${theme.transition.fast}`,
  });

  const separatorStyle: React.CSSProperties = {
    height: 1,
    background: theme.border.subtle,
    margin: '4px 8px',
  };

  return React.createElement('div', { ref, style: menuStyle },
    ...items.map((item, i) =>
      item.separator
        ? React.createElement('div', { key: i, style: separatorStyle })
        : React.createElement('button', {
            key: i,
            style: itemStyle(item.disabled),
            onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
              if (!item.disabled) (e.target as HTMLElement).style.background = theme.bg.hover;
            },
            onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
              (e.target as HTMLElement).style.background = 'none';
            },
            onClick: () => {
              if (!item.disabled) {
                item.action();
                onClose();
              }
            },
          }, item.label)
    )
  );
}
