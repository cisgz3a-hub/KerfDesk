// Controller audit 2026-09-25 RU-6: the menu and command-palette Connect was
// enabled for a file-only (Ruida .rd export) profile while the rail's was
// disabled. Every Connect surface now agrees, with the refusal's own words.

import { describe, expect, it, vi } from 'vitest';
import { FILE_ONLY_CONNECT_REFUSAL } from '../state/laser-connect-action';
import { commandById, runCommand } from './command-registry';
import { baseCtx } from './command-registry-test-helpers';
import { laserCommands } from './laser-command-family';

function connectCommand(overrides: Parameters<typeof baseCtx>[0]) {
  return commandById(laserCommands(baseCtx(overrides)), 'laser.connect');
}

describe('laser.connect for a file-only profile', () => {
  it('is disabled with the file-only reason and never invokes Connect', () => {
    const connectLaser = vi.fn();
    const command = connectCommand({ fileOnlyTransport: true, connectLaser });
    expect(command.enabled).toBe(false);
    expect(command.disabledReason).toBe(FILE_ONLY_CONNECT_REFUSAL);
    expect(runCommand(command)).toBe(false);
    expect(connectLaser).not.toHaveBeenCalled();
  });

  it('names the file-only reason even where WebSerial is missing', () => {
    const command = connectCommand({ fileOnlyTransport: true, serialSupported: false });
    expect(command.disabledReason).toBe(FILE_ONLY_CONNECT_REFUSAL);
  });

  it('stays enabled for a serial profile', () => {
    expect(connectCommand({ fileOnlyTransport: false }).enabled).toBe(true);
  });
});
