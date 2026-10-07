import type { CommandId } from '../commands/command-types';
import type { CommandHelpTopic } from './command-help-topics';

type PolicyCommandId = Extract<
  CommandId,
  'help.pricing' | 'help.terms' | 'help.privacy' | 'help.refunds'
>;

export const POLICY_COMMAND_HELP: Readonly<Record<PolicyCommandId, CommandHelpTopic>> = {
  'help.pricing': {
    family: 'help',
    tooltip: 'Read the Free and Pro features and prices. Paid checkout remains closed.',
  },
  'help.terms': {
    family: 'help',
    tooltip: 'Read the published Software and Supplier Terms and future Pro purchase rights.',
  },
  'help.privacy': {
    family: 'help',
    tooltip: 'Read what KerfDesk stores and sends, and how to make a privacy request.',
  },
  'help.refunds': {
    family: 'help',
    tooltip: 'Read the refund promise for future Pro and update purchases.',
  },
};
