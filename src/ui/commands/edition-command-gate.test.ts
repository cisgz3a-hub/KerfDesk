import { afterEach, describe, expect, it } from 'vitest';
import { setActiveEdition, UNRESTRICTED_EDITION, type EditionValue } from '../licensing/edition';
import { buildAppCommands, commandById, runCommand } from './command-registry';
import { baseCtx } from './command-registry-test-helpers';
import { labelProCommands, PRO_COMMAND_FEATURES } from './edition-command-gate';

// KerfDesk Free (ADR-540): a Pro command stays listed and enabled, and choosing
// it asks for Pro first. Pro unlocked from that dialog runs the command.
function freeEdition(unlock: boolean): EditionValue & { readonly asked: string[] } {
  const asked: string[] = [];
  return {
    ...UNRESTRICTED_EDITION,
    licensed: true,
    pro: false,
    asked,
    requestPro: (feature, onAllowed) => {
      asked.push(feature);
      if (unlock) onAllowed?.();
      return false;
    },
  };
}

afterEach(() => setActiveEdition(null));

describe('Pro commands (ADR-540)', () => {
  it('run at once where Pro is available', () => {
    const ctx = baseCtx({ machineKind: 'laser' });
    runCommand(commandById(buildAppCommands(ctx), 'tools.box-generator'));
    expect(ctx.boxGenerator).toHaveBeenCalledTimes(1);
  });

  it('ask for Pro in KerfDesk Free and do nothing when the operator declines', () => {
    const edition = freeEdition(false);
    setActiveEdition(edition);
    const ctx = baseCtx({ machineKind: 'laser' });
    const commands = buildAppCommands(ctx);
    expect(commandById(commands, 'tools.box-generator').enabled).toBe(true);
    runCommand(commandById(commands, 'tools.box-generator'));
    runCommand(commandById(commands, 'tools.multi-file-trace'));
    expect(edition.asked).toEqual(['box-generator', 'advanced-trace']);
    expect(ctx.boxGenerator).not.toHaveBeenCalled();
    expect(ctx.multiFileTrace).not.toHaveBeenCalled();
  });

  it('run once Pro is unlocked from the Pro dialog', () => {
    setActiveEdition(freeEdition(true));
    const ctx = baseCtx({ machineKind: 'cnc' });
    runCommand(commandById(buildAppCommands(ctx), 'file.import-height-map'));
    expect(ctx.importHeightMap).toHaveBeenCalledTimes(1);
  });

  it('leave the Free commands alone', () => {
    const edition = freeEdition(false);
    setActiveEdition(edition);
    const ctx = baseCtx({ machineKind: 'laser' });
    runCommand(commandById(buildAppCommands(ctx), 'tools.barcode'));
    expect(ctx.barcodeGenerator).toHaveBeenCalledTimes(1);
    expect(edition.asked).toEqual([]);
  });

  it('are marked Pro in KerfDesk Free menus', () => {
    const labelled = labelProCommands(buildAppCommands(baseCtx({ machineKind: 'laser' })));
    expect(commandById(labelled, 'tools.box-generator').label).toMatch(/ \(Pro\)$/);
    expect(commandById(labelled, 'tools.trace-image').label).not.toMatch(/Pro/);
    const pro = labelled.filter((command) => PRO_COMMAND_FEATURES.has(command.id));
    expect(pro.every((command) => command.label.endsWith(' (Pro)'))).toBe(true);
  });
});
