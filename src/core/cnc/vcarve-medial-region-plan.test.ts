import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { pairVCarveMedialRoutes } from './vcarve-medial-region-plan';

const candidate: Polyline = { closed: false, points: [{ x: 1, y: 1 }] };
const reference: Polyline = { closed: false, points: [{ x: 2, y: 2 }] };

describe('V-carve medial route pairing', () => {
  it('keeps independently matched candidate and reference routes', () => {
    expect(pairVCarveMedialRoutes([candidate], [reference])).toEqual({
      routes: [candidate],
      referenceRoutes: [reference],
    });
  });

  it('emits the unsimplified references when route counts cannot be paired', () => {
    expect(pairVCarveMedialRoutes([candidate, candidate], [reference])).toEqual({
      routes: [reference],
      referenceRoutes: [reference],
    });
  });
});
