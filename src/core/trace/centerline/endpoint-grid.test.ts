import { expect, it } from 'vitest';
import { EndpointGrid } from './endpoint-grid';

it('returns every endpoint from a crowded cell without overflowing the argument stack', () => {
  const count = 150000;
  const point = { x: 0.5, y: 0.5 };
  const grid = EndpointGrid.create(
    Array.from({ length: count }, () => point),
    3,
  );
  const indices = grid?.nearbyIndices(point);
  expect(indices).toHaveLength(count);
  expect(indices?.every((index, position) => index === position)).toBe(true);
});
