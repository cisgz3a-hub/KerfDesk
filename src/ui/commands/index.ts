export { AppMenuBar } from './AppMenuBar';
export { CommandShell } from './CommandShell';
export {
  buildAppCommands,
  commandById,
  COMMAND_FAMILY_ORDER,
  runCommand,
  type AppCommand,
  type AppCommandContext,
  type CommandFamily,
  type CommandId,
} from './command-registry';
