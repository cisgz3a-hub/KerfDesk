import { describe, expect, it, vi } from 'vitest';
import { buildAppCommands, commandById, runCommand } from './command-registry';
import { baseCtx } from './command-registry-test-helpers';

describe('Photo engraving command', () => {
  it('requires a raster selection and dispatches only when the image is eligible', () => {
    const photoEngraving = vi.fn();
    const command = (hasRasterSelection: boolean, canPhotoEngraveSelection: boolean) =>
      commandById(
        buildAppCommands(baseCtx({ hasRasterSelection, canPhotoEngraveSelection, photoEngraving })),
        'tools.photo-engraving',
      );

    expect(runCommand(command(false, false))).toBe(false);
    expect(runCommand(command(true, false))).toBe(false);
    expect(photoEngraving).not.toHaveBeenCalled();
    expect(runCommand(command(true, true))).toBe(true);
    expect(photoEngraving).toHaveBeenCalledOnce();
  });

  it('remains inert when a host has not supplied its opening callback', () => {
    const command = commandById(
      buildAppCommands(baseCtx({ hasRasterSelection: true })),
      'tools.photo-engraving',
    );

    expect(command.enabled).toBe(false);
    expect(runCommand(command)).toBe(false);
  });

  it('appears in laser mode and is absent from CNC command surfaces', () => {
    const photoEngraving = vi.fn();
    const context = { hasRasterSelection: true, photoEngraving };
    const laserCommands = buildAppCommands(baseCtx({ ...context, machineKind: 'laser' }));
    const cncCommands = buildAppCommands(baseCtx({ ...context, machineKind: 'cnc' }));

    expect(commandById(laserCommands, 'tools.photo-engraving').enabled).toBe(true);
    expect(cncCommands.some((command) => command.id === 'tools.photo-engraving')).toBe(false);
    expect(photoEngraving).not.toHaveBeenCalled();
  });
});
