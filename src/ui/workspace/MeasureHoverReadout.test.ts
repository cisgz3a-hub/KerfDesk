import { describe, expect, it } from 'vitest';
import { createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { measureAtPoint, measureHoverLines } from './MeasureHoverReadout';

describe('measureAtPoint', () => {
  const rect = createRectangle({
    id: 'r',
    color: '#000000',
    spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
    transform: { ...IDENTITY_TRANSFORM, x: 50, y: 50 },
  });
  const scene = { ...createProject().scene, objects: [rect] };

  it('measures the hovered edge and the whole rectangle in world units', () => {
    const hover = measureAtPoint(scene, { x: 60, y: 50.2 }, 1);
    if (hover === null) throw new Error('expected a measurement');
    expect(measureHoverLines(hover)).toEqual([
      'Line 20.00 mm at 0.0°',
      'Perimeter 60.00 mm',
      'Area 200.00 mm²',
    ]);
  });

  it('reports nothing away from every outline', () => {
    expect(measureAtPoint(scene, { x: 60, y: 55 }, 1)).toBeNull();
  });
});
