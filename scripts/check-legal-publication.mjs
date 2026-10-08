// Checks source/output readiness separately from statutory, launch and PAIA work.
// No provider calls, publication, launch-flag changes or runtime changes.
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { legalPublication } from '../website/legal-publication.config.mjs';
import {
  publicationBlockers,
  publicationReviewQuestions,
} from '../website/lib/legal-publication.mjs';
export {
  publicationBlockers,
  publicationReviewQuestions,
} from '../website/lib/legal-publication.mjs';
import { REPO_ROOT, renderDrafts, renderPublicInformation } from './generate-site-pages.mjs';

export function draftErrors({ publication = legalPublication } = {}) {
  const errors = [];
  if (publication.status !== 'draft') errors.push('Full review-document status must remain draft.');
  if (publication.publicationDate !== null)
    errors.push('The full review documents must have no publication date.');
  if (publication.seller.supportEmail !== 'support@kerfdesk.com')
    errors.push('Primary public support contact must be support@kerfdesk.com.');
  if (publication.seller.vatRegistered !== false)
    errors.push('The confirmed proprietor is not VAT-registered.');
  return errors;
}

export async function checkLegalDraft({ root = REPO_ROOT, publishReady = false } = {}) {
  const errors = draftErrors();
  if (errors.length) throw new Error(errors.join('\n'));
  const blockers = publicationBlockers();
  if (publishReady) {
    if (blockers.length)
      throw new Error('Publication content is incomplete:\n- ' + blockers.join('\n- '));
    await renderPublicInformation({ check: true, root });
  } else {
    await renderDrafts({ check: true, root });
  }
  return blockers;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args[0] && !['--draft', '--publish-ready'].includes(args[0]))) {
    throw new Error('Usage: node scripts/check-legal-publication.mjs [--draft | --publish-ready]');
  }
  const publishReady = args[0] === '--publish-ready';
  const blockers = await checkLegalDraft({ publishReady });
  console.log(
    publishReady
      ? 'Checked public content, generated outputs and coherent source launch flags. This is not statutory or live-sales certification.'
      : `Checked local full drafts independently of live-sales flags. ${blockers.length} public-content blockers.`,
  );
  for (const blocker of blockers) console.log('- ' + blocker);
  for (const [scope, questions] of Object.entries(publicationReviewQuestions()))
    for (const question of questions) console.log(`Separate ${scope} question: ${question}`);
}
