import { afterEach, describe, expect, it, vi } from 'vitest';
import { setActiveEdition, UNRESTRICTED_EDITION } from '../licensing/edition';
import { buildAppCommands, commandById, runCommand } from './command-registry';
import { baseCtx } from './command-registry-test-helpers';
import { labelProCommands } from './edition-command-gate';

const tools = [
  [
    'tools.registration-jig',
    'registration-jig',
    'registrationPanelOpen',
    'toggleRegistrationPanel',
  ],
  ['tools.place-board', 'place-board', 'boardCapturePanelOpen', 'toggleBoardCapturePanel'],
] as const;

afterEach(() => setActiveEdition(null));

describe.each(tools)('%s Pro entry', (id, feature, open, toggle) => {
  it('stays available and labelled Pro, but declining does not open the panel', () => {
    const requestPro = vi.fn(() => false);
    setActiveEdition({ ...UNRESTRICTED_EDITION, licensed: true, pro: false, requestPro });
    const ctx = baseCtx({ machineKind: 'laser' });
    const command = commandById(labelProCommands(buildAppCommands(ctx)), id);
    expect(command.enabled).toBe(true);
    expect(command.label).toMatch(/ \(Pro\)$/);
    runCommand(command);
    expect(requestPro).toHaveBeenCalledWith(feature, expect.any(Function));
    expect(ctx[toggle]).not.toHaveBeenCalled();
  });

  it('continues the panel command after unlocking Pro', () => {
    const requestPro = vi.fn((_feature: string, allowed?: () => void) => {
      allowed?.();
      return true;
    });
    setActiveEdition({ ...UNRESTRICTED_EDITION, licensed: true, pro: false, requestPro });
    const ctx = baseCtx({ machineKind: 'laser' });
    runCommand(commandById(buildAppCommands(ctx), id));
    expect(requestPro).toHaveBeenCalledWith(feature, expect.any(Function));
    expect(ctx[toggle]).toHaveBeenCalledTimes(1);
  });

  it('opens directly in an unrestricted edition', () => {
    setActiveEdition(UNRESTRICTED_EDITION);
    const ctx = baseCtx({ machineKind: 'laser' });
    runCommand(commandById(buildAppCommands(ctx), id));
    expect(ctx[toggle]).toHaveBeenCalledTimes(1);
  });

  it('closes an admitted panel after Pro expires without another prompt', () => {
    const requestPro = vi.fn(() => false);
    setActiveEdition({ ...UNRESTRICTED_EDITION, licensed: true, pro: false, requestPro });
    const ctx = baseCtx({ machineKind: 'laser', [open]: true });
    runCommand(commandById(buildAppCommands(ctx), id));
    expect(ctx[toggle]).toHaveBeenCalledTimes(1);
    expect(requestPro).not.toHaveBeenCalled();
  });
});
