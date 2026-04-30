import React from 'react';
import { BOX_PRESET_CATEGORIES } from '../../../core/box/boxLibrary';
import type { BoxPresetCategory } from '../../../core/box/boxLibraryTypes';

interface BoxCategoryTabsProps {
  value: BoxPresetCategory | 'all';
  onChange: (value: BoxPresetCategory | 'all') => void;
}

export function BoxCategoryTabs({ value, onChange }: BoxCategoryTabsProps) {
  return React.createElement('div', {
    style: { display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginBottom: 12 },
  },
    ...BOX_PRESET_CATEGORIES.map(category => {
      const active = value === category.id;
      return React.createElement('button', {
        key: category.id,
        type: 'button',
        onClick: () => onChange(category.id),
        style: {
          padding: '6px 8px',
          borderRadius: 999,
          border: active ? '1px solid #00d4ff' : '1px solid #252540',
          background: active ? 'rgba(0,212,255,0.10)' : '#0a0a14',
          color: active ? '#d0e8ff' : '#9a9ab5',
          fontSize: 9,
          cursor: 'pointer',
        },
      }, category.label);
    }),
  );
}
