// ADR-094 — .lf2 round-trip for the controller-family fields. Valid kinds and
// baud rates survive save/load; junk values are dropped back to the GRBL
// defaults so selectControllerDriver never sees an unknown kind.

import { describe, expect, it } from 'vitest';
import { createProject, type Project } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function withDevicePatch(patch: Record<string, unknown>): string {
  const raw = JSON.parse(serializeProject(createProject())) as {
    device: Record<string, unknown>;
  };
  raw.device = { ...raw.device, ...patch };
  return `${JSON.stringify(raw, null, 2)}\n`;
}

describe('.lf2 controllerKind + baudRate round-trip', () => {
  it('preserves grblhal and fluidnc kinds and a custom baud rate', () => {
    for (const kind of ['grblhal', 'fluidnc'] as const) {
      const result = deserializeProject(withDevicePatch({ controllerKind: kind, baudRate: 250000 }));
      if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
      expect(result.project.device.controllerKind).toBe(kind);
      expect(result.project.device.baudRate).toBe(250000);
      const reloaded = deserializeProject(serializeProject(result.project as Project));
      if (reloaded.kind !== 'ok') throw new Error(`expected ok, got ${reloaded.kind}`);
      expect(reloaded.project.device.controllerKind).toBe(kind);
      expect(reloaded.project.device.baudRate).toBe(250000);
    }
  });

  it('drops an unknown controllerKind back to the GRBL default', () => {
    const result = deserializeProject(withDevicePatch({ controllerKind: 'ruida-9000-turbo' }));
    if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
    expect(result.project.device.controllerKind).toBeUndefined();
  });

  it('drops a non-positive or non-numeric baud rate', () => {
    for (const junk of [-1, 0, 'fast']) {
      const result = deserializeProject(withDevicePatch({ baudRate: junk }));
      if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
      expect(result.project.device.baudRate).toBeUndefined();
    }
  });
});
