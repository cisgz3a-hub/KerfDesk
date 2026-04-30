import React from 'react';
import { createBoxPreviewModel, type BoxPreviewModel } from '../../../core/box/boxPreviewModel';
import type { BoxLibraryPreset } from '../../../core/box/boxLibraryTypes';

type BoxPresetPreviewMode = 'card' | 'hero';

interface BoxPresetPreviewProps {
  preset: BoxLibraryPreset;
  mode: BoxPresetPreviewMode;
}

function shade(hex: string, alpha: string): string {
  return `${hex}${alpha}`;
}

function renderVentSlots(model: BoxPreviewModel): React.ReactNode[] {
  if (!model.showVentSlots) return [];
  return [0, 1, 2, 3].map(i => React.createElement('rect', {
    key: `vent-${i}`,
    x: 104 + i * 10,
    y: 78,
    width: 5,
    height: 24,
    rx: 2,
    fill: '#08080f',
    opacity: 0.65,
  }));
}

function renderHandle(model: BoxPreviewModel): React.ReactNode {
  if (!model.showHandleSlots) return null;
  return React.createElement('rect', {
    x: 62, y: 84, width: 32, height: 9, rx: 5,
    fill: '#08080f', opacity: 0.6,
  });
}

function renderFingerHints(accentColor: string): React.ReactNode[] {
  return [0, 1, 2, 3].map(i => React.createElement('rect', {
    key: `finger-${i}`,
    x: 44 + i * 18,
    y: 111,
    width: 10,
    height: 5,
    fill: accentColor,
    opacity: 0.55,
  }));
}

function renderCouponPreview(model: BoxPreviewModel, width: number, height: number): React.ReactNode {
  const y = height / 2 - 18;
  return React.createElement('g', null,
    React.createElement('rect', {
      x: 24, y, width: width - 48, height: 36, rx: 8,
      fill: shade(model.accentColor, '22'),
      stroke: model.accentColor,
      strokeWidth: 2,
    }),
    ...[0, 1, 2, 3, 4].map(i => React.createElement('path', {
      key: i,
      d: `M ${50 + i * 30} ${y} v 11 h 10 v -11`,
      fill: 'none',
      stroke: model.accentColor,
      strokeWidth: 2,
      opacity: 0.8,
    })),
    React.createElement('line', {
      x1: 36, y1: y + 24, x2: width - 36, y2: y + 24,
      stroke: '#e0e0ec', strokeDasharray: '4 5', opacity: 0.35,
    }),
  );
}

function renderBoxPreview(model: BoxPreviewModel): React.ReactNode {
  const tall = model.variant === 'pencil-cup';
  const frontTop = tall ? 44 : 65;
  const frontBottom = 130;
  const left = 42;
  const right = 130;
  const depthX = 38;
  const depthY = tall ? 22 : 30;
  const topOpacity = model.openTop ? 0.18 : 0.78;

  return React.createElement('g', null,
    React.createElement('polygon', {
      points: `${left},${frontTop} ${right},${frontTop} ${right + depthX},${frontTop - depthY} ${left + depthX},${frontTop - depthY}`,
      fill: shade(model.accentColor, model.openTop ? '16' : '40'),
      stroke: model.accentColor,
      strokeWidth: 2,
      opacity: topOpacity,
    }),
    React.createElement('polygon', {
      points: `${left},${frontTop} ${right},${frontTop} ${right},${frontBottom} ${left},${frontBottom}`,
      fill: '#151826',
      stroke: model.accentColor,
      strokeWidth: 2,
    }),
    React.createElement('polygon', {
      points: `${right},${frontTop} ${right + depthX},${frontTop - depthY} ${right + depthX},${frontBottom - depthY} ${right},${frontBottom}`,
      fill: '#10131c',
      stroke: model.accentColor,
      strokeWidth: 2,
    }),
    model.lidType !== 'none'
      ? React.createElement('path', {
          d: `M ${left + 8} ${frontTop + 12} H ${right - 8}`,
          stroke: model.accentColor,
          strokeWidth: 1.5,
          opacity: 0.65,
        })
      : null,
    ...renderVentSlots(model),
    renderHandle(model),
    ...renderFingerHints(model.accentColor),
  );
}

export function BoxPresetPreview({ preset, mode }: BoxPresetPreviewProps) {
  const model = createBoxPreviewModel(preset);
  const width = mode === 'hero' ? 300 : 240;
  const height = mode === 'hero' ? 190 : 150;
  const boxTransform = mode === 'hero' ? 'translate(45 22) scale(1)' : 'translate(36 14) scale(0.84)';
  const couponTransform = mode === 'hero' ? 'translate(35 24) scale(1)' : 'translate(15 6) scale(1)';

  return React.createElement('svg', {
    width: '100%',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': preset.name,
    style: { display: 'block' },
  },
    React.createElement('rect', { width, height, rx: 12, fill: '#0a0a14' }),
    React.createElement('g', {
      transform: model.showCouponMarks ? couponTransform : boxTransform,
    },
      model.showCouponMarks
        ? renderCouponPreview(model, 210, 140)
        : renderBoxPreview(model),
    ),
  );
}
