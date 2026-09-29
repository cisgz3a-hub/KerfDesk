import type { CommandId } from '../commands/command-types';
import type { CommandHelpTopic } from './command-help-topics';

type SitePageCommandId = Extract<
  CommandId,
  'help.pricing' | 'help.terms' | 'help.privacy' | 'help.refunds' | 'help.paia-manual'
>;

// Help → the pricing and legal pages on kerfdesk.com (ADR-524 Amendment 3).
export const SITE_PAGE_COMMAND_HELP: Readonly<Record<SitePageCommandId, CommandHelpTopic>> = {
  'help.pricing': {
    family: 'help',
    tooltip:
      'Open the KerfDesk pricing page in your browser: what Free and Pro include, what Pro costs and how a licence works.',
  },
  'help.terms': {
    family: 'help',
    tooltip: 'Open the KerfDesk Terms of Service in your browser. It links the Refund Policy.',
  },
  'help.privacy': {
    family: 'help',
    tooltip:
      'Open the KerfDesk Privacy Notice in your browser: what the app sends over the network, what stays on your computer, and your rights.',
  },
  'help.refunds': {
    family: 'help',
    tooltip:
      'Open the KerfDesk Refund Policy in your browser: the 14-day refund for Pro licences and update extensions, and your legal rights.',
  },
  'help.paia-manual': {
    family: 'help',
    tooltip:
      'Open the KerfDesk PAIA Manual in your browser: which records KerfDesk keeps and how to ask for them under South Africa’s access-to-information law.',
  },
};
