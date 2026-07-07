import { describe, expect, it, vi } from 'vitest';
import {
  buildAppCommands,
  COMMAND_FAMILY_ORDER,
  commandById,
  runCommand,
} from './command-registry';
import { COMMAND_HELP } from '../help/help-topics';
import { baseCtx, flushMicrotasks } from './command-registry-test-helpers';

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

  it('exposes the camera command now the camera feature is restored (ADR-116)', () => {
    const commands = buildAppCommands(baseCtx());

    expect(commands.map((command) => command.id)).toContain('tools.camera');
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

  it('gates Copy, Cut, and Paste from selection and clipboard state', () => {
    const copySelection = vi.fn();
    const cutSelection = vi.fn();
    const pasteClipboard = vi.fn();
    const disabled = buildAppCommands(
      baseCtx({
        hasSelection: false,
        canPaste: false,
        copySelection,
        cutSelection,
        pasteClipboard,
      }),
    );

    expect(commandById(disabled, 'edit.copy').enabled).toBe(false);
    expect(commandById(disabled, 'edit.cut').enabled).toBe(false);
    expect(commandById(disabled, 'edit.paste').enabled).toBe(false);

    const enabled = buildAppCommands(
      baseCtx({ hasSelection: true, canPaste: true, copySelection, cutSelection, pasteClipboard }),
    );
    expect(runCommand(commandById(enabled, 'edit.copy'))).toBe(true);
    expect(runCommand(commandById(enabled, 'edit.cut'))).toBe(true);
    expect(runCommand(commandById(enabled, 'edit.paste'))).toBe(true);
    expect(copySelection).toHaveBeenCalledTimes(1);
    expect(cutSelection).toHaveBeenCalledTimes(1);
    expect(pasteClipboard).toHaveBeenCalledTimes(1);
  });

  it('gates Group and Ungroup from selection and group state', () => {
    const groupSelection = vi.fn();
    const ungroupSelection = vi.fn();
    const disabled = buildAppCommands(
      baseCtx({
        canGroupSelection: false,
        canUngroupSelection: false,
        groupSelection,
        ungroupSelection,
      }),
    );

    expect(commandById(disabled, 'edit.group').enabled).toBe(false);
    expect(commandById(disabled, 'edit.ungroup').enabled).toBe(false);

    const enabled = buildAppCommands(
      baseCtx({
        canGroupSelection: true,
        canUngroupSelection: true,
        groupSelection,
        ungroupSelection,
      }),
    );
    expect(runCommand(commandById(enabled, 'edit.group'))).toBe(true);
    expect(runCommand(commandById(enabled, 'edit.ungroup'))).toBe(true);
    expect(groupSelection).toHaveBeenCalledTimes(1);
    expect(ungroupSelection).toHaveBeenCalledTimes(1);
  });

  it('enables Trace Image when a raster image is selected', () => {
    const traceImage = vi.fn();
    const commands = buildAppCommands(baseCtx({ hasRasterSelection: true, traceImage }));

    expect(commandById(commands, 'tools.trace-image').enabled).toBe(true);
    expect(runCommand(commandById(commands, 'tools.trace-image'))).toBe(true);
    expect(traceImage).toHaveBeenCalled();
  });

  it('runs Multi-File Trace without requiring a selected image', () => {
    const multiFileTrace = vi.fn();
    const commands = buildAppCommands(baseCtx({ hasRasterSelection: false, multiFileTrace }));
    const command = commandById(commands, 'tools.multi-file-trace');

    expect(command.enabled).toBe(true);
    expect(runCommand(command)).toBe(true);
    expect(multiFileTrace).toHaveBeenCalledTimes(1);
  });

  it('runs and marks the Measure tool command as active', () => {
    const measureTool = vi.fn();
    const inactive = commandById(buildAppCommands(baseCtx({ measureTool })), 'tools.measure');

    expect(inactive.shortcut).toBe('Alt+M');
    expect(inactive.active).toBe(false);
    expect(runCommand(inactive)).toBe(true);
    expect(measureTool).toHaveBeenCalledTimes(1);

    const active = commandById(
      buildAppCommands(baseCtx({ measureActive: true, measureTool })),
      'tools.measure',
    );
    expect(active.active).toBe(true);
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

  it('keeps Focus Test disabled until the Z-motion generator exists', () => {
    const focusTest = vi.fn();
    const commands = buildAppCommands(baseCtx({ focusTest }));
    const command = commandById(commands, 'tools.focus-test');

    expect(command.enabled).toBe(false);
    expect(command.disabledReason).toContain('dedicated, hardware-verified Z-motion generator');
    expect(runCommand(command)).toBe(false);
    expect(focusTest).not.toHaveBeenCalled();
  });

  it('does not run Focus Test even when a profile advertises verified Z support', () => {
    const confirmDiscard = vi.fn(async () => true);
    const focusTest = vi.fn();
    const commands = buildAppCommands(
      baseCtx({ dirty: true, confirmDiscard, focusTestAvailable: true, focusTest }),
    );
    const command = commandById(commands, 'tools.focus-test');

    expect(command.enabled).toBe(false);
    expect(command.disabledReason).toContain('dedicated, hardware-verified Z-motion generator');
    expect(runCommand(command)).toBe(false);
    expect(confirmDiscard).not.toHaveBeenCalled();
    expect(focusTest).not.toHaveBeenCalled();
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

  it('runs Project Notes from the Window menu without the destructive dirty-project guard', () => {
    const confirmDiscard = vi.fn(async () => true);
    const projectNotes = vi.fn();
    const commands = buildAppCommands(baseCtx({ dirty: true, confirmDiscard, projectNotes }));

    const command = commandById(commands, 'window.project-notes');

    expect(command.enabled).toBe(true);
    expect(runCommand(command)).toBe(true);
    expect(confirmDiscard).not.toHaveBeenCalled();
    expect(projectNotes).toHaveBeenCalledTimes(1);
  });

  it('runs Undo History from the Window menu without the destructive dirty-project guard', () => {
    const confirmDiscard = vi.fn(async () => true);
    const undoHistory = vi.fn();
    const commands = buildAppCommands(baseCtx({ dirty: true, confirmDiscard, undoHistory }));

    const command = commandById(commands, 'window.undo-history');

    expect(command.enabled).toBe(true);
    expect(runCommand(command)).toBe(true);
    expect(confirmDiscard).not.toHaveBeenCalled();
    expect(undoHistory).toHaveBeenCalledTimes(1);
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

  it('enables Save Processed Bitmap only when a raster image is selected', () => {
    const saveProcessedBitmap = vi.fn();
    const disabledCommands = buildAppCommands(
      baseCtx({ hasRasterSelection: false, saveProcessedBitmap }),
    );

    expect(commandById(disabledCommands, 'tools.save-processed-bitmap').enabled).toBe(false);
    expect(runCommand(commandById(disabledCommands, 'tools.save-processed-bitmap'))).toBe(false);
    expect(saveProcessedBitmap).not.toHaveBeenCalled();

    const enabledCommands = buildAppCommands(
      baseCtx({ hasRasterSelection: true, saveProcessedBitmap }),
    );
    expect(commandById(enabledCommands, 'tools.save-processed-bitmap').enabled).toBe(true);
    expect(runCommand(commandById(enabledCommands, 'tools.save-processed-bitmap'))).toBe(true);
    expect(saveProcessedBitmap).toHaveBeenCalled();
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
