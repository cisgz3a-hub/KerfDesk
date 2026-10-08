import type { CommandId } from '../commands/command-types';
import type { CommandHelpTopic } from './command-help-topics';

type SitePageCommandId = Extract<
  CommandId,
  'help.pricing' | 'help.terms' | 'help.privacy' | 'help.refunds'
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
    tooltip:
      'Open the KerfDesk software supplier terms in your browser. They link the Refund Policy.',
  },
  'help.privacy': {
    family: 'help',
    tooltip:
      'Open the KerfDesk privacy page in your browser: what the app sends over the network, what stays on your computer, and your rights.',
  },
  'help.refunds': {
    family: 'help',
    tooltip:
      'Open the KerfDesk Refund Policy in your browser: the 14-day refund for Pro licences and update extensions, and your legal rights.',
  },
};
