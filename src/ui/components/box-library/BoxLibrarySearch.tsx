import React from 'react';

interface BoxLibrarySearchProps {
  value: string;
  onChange: (value: string) => void;
}

export function BoxLibrarySearch({ value, onChange }: BoxLibrarySearchProps) {
  return React.createElement('div', { style: { position: 'relative', marginBottom: 10 } },
    React.createElement('span', {
      style: {
        position: 'absolute', left: 10, top: 8,
        color: '#6f6f89', fontSize: 12, pointerEvents: 'none',
      },
    }, '⌕'),
    React.createElement('input', {
      value,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
      placeholder: 'Search presets, e.g. tray, enclosure, gift box...',
      style: {
        width: '100%',
        boxSizing: 'border-box' as const,
        padding: '8px 9px 8px 28px',
        background: '#0a0a14',
        border: '1px solid #252540',
        borderRadius: 8,
        color: '#e0e0ec',
        fontSize: 11,
        outline: 'none',
      },
    }),
  );
}
