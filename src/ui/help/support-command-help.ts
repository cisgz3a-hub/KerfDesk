import type { CommandId } from '../commands/command-types';
import type { CommandHelpTopic } from './command-help-topics';

type SupportCommandId = Extract<
  CommandId,
  'help.report-bug' | 'help.support-report' | 'help.open-data-folder' | 'help.discussions'
>;

export const SUPPORT_COMMAND_HELP: Readonly<Record<SupportCommandId, CommandHelpTopic>> = {
  'help.report-bug': {
    family: 'help',
    tooltip: 'Open KerfDesk support in your browser and see what to include in a problem report.',
  },
  'help.support-report': {
    family: 'help',
    tooltip:
      'Save a text file with your KerfDesk version, machine, recent problems and, in the desktop app, its log. Read it, then email it to support@kerfdesk.com. It never includes your licence key.',
  },
  'help.open-data-folder': {
    family: 'help',
    tooltip:
      'Open the folder where the desktop app keeps your settings, licence and support log, for example to back it up or when KerfDesk support asks for a file from it. Your projects are saved wherever you choose, not here.',
  },
  'help.discussions': {
    family: 'help',
    tooltip: 'Open KerfDesk support in your browser for questions, ideas and feedback.',
  },
};
