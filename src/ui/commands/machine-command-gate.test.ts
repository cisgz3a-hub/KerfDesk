import { describe, expect, it } from 'vitest';
import { buildAppCommands } from './command-registry';
import { CNC_ONLY_COMMAND_IDS, LASER_ONLY_COMMAND_IDS } from './machine-command-gate';
import type { CommandId } from './command-types';
import { baseCtx } from './command-registry-test-helpers';

// Machine-agnostic commands that must survive the CNC gate (ADR-101 §1):
// geometry sources, edit/arrange, file, preview, connection. The Trace family
// joined this set in the 2026-07-13 ADR-101 amendment — traced vectors are
// cuttable on CNC, so Trace/Re-trace/Multi-file trace must stay visible in CNC.
const CNC_SURVIVORS: ReadonlyArray<CommandId> = [
  'file.new',
  'file.import-svg',
  'file.import-image',
  'file.save-gcode',
  'edit.undo',
  'edit.paste',
  'tools.add-text',
  'tools.measure',
  'tools.convert-to-path',
  'tools.weld',
  'tools.trace-image',
  'tools.retrace-original',
  'tools.multi-file-trace',
  'arrange.align-left',
  'arrange.break-apart',
  'laser.connect',
  'window.toggle-preview',
  'window.fit-view',
  'help.about',
];

describe('gateCommandsForMachineKind via buildAppCommands (ADR-101)', () => {
  it('laser mode exposes the laser-only set and hides the CNC-only set', () => {
    const ids = buildAppCommands(baseCtx({ machineKind: 'laser' })).map((c) => c.id);
    for (const id of LASER_ONLY_COMMAND_IDS) {
      expect(ids).toContain(id);
    }
    for (const id of CNC_ONLY_COMMAND_IDS) {
      expect(ids).not.toContain(id);
    }
    for (const id of CNC_SURVIVORS) {
      expect(ids).toContain(id);
    }
  });

  it('cnc mode hides exactly the laser-only set and shows the CNC-only set', () => {
    const laserIds = buildAppCommands(baseCtx({ machineKind: 'laser' })).map((c) => c.id);
    const cncIds = new Set(buildAppCommands(baseCtx({ machineKind: 'cnc' })).map((c) => c.id));
    for (const id of LASER_ONLY_COMMAND_IDS) {
      expect(cncIds.has(id)).toBe(false);
    }
    for (const id of CNC_ONLY_COMMAND_IDS) {
      expect(cncIds.has(id)).toBe(true);
    }
    const hidden = laserIds.filter((id) => !cncIds.has(id));
    expect(new Set(hidden)).toEqual(new Set(LASER_ONLY_COMMAND_IDS));
  });

  it('cnc mode keeps machine-agnostic commands', () => {
    const cncIds = buildAppCommands(baseCtx({ machineKind: 'cnc' })).map((c) => c.id);
    for (const id of CNC_SURVIVORS) {
      expect(cncIds).toContain(id);
    }
  });

  it('no gated command carries a keyboard shortcut (shortcut dispatch bypasses the gate)', () => {
    const commands = buildAppCommands(baseCtx({ machineKind: 'laser' }));
    for (const command of commands) {
      if (LASER_ONLY_COMMAND_IDS.has(command.id)) {
        expect(command.shortcut).toBeUndefined();
      }
    }
  });
});
