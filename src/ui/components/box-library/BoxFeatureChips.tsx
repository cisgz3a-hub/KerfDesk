import React from 'react';

export interface BoxFeatureChipsProps {
  items: string[];
  accentColor?: string;
}

export function BoxFeatureChips({ items, accentColor = '#00d4ff' }: BoxFeatureChipsProps) {
  return React.createElement('div', {
    style: { display: 'flex', flexWrap: 'wrap' as const, gap: 6 },
  },
    ...items.map(item => React.createElement('span', {
      key: item,
      style: {
        fontSize: 9,
        lineHeight: 1,
        padding: '5px 7px',
        borderRadius: 999,
        color: accentColor,
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${accentColor}55`,
      },
    }, item)),
  );
}
