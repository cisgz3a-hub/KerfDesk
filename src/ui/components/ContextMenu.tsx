import React, { useEffect, useRef } from 'react';

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

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    background: '#1a1a2e',
    border: '1px solid #2a2a44',
    borderRadius: 6,
    padding: '4px 0',
    minWidth: 160,
    zIndex: 1000,
    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
    fontFamily: 'monospace',
    fontSize: 11,
  };

  const itemStyle = (disabled?: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    color: disabled ? '#444466' : '#ccc',
    cursor: disabled ? 'default' : 'pointer',
    display: 'block',
    width: '100%',
    background: 'none',
    border: 'none',
    textAlign: 'left' as const,
    fontFamily: 'monospace',
    fontSize: 11,
  });

  const separatorStyle: React.CSSProperties = {
    height: 1,
    background: '#2a2a44',
    margin: '4px 0',
  };

  return React.createElement('div', { ref, style: menuStyle },
    ...items.map((item, i) =>
      item.separator
        ? React.createElement('div', { key: i, style: separatorStyle })
        : React.createElement('button', {
            key: i,
            style: itemStyle(item.disabled),
            onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
              if (!item.disabled) (e.target as HTMLElement).style.background = '#2a2a4e';
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
