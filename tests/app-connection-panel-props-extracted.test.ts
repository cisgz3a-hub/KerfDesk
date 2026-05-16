import fs from 'node:fs';
import path from 'node:path';
import { resolveConnectionPanelBoundsProps } from '../src/ui/components/appConnectionPanelProps';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'components', 'App.tsx'), 'utf8');
const builderPath = path.join(process.cwd(), 'src', 'ui', 'components', 'appConnectionPanelProps.ts');
const builderSource = fs.existsSync(builderPath) ? fs.readFileSync(builderPath, 'utf8') : '';

const finiteBounds = resolveConnectionPanelBoundsProps({
  sceneBounds: { minX: -12, minY: 5, maxX: 220, maxY: 140 },
  frameTransformBounds: { minX: 1, minY: 2, maxX: 3, maxY: 4 },
});

assert(
  finiteBounds.boundsMinX === -12
    && finiteBounds.boundsMinY === 5
    && finiteBounds.boundsMaxX === 220
    && finiteBounds.boundsMaxY === 140
    && finiteBounds.frameTransformBoundsMinX === 1
    && finiteBounds.frameTransformBoundsMinY === 2
    && finiteBounds.frameTransformBoundsMaxX === 3
    && finiteBounds.frameTransformBoundsMaxY === 4,
  'resolveConnectionPanelBoundsProps preserves finite scene and frame bounds',
);

const fallbackBounds = resolveConnectionPanelBoundsProps({
  sceneBounds: { minX: Number.NaN, minY: Number.NEGATIVE_INFINITY, maxX: Number.POSITIVE_INFINITY, maxY: Number.NaN },
  frameTransformBounds: { minX: Number.NaN, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NaN },
});

assert(
  fallbackBounds.boundsMinX === 0
    && fallbackBounds.boundsMinY === 0
    && fallbackBounds.boundsMaxX === 100
    && fallbackBounds.boundsMaxY === 100
    && fallbackBounds.frameTransformBoundsMinX === 0
    && fallbackBounds.frameTransformBoundsMinY === 0
    && fallbackBounds.frameTransformBoundsMaxX === 100
    && fallbackBounds.frameTransformBoundsMaxY === 100,
  'resolveConnectionPanelBoundsProps applies stable fallbacks for non-finite bounds',
);

assert(
  appSource.includes('buildAppConnectionPanelProps'),
  'App.tsx should use a ConnectionPanel prop builder instead of a large inline object',
);
assert(
  builderSource.includes('buildAppConnectionPanelProps'),
  'appConnectionPanelProps should export buildAppConnectionPanelProps',
);
assert(
  builderSource.includes('ConnectionPanelProps'),
  'appConnectionPanelProps should preserve ConnectionPanel prop typing',
);
assert(
  builderSource.includes('T2-6 Phase 3ap'),
  'appConnectionPanelProps should carry the Phase 3ap marker',
);
assert(
  builderSource.includes('resolveConnectionPanelBoundsProps'),
  'appConnectionPanelProps should export resolveConnectionPanelBoundsProps',
);
assert(
  appSource.includes('resolveConnectionPanelBoundsProps({'),
  'App.tsx should delegate connection-panel bounds prop fallback shaping',
);
assert(
  !appSource.includes('Number.isFinite(sceneBounds.minX) ? sceneBounds.minX : 0'),
  'App.tsx should not inline scene bounds minX fallback',
);
assert(
  !appSource.includes('Number.isFinite(frameTransformBounds.maxY) ? frameTransformBounds.maxY : 100'),
  'App.tsx should not inline frame transform maxY fallback',
);
