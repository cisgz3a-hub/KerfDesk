// Published Supplier Terms, refund promise and settled pricing.
// The full commercial/PAIA review drafts and supplied app licences stay separate.
import { readFileSync } from 'node:fs';
import { blocksHtml, readDocument } from '../../scripts/site-pages-markdown.mjs';
import { pageHero, section } from '../lib/components.mjs';
import { html, raw } from '../lib/html.mjs';
import { publicSellerContact } from '../lib/legal-publication.mjs';
import { page as pricing } from './pricing.mjs';

export const publicPolicySources = Object.freeze([
  {
    path: '/terms/',
    title: 'Software and Supplier Terms',
    source: 'docs/legal/software-supplier-terms.md',
    description:
      'Published KerfDesk software terms, purchased Windows Pro rights, covered-version use and optional updates through Paddle.',
  },
  {
    path: '/refunds/',
    title: 'Refund Policy',
    source: 'docs/legal/refund-promise.md',
    description:
      'Our 14-day full-refund promise for a KerfDesk Pro or optional update purchase through Paddle, including after activation.',
  },
]);

export function publicPolicySourceErrors(source) {
  const errors = [];
  if (/\[PLACEHOLDER|Draft for review|not published or in force/i.test(source))
    errors.push('Unfinished review content cannot be a published policy.');
  if (!source.includes('Version 1.1. Published: 7 October 2026.'))
    errors.push('A published policy needs its version and confirmed publication date.');
  return errors;
}

function policyPage(policy) {
  return {
    ...policy,
    nav: null,
    render: () => {
      const source = readFileSync(new URL('../../' + policy.source, import.meta.url), 'utf8');
      const errors = publicPolicySourceErrors(source);
      if (errors.length) throw new Error(policy.source + ': ' + errors.join(' '));
      const document = readDocument(source);
      const body = blocksHtml(document.blocks).replace(
        /href="https:\/\/kerfdesk[.]com\/(terms|refunds|privacy|pricing|license)\/"/g,
        (_, destination) => `href="/${destination}/"`,
      );
      return html`${pageHero({ title: document.title })}${section({
        narrow: true,
        content: html`<div class="prose">${raw(body)}</div>`,
      })}${section({
        id: 'seller',
        narrow: true,
        title: 'Software and licence contact',
        content: publicSellerContact(),
      })}`;
    },
  };
}

export const pricingInformationPage = {
  ...pricing,
  render: (ctx) =>
    html`${pricing.render(ctx)}${section({
      id: 'seller',
      narrow: true,
      title: 'Who makes KerfDesk',
      content: publicSellerContact(),
    })}`,
};

export const softwareTermsPage = policyPage(publicPolicySources[0]);
export const refundPolicyPage = policyPage(publicPolicySources[1]);
export const paymentInformationPages = Object.freeze([
  pricingInformationPage,
  softwareTermsPage,
  refundPolicyPage,
]);
