import { expect, it } from 'vitest';
import type { CncPath3dPass } from '../job';
import { economicalReliefRowLinks } from './relief-row-link-cost';

const pass: CncPath3dPass = {
  kind: 'path3d',
  closed: false,
  reliefRowLinkPrefixPoints: 1,
  points: [
    { x: 1, y: 1, z: 0 },
    { x: 2, y: 1, z: 0 },
    { x: 3, y: 1, z: 0 },
  ],
};
it('compares the represented feed word, preserving supported fractional feeds', () => {
  const rejected = economicalReliefRowLinks([pass], {
    feedMmPerMin: 1.9,
    plungeMmPerMin: 1,
    safeZMm: 1,
  });
  expect(rejected[0]).toEqual({ kind: 'path3d', closed: false, points: pass.points.slice(1) });
  expect(
    economicalReliefRowLinks([pass], { feedMmPerMin: 0.5, plungeMmPerMin: 0.1, safeZMm: 1 })[0],
  ).toBe(pass);
});
it('restores independent entry without complete finite cutting values', () => {
  expect(economicalReliefRowLinks([pass], undefined)[0]).not.toHaveProperty(
    'reliefRowLinkPrefixPoints',
  );
  expect(
    economicalReliefRowLinks([pass], {
      feedMmPerMin: 10,
      plungeMmPerMin: 1,
      safeZMm: Number.NaN,
    })[0],
  ).not.toHaveProperty('reliefRowLinkPrefixPoints');
});
