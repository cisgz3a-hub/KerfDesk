import type { DetectedPiece } from '../pieces/find-pieces';
import type { DesignFrame } from '../pieces/piece-placements';
import type { CameraModelRecord } from '../model/camera-model-record';
import type { SurfaceHeightArea } from '../model/height-areas';
import type { Vec2 } from '../../scene/scene-object';

/** Advisory recorded intent, never current machine/camera-origin evidence. */
export type FixtureBasis = {
  readonly kind: 'scene-mm';
  readonly deviceProfileId: string;
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
};
export type FixtureCameraContext = {
  readonly model: CameraModelRecord;
  readonly surfaceHeightMm: number;
  readonly heightAreas: ReadonlyArray<SurfaceHeightArea>;
};
export type FixtureObservation = { readonly expectedMm: Vec2; readonly observedMm: Vec2 };
export type FixtureQualification = {
  readonly recordedAt: string;
  readonly method: 'manual-observation';
  readonly basis: FixtureBasis;
  readonly camera?: FixtureCameraContext;
  readonly points: ReadonlyArray<FixtureObservation>;
  readonly notes: string;
};
export type FixtureTemplate = {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly basis: FixtureBasis;
  readonly slots: ReadonlyArray<{ readonly id: string; readonly piece: DetectedPiece }>;
  readonly sample?: { readonly slotId: string; readonly design: DesignFrame };
  readonly camera?: FixtureCameraContext;
  readonly qualification?: FixtureQualification;
};
export const FIXTURE_LIMITS = {
  templates: 32,
  slots: 64,
  outlinePoints: 2048,
  totalPoints: 8192,
  heightAreas: 64,
  observations: 64,
  templateBytes: 512 * 1024,
  collectionBytes: 2 * 1024 * 1024,
} as const;
