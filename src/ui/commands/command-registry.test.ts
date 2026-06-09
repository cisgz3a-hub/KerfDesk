import { describe, expect, it, vi } from 'vitest';
import {
  buildAppCommands,
  COMMAND_FAMILY_ORDER,
  commandById,
  runCommand,
  type AppCommandContext,
} from './command-registry';

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
    confirmDiscard: vi.fn(() => true),
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
    adjustImage: vi.fn(),
    traceImage: vi.fn(),
    convertToBitmap: vi.fn(),
    connectLaser: vi.fn(),
    disconnectLaser: vi.fn(),
    homeLaser: vi.fn(),
    togglePreview: vi.fn(),
    resetView: vi.fn(),
    showAbout: vi.fn(),
    canTransformSelection: false,
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

  it('runs the New command through the shared dirty-project guard', () => {
    const confirmDiscard = vi.fn(() => true);
    const newProject = vi.fn();
    const commands = buildAppCommands(baseCtx({ dirty: true, confirmDiscard, newProject }));

    expect(runCommand(commandById(commands, 'file.new'))).toBe(true);
    expect(confirmDiscard).toHaveBeenCalledWith('start a new project');
    expect(newProject).toHaveBeenCalled();
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

  it('runs Material Test through the shared dirty-project guard', () => {
    const confirmDiscard = vi.fn(() => true);
    const materialTest = vi.fn();
    const commands = buildAppCommands(baseCtx({ dirty: true, confirmDiscard, materialTest }));

    expect(runCommand(commandById(commands, 'tools.material-test'))).toBe(true);
    expect(confirmDiscard).toHaveBeenCalledWith('create a material test');
    expect(materialTest).toHaveBeenCalled();
  });

  it('runs Interval Test through the shared dirty-project guard', () => {
    const confirmDiscard = vi.fn(() => true);
    const intervalTest = vi.fn();
    const commands = buildAppCommands(baseCtx({ dirty: true, confirmDiscard, intervalTest }));

    expect(runCommand(commandById(commands, 'tools.interval-test'))).toBe(true);
    expect(confirmDiscard).toHaveBeenCalledWith('create an interval test');
    expect(intervalTest).toHaveBeenCalled();
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
});
