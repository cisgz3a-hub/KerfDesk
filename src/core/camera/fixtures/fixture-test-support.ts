import type { DetectedPiece } from '../pieces/find-pieces';
import { savedCameraModel } from '../model/model-fixtures';
import type { FixtureTemplate } from './fixture-template';

export function fixturePiece(x: number, y: number, angle = 0): DetectedPiece {
  const radians = (angle * Math.PI) / 180;
  const outline = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a = 0, b = 0]) => ({
    x: x + a * 40 * Math.cos(radians) - b * 25 * Math.sin(radians),
    y: y + a * 40 * Math.sin(radians) + b * 25 * Math.cos(radians),
  }));
  return {
    outline,
    rect: { centre: { x, y }, length: 80, width: 50, axisDeg: angle },
    centroid: { x, y },
    areaMm2: 4000,
    shape: 'oblong',
    headingDeg: null,
    partial: false,
  };
}
export function fixtureTemplate(): FixtureTemplate {
  const basis = {
    kind: 'scene-mm' as const,
    deviceProfileId: 'generic-grbl-400x400',
    bedWidthMm: 400,
    bedHeightMm: 400,
  };
  const camera = { model: savedCameraModel(), surfaceHeightMm: 3, heightAreas: [] };
  return {
    version: 1,
    id: 'fixture',
    name: 'Coaster fixture',
    createdAt: '2026-10-07T01:00:00.000Z',
    updatedAt: '2026-10-07T01:00:00.000Z',
    basis,
    slots: [
      { id: 'A', piece: fixturePiece(100, 100) },
      { id: 'B', piece: fixturePiece(250, 100, 30) },
    ],
    sample: {
      slotId: 'A',
      design: { centre: { x: 110, y: 95 }, width: 20, height: 10, turnDeg: 0 },
    },
    camera,
    qualification: {
      recordedAt: '2026-10-07T02:00:00.000Z',
      method: 'manual-observation',
      basis,
      camera,
      notes: 'Independent ruler readings',
      points: [
        { expectedMm: { x: 100, y: 100 }, observedMm: { x: 100.3, y: 100.4 } },
        { expectedMm: { x: 250, y: 100 }, observedMm: { x: 250, y: 101 } },
      ],
    },
  };
}
