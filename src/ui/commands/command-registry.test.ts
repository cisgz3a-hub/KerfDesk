import { describe, expect, it, vi } from 'vitest';
import {
  buildAppCommands,
  COMMAND_FAMILY_ORDER,
  commandById,
  runCommand,
  type AppCommandContext,
} from './command-registry';
import { COMMAND_HELP } from '../help/help-topics';

// The dirty-project guard resolves through a promise chain
// (confirmDiscard(...).then(...)); two hops cover mock-promise unwrap +
// the .then callback.
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function baseCtx(overrides: Partial<AppCommandContext> = {}): AppCommandContext {
  return {
    dirty: false,
    savedName: null,
    serialSupported: true,
    connected: false,
    machineBusy: false,
    homingEnabled: true,
    canUndo: false,
    canRedo: false,
    hasSelection: false,
    hasRasterSelection: false,
    hasConvertibleSelection: false,
    confirmDiscard: vi.fn(async () => true),
    newProject: vi.fn(),
    openProject: vi.fn(),
    saveProject: vi.fn(),
    saveProjectAs: vi.fn(),
    importSvg: vi.fn(),
    importImage: vi.fn(),
    saveGcode: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    selectAll: vi.fn(),
    duplicateSelection: vi.fn(),
    deleteSelection: vi.fn(),
    clearSelection: vi.fn(),
    addText: vi.fn(),
    materialTest: vi.fn(),
    intervalTest: vi.fn(),
    scanOffsetTest: vi.fn(),
    focusTestAvailable: false,
    focusTest: vi.fn(),
    optimizationSettings: vi.fn(),
    adjustImage: vi.fn(),
    traceImage: vi.fn(),
    convertToBitmap: vi.fn(),
    connectLaser: vi.fn(),
    disconnectLaser: vi.fn(),
    homeLaser: vi.fn(),
    togglePreview: vi.fn(),
    previewActive: false,
    hasPreviewableContent: true,
    resetView: vi.fn(),
    showAbout: vi.fn(),
    canTransformSelection: false,
    canAlignSelection: false,
    alignSelection: vi.fn(),
    canDistributeSelection: false,
    distributeSelection: vi.fn(),
    flipHorizontal: vi.fn(),
    flipVertical: vi.fn(),
    ...overrides,
  };
}

describe('buildAppCommands', () => {
  it('defines LightBurn-style command families with unique command ids', () => {
    const commands = buildAppCommands(baseCtx());
    const ids = commands.map((command) => command.id);

    expect(COMMAND_FAMILY_ORDER).toEqual([
      'file',
      'edit',
      'tools',
      'arrange',
      'laser',
      'window',
      'help',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(commands.map((command) => command.family)).toEqual(
      expect.arrayContaining(['file', 'edit', 'tools', 'arrange', 'laser', 'window', 'help']),
    );
  });

  it('uses the central help registry for enabled command hover text', () => {
    const commands = buildAppCommands(
      baseCtx({
        canUndo: true,
        canRedo: true,
        hasSelection: true,
        hasRasterSelection: true,
        hasConvertibleSelection: true,
        connected: true,
        serialSupported: true,
        canTransformSelection: true,
        canAlignSelection: true,
        canDistributeSelection: true,
      }),
    );

    for (const command of commands.filter((candidate) => candidate.enabled)) {
      expect(command.title).toBe(COMMAND_HELP[command.id].tooltip);
    }
  });

  it('uses the current Save G-code shortcut without stealing Ctrl+E from Ellipse', () => {
    const commands = buildAppCommands(baseCtx());

    expect(commandById(commands, 'file.save-gcode').shortcut).toBe('Ctrl+Shift+E');
    expect(commands.map((command) => command.shortcut)).not.toContain('Ctrl+E');
  });

  it('runs the New command through the shared dirty-project guard', async () => {
    const confirmDiscard = vi.fn(async () => true);
    const newProject = vi.fn();
    const commands = buildAppCommands(baseCtx({ dirty: true, confirmDiscard, newProject }));

    expect(runCommand(commandById(commands, 'file.new'))).toBe(true);
    expect(confirmDiscard).toHaveBeenCalledWith('start a new project');
    await flushMicrotasks();
    expect(newProject).toHaveBeenCalled();
  });

  it('does not run New when the guard resolves false (LU18 Cancel)', async () => {
    const confirmDiscard = vi.fn(async () => false);
    const newProject = vi.fn();
    const commands = buildAppCommands(baseCtx({ dirty: true, confirmDiscard, newProject }));

    expect(runCommand(commandById(commands, 'file.new'))).toBe(true);
    await flushMicrotasks();
    expect(newProject).not.toHaveBeenCalled();
  });

  it('does not run disabled image tools', () => {
    const traceImage = vi.fn();
    const commands = buildAppCommands(baseCtx({ hasRasterSelection: false, traceImage }));

    expect(commandById(commands, 'tools.trace-image').enabled).toBe(false);
    expect(runCommand(commandById(commands, 'tools.trace-image'))).toBe(false);
    expect(traceImage).not.toHaveBeenCalled();
  });

  it('enables Trace Image when a raster image is selected', () => {
    const traceImage = vi.fn();
    const commands = buildAppCommands(baseCtx({ hasRasterSelection: true, traceImage }));

    expect(commandById(commands, 'tools.trace-image').enabled).toBe(true);
    expect(runCommand(commandById(commands, 'tools.trace-image'))).toBe(true);
    expect(traceImage).toHaveBeenCalled();
  });

  it('runs Material Test through the shared dirty-project guard', async () => {
    const confirmDiscard = vi.fn(async () => true);
    const materialTest = vi.fn();
    const commands = buildAppCommands(baseCtx({ dirty: true, confirmDiscard, materialTest }));

    expect(runCommand(commandById(commands, 'tools.material-test'))).toBe(true);
    expect(confirmDiscard).toHaveBeenCalledWith('create a material test');
    await flushMicrotasks();
    expect(materialTest).toHaveBeenCalled();
  });

  it('runs Interval Test through the shared dirty-project guard', async () => {
    const confirmDiscard = vi.fn(async () => true);
    const intervalTest = vi.fn();
    const commands = buildAppCommands(baseCtx({ dirty: true, confirmDiscard, intervalTest }));

    expect(runCommand(commandById(commands, 'tools.interval-test'))).toBe(true);
    expect(confirmDiscard).toHaveBeenCalledWith('create an interval test');
    await flushMicrotasks();
    expect(intervalTest).toHaveBeenCalled();
  });

  it('runs Scan Offset Test through the shared dirty-project guard', async () => {
    const confirmDiscard = vi.fn(async () => true);
    const scanOffsetTest = vi.fn();
    const commands = buildAppCommands(baseCtx({ dirty: true, confirmDiscard, scanOffsetTest }));

    expect(runCommand(commandById(commands, 'tools.scan-offset-test'))).toBe(true);
    expect(confirmDiscard).toHaveBeenCalledWith('create a scan offset test');
    await flushMicrotasks();
    expect(scanOffsetTest).toHaveBeenCalled();
  });

  it('blocks Focus Test unless the active profile has verified controllable Z support', () => {
    const focusTest = vi.fn();
    const commands = buildAppCommands(baseCtx({ focusTest }));
    const command = commandById(commands, 'tools.focus-test');

    expect(command.enabled).toBe(false);
    expect(command.disabledReason).toContain('verified controllable Z-axis');
    expect(runCommand(command)).toBe(false);
    expect(focusTest).not.toHaveBeenCalled();
  });

  it('runs Focus Test through the shared dirty-project guard when Z support is verified', async () => {
    const confirmDiscard = vi.fn(async () => true);
    const focusTest = vi.fn();
    const commands = buildAppCommands(
      baseCtx({ dirty: true, confirmDiscard, focusTestAvailable: true, focusTest }),
    );

    expect(runCommand(commandById(commands, 'tools.focus-test'))).toBe(true);
    expect(confirmDiscard).toHaveBeenCalledWith('create a focus test');
    await flushMicrotasks();
    expect(focusTest).toHaveBeenCalled();
  });

  it('runs Optimization Settings without the destructive dirty-project guard', () => {
    const confirmDiscard = vi.fn(async () => true);
    const optimizationSettings = vi.fn();
    const commands = buildAppCommands(
      baseCtx({ dirty: true, confirmDiscard, optimizationSettings }),
    );

    expect(runCommand(commandById(commands, 'tools.optimization-settings'))).toBe(true);
    expect(confirmDiscard).not.toHaveBeenCalled();
    expect(optimizationSettings).toHaveBeenCalled();
  });

  it('enables Adjust Image only when a raster image is selected', () => {
    const adjustImage = vi.fn();
    const disabledCommands = buildAppCommands(baseCtx({ hasRasterSelection: false, adjustImage }));

    expect(commandById(disabledCommands, 'tools.adjust-image').enabled).toBe(false);
    expect(runCommand(commandById(disabledCommands, 'tools.adjust-image'))).toBe(false);
    expect(adjustImage).not.toHaveBeenCalled();

    const enabledCommands = buildAppCommands(baseCtx({ hasRasterSelection: true, adjustImage }));
    expect(commandById(enabledCommands, 'tools.adjust-image').enabled).toBe(true);
    expect(runCommand(commandById(enabledCommands, 'tools.adjust-image'))).toBe(true);
    expect(adjustImage).toHaveBeenCalled();
  });

  it('runs Arrange flip commands only when an object can be transformed', () => {
    const flipHorizontal = vi.fn();
    const disabledCommands = buildAppCommands(baseCtx({ flipHorizontal }));

    expect(commandById(disabledCommands, 'arrange.flip-horizontal').enabled).toBe(false);
    expect(runCommand(commandById(disabledCommands, 'arrange.flip-horizontal'))).toBe(false);

    const enabledCommands = buildAppCommands(
      baseCtx({ canTransformSelection: true, flipHorizontal }),
    );
    expect(commandById(enabledCommands, 'arrange.flip-horizontal').enabled).toBe(true);
    expect(runCommand(commandById(enabledCommands, 'arrange.flip-horizontal'))).toBe(true);
    expect(flipHorizontal).toHaveBeenCalled();
  });

  it('runs Arrange align commands only when at least two objects are selected', () => {
    const alignSelection = vi.fn();
    const disabledCommands = buildAppCommands(baseCtx({ alignSelection }));

    expect(commandById(disabledCommands, 'arrange.align-left').enabled).toBe(false);
    expect(runCommand(commandById(disabledCommands, 'arrange.align-left'))).toBe(false);
    expect(alignSelection).not.toHaveBeenCalled();

    const enabledCommands = buildAppCommands(baseCtx({ canAlignSelection: true, alignSelection }));
    expect(commandById(enabledCommands, 'arrange.align-left').enabled).toBe(true);
    expect(runCommand(commandById(enabledCommands, 'arrange.align-left'))).toBe(true);
    expect(alignSelection).toHaveBeenCalledWith('left');
  });

  it('runs Arrange distribute commands only when at least three objects are selected', () => {
    const distributeSelection = vi.fn();
    const disabledCommands = buildAppCommands(baseCtx({ distributeSelection }));

    expect(commandById(disabledCommands, 'arrange.distribute-horizontal-centers').enabled).toBe(
      false,
    );
    expect(runCommand(commandById(disabledCommands, 'arrange.distribute-horizontal-centers'))).toBe(
      false,
    );
    expect(distributeSelection).not.toHaveBeenCalled();

    const enabledCommands = buildAppCommands(
      baseCtx({ canDistributeSelection: true, distributeSelection }),
    );
    expect(commandById(enabledCommands, 'arrange.distribute-horizontal-centers').enabled).toBe(
      true,
    );
    expect(runCommand(commandById(enabledCommands, 'arrange.distribute-horizontal-centers'))).toBe(
      true,
    );
    expect(distributeSelection).toHaveBeenCalledWith('horizontal-centers');
  });
});

// M27 (AUDIT-2026-06-10): preview had exactly one entry point (the P key);
// the command now carries content gating + an active flag the toolbar
// renders as aria-pressed.
describe('window.toggle-preview command (M27)', () => {
  it('is disabled with a reason when nothing is previewable', () => {
    const command = commandById(
      buildAppCommands(baseCtx({ hasPreviewableContent: false })),
      'window.toggle-preview',
    );
    expect(command.enabled).toBe(false);
    expect(command.disabledReason).toContain('Enable Output');
  });

  it('is enabled and inactive with previewable content', () => {
    const command = commandById(buildAppCommands(baseCtx()), 'window.toggle-preview');
    expect(command.enabled).toBe(true);
    expect(command.active).toBe(false);
  });

  it('reports active while preview mode is on', () => {
    const command = commandById(
      buildAppCommands(baseCtx({ previewActive: true })),
      'window.toggle-preview',
    );
    expect(command.active).toBe(true);
  });

  it('stays exit-able when the scene empties mid-preview', () => {
    const togglePreview = vi.fn();
    const command = commandById(
      buildAppCommands(
        baseCtx({ hasPreviewableContent: false, previewActive: true, togglePreview }),
      ),
      'window.toggle-preview',
    );
    expect(command.enabled).toBe(true);
    expect(runCommand(command)).toBe(true);
    expect(togglePreview).toHaveBeenCalledTimes(1);
  });
});
