import React from 'react';
import { type MachineOriginCorner } from '../../../core/devices/DeviceProfile';
import { type GcodeStartMode } from '../../../core/output/GcodeOrigin';

export interface MiniMapPoint {
  readonly x: number;
  readonly y: number;
}

export interface MiniMapBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface JobLayoutMiniMapData {
  readonly bedWidth: number;
  readonly bedHeight: number;
  readonly startMode: GcodeStartMode;
  readonly originCorner: MachineOriginCorner;
  readonly materialBounds?: MiniMapBounds | null;
  readonly jobBounds?: MiniMapBounds | null;
  readonly frameBounds?: MiniMapBounds | null;
  readonly savedOrigin?: MiniMapPoint | null;
  readonly headPosition?: MiniMapPoint | null;
}

export interface JobLayoutMiniMapProps {
  data: JobLayoutMiniMapData;
}

function validBounds(bounds?: MiniMapBounds | null): bounds is MiniMapBounds {
  return !!bounds &&
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY) &&
    bounds.maxX > bounds.minX &&
    bounds.maxY > bounds.minY;
}

function validPoint(point?: MiniMapPoint | null): point is MiniMapPoint {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function originForCorner(width: number, height: number, corner: MachineOriginCorner): MiniMapPoint {
  switch (corner) {
    case 'front-right': return { x: width, y: height };
    case 'rear-left': return { x: 0, y: 0 };
    case 'rear-right': return { x: width, y: 0 };
    case 'front-left':
    default:
      return { x: 0, y: height };
  }
}

function rectFromBounds(bounds: MiniMapBounds, attrs: Record<string, unknown>): React.ReactElement {
  return React.createElement('rect', {
    ...attrs,
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  });
}

function marker(point: MiniMapPoint, attrs: Record<string, unknown>, label?: string): React.ReactElement {
  return React.createElement('g', attrs,
    React.createElement('circle', { cx: point.x, cy: point.y, r: 4 }),
    React.createElement('line', { x1: point.x - 7, y1: point.y, x2: point.x + 7, y2: point.y }),
    React.createElement('line', { x1: point.x, y1: point.y - 7, x2: point.x, y2: point.y + 7 }),
    label && React.createElement('text', { x: point.x + 8, y: point.y - 8 }, label),
  );
}

function startModeLabel(mode: GcodeStartMode): string {
  switch (mode) {
    case 'absolute': return 'Canvas position';
    case 'current': return 'Laser head';
    case 'savedOrigin': return 'Saved zero';
  }
}

export function JobLayoutMiniMap({ data }: JobLayoutMiniMapProps): React.ReactElement {
  const bedWidth = Math.max(1, data.bedWidth);
  const bedHeight = Math.max(1, data.bedHeight);
  const origin = originForCorner(bedWidth, bedHeight, data.originCorner);
  const viewPad = 18;
  const viewBox = `${-viewPad} ${-viewPad} ${bedWidth + viewPad * 2} ${bedHeight + viewPad * 2}`;

  return React.createElement('div', {
    'data-testid': 'job-layout-mini-map',
    style: { marginTop: 10 },
  },
    React.createElement('svg', {
      role: 'img',
      'aria-label': `Job layout mini map, ${startModeLabel(data.startMode)}`,
      viewBox,
      preserveAspectRatio: 'xMidYMid meet',
      style: {
        display: 'block',
        width: '100%',
        aspectRatio: '1.45 / 1',
        borderRadius: 6,
        background: '#060913',
        border: '1px solid #20203a',
      },
    },
      React.createElement('rect', {
        'data-testid': 'mini-map-bed',
        x: 0,
        y: 0,
        width: bedWidth,
        height: bedHeight,
        fill: '#081a2d',
        stroke: '#2f4768',
        strokeWidth: 2,
      }),
      validBounds(data.materialBounds) && rectFromBounds(data.materialBounds, {
        'data-testid': 'mini-map-material',
        fill: 'rgba(240, 180, 41, 0.16)',
        stroke: '#b8953d',
        strokeWidth: 1.5,
      }),
      validBounds(data.frameBounds) && rectFromBounds(data.frameBounds, {
        'data-testid': 'mini-map-frame-bounds',
        fill: 'none',
        stroke: '#2dd4a0',
        strokeWidth: 2,
        strokeDasharray: '8 5',
      }),
      validBounds(data.jobBounds) && rectFromBounds(data.jobBounds, {
        'data-testid': 'mini-map-job-bounds',
        fill: 'rgba(0, 212, 255, 0.16)',
        stroke: '#00d4ff',
        strokeWidth: 1.5,
      }),
      React.createElement('g', {
        'data-testid': 'mini-map-origin-corner',
        'data-origin-corner': data.originCorner,
        fill: '#ff77a8',
        stroke: '#ff77a8',
        strokeWidth: 1.5,
        fontSize: 12,
        fontFamily: "'JetBrains Mono', monospace",
      }, marker(origin, {}, '0,0')),
      data.startMode === 'current' && validPoint(data.headPosition) && React.createElement('g', {
        fill: '#ffd444',
        stroke: '#ffd444',
        strokeWidth: 1.5,
        fontSize: 12,
        fontFamily: "'JetBrains Mono', monospace",
      }, marker(data.headPosition, { 'data-testid': 'mini-map-head-position' }, 'Head')),
      data.startMode === 'savedOrigin' && validPoint(data.savedOrigin) && React.createElement('g', {
        fill: '#2dd4a0',
        stroke: '#2dd4a0',
        strokeWidth: 1.5,
        fontSize: 12,
        fontFamily: "'JetBrains Mono', monospace",
      }, marker(data.savedOrigin, { 'data-testid': 'mini-map-saved-origin' }, 'Zero')),
    ),
    React.createElement('div', {
      style: {
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        marginTop: 6,
        color: '#777798',
        fontSize: 9,
        lineHeight: 1.3,
      },
    },
      'Bed',
      validBounds(data.materialBounds) ? 'Material' : null,
      validBounds(data.jobBounds) ? 'Job extent' : null,
      validBounds(data.frameBounds) ? 'Frame' : null,
      data.startMode === 'current' && validPoint(data.headPosition) ? 'Head' : null,
      data.startMode === 'savedOrigin' && validPoint(data.savedOrigin) ? 'Saved zero' : null,
    ),
  );
}
