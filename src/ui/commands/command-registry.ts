export const COMMAND_FAMILY_ORDER = [
  'file',
  'edit',
  'tools',
  'arrange',
  'laser',
  'window',
  'help',
] as const;

export type CommandFamily = (typeof COMMAND_FAMILY_ORDER)[number];

export type CommandId =
  | 'file.new'
  | 'file.open'
  | 'file.save'
  | 'file.save-as'
  | 'file.import-svg'
  | 'file.import-image'
  | 'file.save-gcode'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.select-all'
  | 'edit.duplicate'
  | 'edit.delete'
  | 'edit.clear-selection'
  | 'tools.add-text'
  | 'tools.material-test'
  | 'tools.adjust-image'
  | 'tools.trace-image'
  | 'tools.convert-to-bitmap'
  | 'arrange.flip-horizontal'
  | 'arrange.flip-vertical'
  | 'laser.connect'
  | 'laser.disconnect'
  | 'laser.home'
  | 'window.toggle-preview'
  | 'window.fit-view'
  | 'help.about';

export type AppCommand = {
  readonly id: CommandId;
  readonly family: CommandFamily;
  readonly label: string;
  readonly title: string;
  readonly shortcut?: string;
  readonly enabled: boolean;
  readonly disabledReason?: string;
  readonly invoke: () => void;
};

export type AppCommandContext = {
  readonly dirty: boolean;
  readonly savedName: string | null;
  readonly serialSupported: boolean;
  readonly connected: boolean;
  readonly machineBusy: boolean;
  readonly homingEnabled: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly hasSelection: boolean;
  readonly hasRasterSelection: boolean;
  readonly hasConvertibleSelection: boolean;
  readonly confirmDiscard: (action: string) => boolean;
  readonly newProject: () => void;
  readonly openProject: () => void;
  readonly saveProject: () => void;
  readonly saveProjectAs: () => void;
  readonly importSvg: () => void;
  readonly importImage: () => void;
  readonly saveGcode: () => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly selectAll: () => void;
  readonly duplicateSelection: () => void;
  readonly deleteSelection: () => void;
  readonly clearSelection: () => void;
  readonly addText: () => void;
  readonly materialTest: () => void;
  readonly adjustImage: () => void;
  readonly traceImage: () => void;
  readonly convertToBitmap: () => void;
  readonly canTransformSelection: boolean;
  readonly flipHorizontal: () => void;
  readonly flipVertical: () => void;
  readonly connectLaser: () => void;
  readonly disconnectLaser: () => void;
  readonly homeLaser: () => void;
  readonly togglePreview: () => void;
  readonly resetView: () => void;
  readonly showAbout: () => void;
};

export function buildAppCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    ...fileCommands(ctx),
    ...editCommands(ctx),
    ...toolsCommands(ctx),
    ...arrangeCommands(ctx),
    ...laserCommands(ctx),
    ...windowCommands(ctx),
    helpCommand(ctx),
  ];
}

export function commandById(commands: ReadonlyArray<AppCommand>, id: CommandId): AppCommand {
  const command = commands.find((candidate) => candidate.id === id);
  if (command === undefined) throw new Error(`Missing command: ${id}`);
  return command;
}

export function runCommand(command: AppCommand): boolean {
  if (!command.enabled) return false;
  command.invoke();
  return true;
}

function enabled(
  id: CommandId,
  family: CommandFamily,
  label: string,
  title: string,
  invoke: () => void,
  shortcut?: string,
): AppCommand {
  return { id, family, label, title, enabled: true, invoke, ...(shortcut ? { shortcut } : {}) };
}

function disabled(
  id: CommandId,
  family: CommandFamily,
  label: string,
  reason: string,
  invoke: () => void,
  shortcut?: string,
): AppCommand {
  return {
    id,
    family,
    label,
    title: reason,
    enabled: false,
    disabledReason: reason,
    invoke,
    ...(shortcut ? { shortcut } : {}),
  };
}

function fileCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    enabled(
      'file.new',
      'file',
      'New',
      'New project',
      () => {
        if (ctx.confirmDiscard('start a new project')) ctx.newProject();
      },
      'Ctrl+N',
    ),
    enabled('file.open', 'file', 'Open...', 'Open .lf2 project', ctx.openProject, 'Ctrl+O'),
    enabled('file.save', 'file', 'Save', 'Save project', ctx.saveProject, 'Ctrl+S'),
    enabled(
      'file.save-as',
      'file',
      'Save As...',
      'Save project as',
      ctx.saveProjectAs,
      'Ctrl+Shift+S',
    ),
    enabled('file.import-svg', 'file', 'Import SVG...', 'Import SVG file', ctx.importSvg, 'Ctrl+I'),
    enabled(
      'file.import-image',
      'file',
      'Import Image...',
      'Import PNG/JPG image',
      ctx.importImage,
    ),
    enabled('file.save-gcode', 'file', 'Save G-code...', 'Export G-code', ctx.saveGcode, 'Ctrl+E'),
  ];
}

function editCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  const duplicate = ctx.hasSelection
    ? enabled(
        'edit.duplicate',
        'edit',
        'Duplicate',
        'Duplicate selection',
        ctx.duplicateSelection,
        'Ctrl+D',
      )
    : disabled(
        'edit.duplicate',
        'edit',
        'Duplicate',
        'Select an object to duplicate.',
        ctx.duplicateSelection,
        'Ctrl+D',
      );
  return [
    ctx.canUndo
      ? enabled('edit.undo', 'edit', 'Undo', 'Undo last edit', ctx.undo, 'Ctrl+Z')
      : disabled('edit.undo', 'edit', 'Undo', 'Nothing to undo.', ctx.undo, 'Ctrl+Z'),
    ctx.canRedo
      ? enabled('edit.redo', 'edit', 'Redo', 'Redo last undone edit', ctx.redo, 'Ctrl+Shift+Z')
      : disabled('edit.redo', 'edit', 'Redo', 'Nothing to redo.', ctx.redo, 'Ctrl+Shift+Z'),
    enabled('edit.select-all', 'edit', 'Select All', 'Select all artwork', ctx.selectAll, 'Ctrl+A'),
    duplicate,
    ctx.hasSelection
      ? enabled('edit.delete', 'edit', 'Delete', 'Delete selection', ctx.deleteSelection, 'Delete')
      : disabled(
          'edit.delete',
          'edit',
          'Delete',
          'Select an object to delete.',
          ctx.deleteSelection,
          'Delete',
        ),
    enabled(
      'edit.clear-selection',
      'edit',
      'Clear Selection',
      'Clear current selection',
      ctx.clearSelection,
      'Esc',
    ),
  ];
}

function toolsCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    enabled('tools.add-text', 'tools', 'Text...', 'Add text to the scene', ctx.addText),
    enabled(
      'tools.material-test',
      'tools',
      'Material Test...',
      'Create a material test grid',
      () => {
        if (ctx.confirmDiscard('create a material test')) ctx.materialTest();
      },
    ),
    ctx.hasRasterSelection
      ? enabled(
          'tools.adjust-image',
          'tools',
          'Adjust Image...',
          'Adjust selected image',
          ctx.adjustImage,
        )
      : disabled(
          'tools.adjust-image',
          'tools',
          'Adjust Image...',
          'Select an image first.',
          ctx.adjustImage,
        ),
    ctx.hasRasterSelection
      ? enabled(
          'tools.trace-image',
          'tools',
          'Trace Image...',
          'Trace selected image',
          ctx.traceImage,
        )
      : disabled(
          'tools.trace-image',
          'tools',
          'Trace Image...',
          'Select an image first.',
          ctx.traceImage,
        ),
    ctx.hasConvertibleSelection
      ? enabled(
          'tools.convert-to-bitmap',
          'tools',
          'Convert to Bitmap...',
          'Convert selected vector into a bitmap',
          ctx.convertToBitmap,
        )
      : disabled(
          'tools.convert-to-bitmap',
          'tools',
          'Convert to Bitmap...',
          'Select a vector first.',
          ctx.convertToBitmap,
        ),
  ];
}

function arrangeCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  const horizontal = ctx.canTransformSelection
    ? enabled(
        'arrange.flip-horizontal',
        'arrange',
        'Flip Horizontal',
        'Flip selection horizontally',
        ctx.flipHorizontal,
        'H',
      )
    : disabled(
        'arrange.flip-horizontal',
        'arrange',
        'Flip Horizontal',
        'Select an object to flip.',
        ctx.flipHorizontal,
        'H',
      );
  const vertical = ctx.canTransformSelection
    ? enabled(
        'arrange.flip-vertical',
        'arrange',
        'Flip Vertical',
        'Flip selection vertically',
        ctx.flipVertical,
        'V',
      )
    : disabled(
        'arrange.flip-vertical',
        'arrange',
        'Flip Vertical',
        'Select an object to flip.',
        ctx.flipVertical,
        'V',
      );
  return [horizontal, vertical];
}

function laserCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  const connect =
    ctx.serialSupported && !ctx.connected
      ? enabled(
          'laser.connect',
          'laser',
          'Connect',
          'Connect to laser controller',
          ctx.connectLaser,
        )
      : disabled('laser.connect', 'laser', 'Connect', connectDisabledReason(ctx), ctx.connectLaser);
  const disconnect =
    ctx.connected && !ctx.machineBusy
      ? enabled(
          'laser.disconnect',
          'laser',
          'Disconnect',
          'Disconnect from laser controller',
          ctx.disconnectLaser,
        )
      : disabled(
          'laser.disconnect',
          'laser',
          'Disconnect',
          disconnectDisabledReason(ctx),
          ctx.disconnectLaser,
        );
  const home =
    ctx.connected && ctx.homingEnabled && !ctx.machineBusy
      ? enabled('laser.home', 'laser', 'Home', 'Send homing command', ctx.homeLaser)
      : disabled('laser.home', 'laser', 'Home', homeDisabledReason(ctx), ctx.homeLaser);
  return [connect, disconnect, home];
}

function windowCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    enabled('window.toggle-preview', 'window', 'Preview', 'Toggle preview', ctx.togglePreview, 'P'),
    enabled(
      'window.fit-view',
      'window',
      'Fit View',
      'Fit the bed to the window',
      ctx.resetView,
      'F',
    ),
  ];
}

function helpCommand(ctx: AppCommandContext): AppCommand {
  return enabled('help.about', 'help', 'About LaserForge', 'Show build information', ctx.showAbout);
}

function connectDisabledReason(ctx: AppCommandContext): string {
  if (!ctx.serialSupported) return 'WebSerial is not supported in this browser.';
  if (ctx.connected) return 'Laser is already connected.';
  return 'Laser is not ready to connect.';
}

function disconnectDisabledReason(ctx: AppCommandContext): string {
  if (!ctx.connected) return 'Laser is not connected.';
  if (ctx.machineBusy) return 'Machine is busy. Use the laser panel controls first.';
  return 'Disconnect is unavailable.';
}

function homeDisabledReason(ctx: AppCommandContext): string {
  if (!ctx.connected) return 'Connect to the laser first.';
  if (!ctx.homingEnabled) return 'Homing is disabled in Device settings.';
  if (ctx.machineBusy) return 'Machine is busy. Wait or stop the active operation first.';
  return 'Home is unavailable.';
}
