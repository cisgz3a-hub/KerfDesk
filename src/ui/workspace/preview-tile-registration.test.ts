import { describe, expect, it, vi } from 'vitest';
import { toMachineCoords } from '../../core/devices';
import type { Toolpath } from '../../core/job';
import { DEFAULT_CNC_TILING, createProject, type Project } from '../../core/scene';
import {
  REGISTRATION,
  compiledRectangle,
  grow,
  jobBounds,
  machineWithStock,
} from '../../core/cnc/tile-seam-fixtures.test-support';
import {
  drawPreviewTileRegistration,
  previewTileRegistrationNotices,
  previewTileRegistrationOf,
  withPreviewTileRegistration,
} from './preview-tile-registration';

const EMPTY_ROUTE: Toolpath = { steps: [], totalLength: 0 };

function tiledProject(): {
  readonly project: Project;
  readonly job: ReturnType<typeof compiledRectangle>;
} {
  const job = compiledRectangle(
    { w: 390, h: 300 },
    { cutType: 'profile-outside', depthMm: 6, depthPerPassMm: 2, profileLead: { shape: 'none' } },
  );
  const machine = {
    ...machineWithStock(grow(jobBounds(job), 20)),
    tiling: { ...DEFAULT_CNC_TILING, registration: REGISTRATION },
  };
  return { project: { ...createProject(), machine }, job };
}

describe('Preview shows the tile registration bores (N4-P1-1)', () => {
  it('carries the planned bores in scene coordinates and lists them', () => {
    const { project, job } = tiledProject();
    const route = withPreviewTileRegistration(EMPTY_ROUTE, project, job, { x: 0, y: 0 });
    const registration = previewTileRegistrationOf(route);
    expect(registration?.holes).toHaveLength(2);
    expect(registration?.diameterMm).toBe(REGISTRATION.holeDiameterMm);
    // Mapped back to machine coordinates, each bore is off the blank.
    const blank = jobBounds(job);
    for (const hole of registration?.holes ?? []) {
      const machine = toMachineCoords(hole, project.device);
      expect(machine.y > blank.maxY || machine.y < blank.minY).toBe(true);
    }
    expect(previewTileRegistrationNotices(route)[0]).toContain('Tile registration: 2 holes');

    const arc = vi.fn();
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc,
      fill: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    drawPreviewTileRegistration(ctx, route, { scale: 2, offsetX: 0, offsetY: 0 } as never);
    expect(arc).toHaveBeenCalledTimes(2);
  });

  it('adds nothing when tiling or its holes are off', () => {
    const { project, job } = tiledProject();
    const machine = project.machine;
    if (machine?.kind !== 'cnc' || machine.tiling === undefined) throw new Error('cnc expected');
    const off = {
      ...project,
      machine: { ...machine, tiling: { ...machine.tiling, registrationHoles: false } },
    };
    expect(withPreviewTileRegistration(EMPTY_ROUTE, off, job, { x: 0, y: 0 })).toBe(EMPTY_ROUTE);
  });
});
